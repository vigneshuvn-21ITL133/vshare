import { describe, expect, it } from "vitest";
import { encodeLine } from "@vshare/protocol";
import { BluetoothBridge, type BridgeTransport } from "../electron/bluetooth.js";

/** A stand-in for the bridge process: records what is sent and lets the test send lines back. */
function fakeBridge() {
  const sent: Array<Record<string, unknown>> = [];
  let lineHandler: (line: string) => void = () => undefined;
  let exitHandler: (reason: string) => void = () => undefined;
  const transport: BridgeTransport = {
    send(line) {
      sent.push(JSON.parse(line) as Record<string, unknown>);
    },
    onLine(handler) {
      lineHandler = handler;
    },
    onExit(handler) {
      exitHandler = handler;
    },
    stop() {},
  };
  return {
    transport,
    sent,
    last: () => sent[sent.length - 1],
    reply: (message: object) => lineHandler(JSON.stringify(message)),
    event: (message: object) => lineHandler(JSON.stringify(message)),
    rawLine: (line: string) => lineHandler(line),
    exit: (reason: string) => exitHandler(reason),
  };
}

const base64Of = (text: string) => Buffer.from(text, "utf8").toString("base64");

describe("BluetoothBridge", () => {
  it("lists paired devices from the reply", async () => {
    const fake = fakeBridge();
    const bridge = new BluetoothBridge(() => fake.transport);
    const pending = bridge.paired();
    expect(fake.last().cmd).toBe("paired");
    fake.reply({ id: fake.last().id, ok: true, data: { devices: [{ name: "Pixel", address: "AA:BB:CC:DD:EE:FF" }] } });
    await expect(pending).resolves.toEqual([{ name: "Pixel", address: "AA:BB:CC:DD:EE:FF" }]);
  });

  it("rejects when the bridge reports an error", async () => {
    const fake = fakeBridge();
    const bridge = new BluetoothBridge(() => fake.transport);
    const pending = bridge.connect("AA:BB:CC:DD:EE:FF");
    fake.reply({ id: fake.last().id, ok: false, error: "The phone is not offering V_share." });
    await expect(pending).rejects.toThrow("not offering V_share");
  });

  it("sends frames as base64 lines and decodes lines received in pieces", async () => {
    const fake = fakeBridge();
    const bridge = new BluetoothBridge(() => fake.transport);
    const connecting = bridge.connect("AA:BB:CC:DD:EE:FF");
    fake.reply({ id: fake.last().id, ok: true });
    const socket = await connecting;

    const received: Uint8Array[] = [];
    socket.onData((frame) => received.push(frame));

    const outgoing = new Uint8Array([1, 2, 3, 250]);
    socket.write(outgoing);
    expect(fake.last()).toEqual({ cmd: "write", text: encodeLine(outgoing) });

    const incoming = new Uint8Array([9, 8, 7]);
    const line = encodeLine(incoming);
    // One line arrives split over two reads.
    fake.event({ event: "data", data: base64Of(line.slice(0, 2)) });
    expect(received).toHaveLength(0);
    fake.event({ event: "data", data: base64Of(line.slice(2)) });
    expect(received).toEqual([incoming]);
  });

  it("handles several lines in one read", async () => {
    const fake = fakeBridge();
    const bridge = new BluetoothBridge(() => fake.transport);
    const connecting = bridge.connect("AA:BB:CC:DD:EE:FF");
    fake.reply({ id: fake.last().id, ok: true });
    const socket = await connecting;
    const received: Uint8Array[] = [];
    socket.onData((frame) => received.push(frame));

    const first = new Uint8Array([1]);
    const second = new Uint8Array([2, 2]);
    fake.event({ event: "data", data: base64Of(encodeLine(first) + encodeLine(second)) });
    expect(received).toEqual([first, second]);
  });

  it("hands an incoming phone to the listener and closes cleanly", async () => {
    const fake = fakeBridge();
    const bridge = new BluetoothBridge(() => fake.transport);
    const peers: Array<{ name: string; address: string }> = [];
    let incomingSocket: { onClose(handler: (error?: Error) => void): void; onData(handler: (data: Uint8Array) => void): void } | null = null;

    const listening = bridge.listen((socket, peer) => {
      incomingSocket = socket;
      peers.push(peer);
    });
    fake.reply({ id: fake.last().id, ok: true });
    await listening;

    fake.event({ event: "connected", name: "Pixel", address: "11:22:33:44:55:66" });
    expect(peers).toEqual([{ name: "Pixel", address: "11:22:33:44:55:66" }]);
    expect(incomingSocket).not.toBeNull();

    let closeArgs: unknown[] | null = null;
    incomingSocket!.onClose((error) => {
      closeArgs = [error];
    });
    fake.event({ event: "closed", reason: "end" });
    expect(closeArgs).toEqual([undefined]);
  });

  it("ignores lines that are not JSON", async () => {
    const fake = fakeBridge();
    const bridge = new BluetoothBridge(() => fake.transport);
    const pending = bridge.paired();
    fake.rawLine("Build succeeded.");
    fake.reply({ id: fake.last().id, ok: true, data: { devices: [] } });
    await expect(pending).resolves.toEqual([]);
  });

  it("rejects pending requests and reports the failure when the bridge exits", async () => {
    const fake = fakeBridge();
    const failures: string[] = [];
    const bridge = new BluetoothBridge(() => fake.transport, (message) => failures.push(message));
    const pending = bridge.paired();
    fake.exit("The Bluetooth bridge stopped (exit code 1).");
    await expect(pending).rejects.toThrow("exit code 1");
    expect(failures).toEqual(["The Bluetooth bridge stopped (exit code 1)."]);
  });
});
