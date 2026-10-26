import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Receiver, Sender } from "@vshare/protocol";
import { listenForSenders, connectToReceiver } from "@vshare/protocol/node";
import { fileSourceFor, fileSinkIn } from "../electron/files";

const sizes = [1024 * 1024, 1024 * 1024 + 1, 3 * 1024 * 1024 + 77, 10 * 1024 * 1024];

describe("disk-to-disk transfer over TCP, around the chunk boundary", () => {
  for (const size of sizes) {
    it(`round-trips ${size} bytes`, async () => {
      const dir = await mkdtemp(join(tmpdir(), "vs-"));
      const src = join(dir, "in.bin");
      const out = join(dir, "out");
      const data = randomBytes(size);
      await writeFile(src, data);
      await mkdir(out, { recursive: true });
      const server = await listenForSenders(0, (socket) => {
        void new Receiver(socket, {
          device: { id: "receiver-device-01", name: "R", platform: "android" } as never,
          authorize: () => true,
          onOffer: async () => true,
          openSink: async (meta) => fileSinkIn(out, meta.name),
        }).start().then((r) => results.push(r));
      }, "127.0.0.1");
      const results: unknown[] = [];
      const port = (server.address() as { port: number }).port;
      const socket = await connectToReceiver("127.0.0.1", port);
      const sent = await new Sender(socket, {
        device: { id: "sender-device-0001", name: "S", platform: "windows" } as never,
        files: [await fileSourceFor(src)],
      }).start();
      await new Promise((r) => setTimeout(r, 300));
      await new Promise<void>((r) => server.close(() => r()));
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      expect(sent).toEqual({ state: "done" });
      expect(results[0]).toMatchObject({ state: "done" });
    }, 60000);
  }
});
