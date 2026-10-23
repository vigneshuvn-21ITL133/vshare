import { describe, expect, it } from "vitest";
import type { Server } from "node:net";
import {
  CHUNK_SIZE,
  PROTOCOL_VERSION,
  Receiver,
  Sender,
  type ByteSocket,
  type ReceiveResult,
  type SendResult,
} from "../src/index.js";
import { connectToReceiver, listenForSenders } from "../src/node.js";
import { bytesEqual, memorySinkFactory, memorySource, randomBytesOf, type MemoryStore } from "./helpers.js";

const senderDevice = { id: "sender-device-0001", name: "Laptop", platform: "windows" as const };
const receiverDevice = { id: "receiver-device-01", name: "Phone", platform: "android" as const };

/** Starts a receiver server on a random port, runs the test body, then shuts down. */
async function withServer(
  makeReceiver: (socket: ByteSocket) => Receiver,
  run: (port: number, outcomes: Promise<ReceiveResult>[]) => Promise<void>,
): Promise<void> {
  const outcomes: Promise<ReceiveResult>[] = [];
  const server: Server = await listenForSenders(
    0,
    (socket) => {
      outcomes.push(makeReceiver(socket).start());
    },
    "127.0.0.1",
  );
  const port = (server.address() as { port: number }).port;
  try {
    await run(port, outcomes);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("end-to-end transfer over TCP", () => {
  it("delivers several files intact, including an empty file and a multi-chunk file", async () => {
    const store: MemoryStore = { files: new Map(), aborted: [] };
    const big = randomBytesOf(CHUNK_SIZE * 2 + 1234, 7);
    const small = randomBytesOf(10, 3);
    const files = [
      memorySource("big.bin", big),
      memorySource("empty.txt", new Uint8Array(0), "text/plain"),
      memorySource("small.txt", small, "text/plain"),
    ];

    await withServer(
      (socket) =>
        new Receiver(socket, {
          device: receiverDevice,
          authorize: () => true,
          onOffer: async () => true,
          openSink: memorySinkFactory(store),
        }),
      async (port, outcomes) => {
        const socket = await connectToReceiver("127.0.0.1", port);
        const result: SendResult = await new Sender(socket, { device: senderDevice, files }).start();

        expect(result).toEqual({ state: "done" });
        expect((await outcomes[0]).state).toBe("done");
      },
    );

    expect(bytesEqual(store.files.get("big.bin"), big)).toBe(true);
    expect(store.files.get("empty.txt")?.length).toBe(0);
    expect(bytesEqual(store.files.get("small.txt"), small)).toBe(true);
    expect(store.aborted).toEqual([]);
  });

  it("reports a declined offer to both sides and writes nothing", async () => {
    const store: MemoryStore = { files: new Map(), aborted: [] };
    await withServer(
      (socket) =>
        new Receiver(socket, {
          device: receiverDevice,
          authorize: () => true,
          onOffer: async () => false,
          openSink: memorySinkFactory(store),
        }),
      async (port, outcomes) => {
        const socket = await connectToReceiver("127.0.0.1", port);
        const result = await new Sender(socket, {
          device: senderDevice,
          files: [memorySource("a.txt", randomBytesOf(50))],
        }).start();

        expect(result.state).toBe("declined");
        expect((await outcomes[0]).state).toBe("declined");
      },
    );
    expect(store.files.size).toBe(0);
  });

  it("refuses a sender that fails authorization before any file moves", async () => {
    const store: MemoryStore = { files: new Map(), aborted: [] };
    await withServer(
      (socket) =>
        new Receiver(socket, {
          device: receiverDevice,
          authorize: (hello) => hello.pairToken === "0".repeat(32),
          onOffer: async () => true,
          openSink: memorySinkFactory(store),
        }),
      async (port) => {
        const socket = await connectToReceiver("127.0.0.1", port);
        const result = await new Sender(socket, {
          device: senderDevice,
          files: [memorySource("a.txt", randomBytesOf(50))],
          pairToken: "f".repeat(32),
        }).start();
        expect(result.state).toBe("declined");
      },
    );
    expect(store.files.size).toBe(0);
  });

  it("shows the same six-digit verification code on both devices", async () => {
    const senderCodes: string[] = [];
    const receiverCodes: string[] = [];
    const store: MemoryStore = { files: new Map(), aborted: [] };

    await withServer(
      (socket) =>
        new Receiver(socket, {
          device: receiverDevice,
          authorize: () => true,
          onOffer: async (_offer, context) => {
            receiverCodes.push(context.verificationCode);
            return true;
          },
          openSink: memorySinkFactory(store),
        }),
      async (port) => {
        const socket = await connectToReceiver("127.0.0.1", port);
        await new Sender(socket, {
          device: senderDevice,
          files: [memorySource("a.txt", randomBytesOf(20))],
          onState: (state, detail) => {
            if (state === "verifying" && detail?.verificationCode) senderCodes.push(detail.verificationCode);
          },
        }).start();
      },
    );

    expect(senderCodes).toHaveLength(1);
    expect(receiverCodes).toHaveLength(1);
    expect(senderCodes[0]).toMatch(/^\d{6}$/);
    expect(senderCodes[0]).toBe(receiverCodes[0]);
  });

  it("cancelling mid-transfer discards the partial file on the receiver", async () => {
    const store: MemoryStore = { files: new Map(), aborted: [] };
    const big = randomBytesOf(CHUNK_SIZE * 6, 9);

    await withServer(
      (socket) =>
        new Receiver(socket, {
          device: receiverDevice,
          authorize: () => true,
          onOffer: async () => true,
          openSink: memorySinkFactory(store),
        }),
      async (port, outcomes) => {
        const socket = await connectToReceiver("127.0.0.1", port);
        const sender: Sender = new Sender(socket, {
          device: senderDevice,
          files: [memorySource("big.bin", big)],
          onProgress: (progress) => {
            if (progress.bytesSent >= CHUNK_SIZE) sender.cancel();
          },
        });
        expect((await sender.start()).state).toBe("cancelled");
        expect(["cancelled", "error"]).toContain((await outcomes[0]).state);
      },
    );
    expect(store.files.has("big.bin")).toBe(false);
  });

  it("uses protocol version 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
