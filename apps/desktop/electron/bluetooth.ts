import { decodeBase64, encodeLine, type ByteSocket } from "@vshare/protocol";
import type { BluetoothDeviceInfo } from "./shared.js";

/** Carries the bridge's JSON lines. A child process in the app, a fake in tests. */
export interface BridgeTransport {
  /** Sends one line. The transport adds the newline. */
  send(line: string): void;
  onLine(handler: (line: string) => void): void;
  /** Called once when the bridge stops. The reason is shown to the user. */
  onExit(handler: (reason: string) => void): void;
  /** Stops the bridge on purpose. */
  stop(): void;
}

interface BridgeMessage {
  id?: string;
  ok?: boolean;
  data?: unknown;
  error?: string;
  event?: string;
  name?: string;
  address?: string;
  message?: string;
  reason?: string;
}

interface Waiter {
  resolve(data: unknown): void;
  reject(error: Error): void;
}

const REQUEST_TIMEOUT_MS = 15_000;
/** Pairing a phone the first time, or a slow phone, can take a while. */
const CONNECT_TIMEOUT_MS = 30_000;
/** Connection-closing reasons that are not errors. */
const CLEAN_REASONS = new Set(["end", "closed by V_share", "bridge stopped"]);

/**
 * Bluetooth Classic (RFCOMM) for the desktop app, through the Windows bridge process.
 * The bridge allows one connection at a time. Incoming connections go to the handler passed
 * to `listen`; the protocol code above sees the same ByteSocket it uses for Wi-Fi.
 */
export class BluetoothBridge {
  private transport: BridgeTransport | null = null;
  private waiters = new Map<string, Waiter>();
  private nextId = 1;
  private active: RfcommSocket | null = null;
  private incoming: ((socket: ByteSocket, peer: BluetoothDeviceInfo) => void) | null = null;
  private disposed = false;

  /**
   * @param factory starts the bridge. Called lazily, so the process only runs when Bluetooth is used.
   * @param onFailure called when the bridge stops unexpectedly, with the reason.
   */
  constructor(
    private factory: () => BridgeTransport,
    private onFailure: (message: string) => void = () => undefined,
  ) {}

  /** Devices paired with this PC in Windows. */
  async paired(): Promise<BluetoothDeviceInfo[]> {
    const data = (await this.request({ cmd: "paired" }, REQUEST_TIMEOUT_MS)) as { devices: BluetoothDeviceInfo[] };
    return data.devices;
  }

  /** Starts accepting phones. `onIncoming` runs once per connection. */
  async listen(onIncoming: (socket: ByteSocket, peer: BluetoothDeviceInfo) => void): Promise<void> {
    this.incoming = onIncoming;
    try {
      await this.request({ cmd: "listen" }, REQUEST_TIMEOUT_MS);
    } catch (error) {
      this.incoming = null;
      throw error;
    }
  }

  async stopListen(): Promise<void> {
    this.incoming = null;
    await this.request({ cmd: "stopListen" }, REQUEST_TIMEOUT_MS);
  }

  /** Connects to a paired phone by its Bluetooth address, for example "AA:BB:CC:DD:EE:FF". */
  async connect(address: string): Promise<ByteSocket> {
    if (this.active) throw new Error("Another Bluetooth connection is already open. Try again in a moment.");
    const socket = new RfcommSocket(this);
    this.active = socket;
    try {
      await this.request({ cmd: "connect", address }, CONNECT_TIMEOUT_MS);
    } catch (error) {
      if (this.active === socket) this.active = null;
      // If the bridge connected after we gave up, close it so it is not left open with no owner.
      this.command({ cmd: "close" });
      throw error;
    }
    return socket;
  }

  /** Sends a command that gets no reply. Failures come back as error events. */
  command(message: Record<string, unknown>): void {
    this.ensure().send(JSON.stringify(message));
  }

  /** Called by a socket once it is closed, so a new connection can start. */
  release(socket: RfcommSocket): void {
    if (this.active === socket) this.active = null;
  }

  /** Stops the bridge process. Used when the app quits. */
  dispose(): void {
    this.disposed = true;
    const transport = this.transport;
    this.transport = null;
    transport?.stop();
  }

  private request(message: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const id = String(this.nextId++);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error("The Bluetooth bridge did not answer in time."));
      }, timeoutMs);
      this.waiters.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.ensure().send(JSON.stringify({ id, ...message }));
      } catch (error) {
        this.waiters.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private ensure(): BridgeTransport {
    if (this.disposed) throw new Error("Bluetooth has been shut down.");
    if (!this.transport) {
      const transport = this.factory();
      transport.onLine((line) => this.handleLine(line));
      transport.onExit((reason) => this.handleExit(reason));
      this.transport = transport;
    }
    return this.transport;
  }

  private handleLine(line: string): void {
    let message: BridgeMessage;
    try {
      message = JSON.parse(line) as BridgeMessage;
    } catch {
      return; // Build output from `dotnet run` and similar. Not ours.
    }
    if (typeof message !== "object" || message === null) return;

    if (message.id !== undefined) {
      const waiter = this.waiters.get(message.id);
      if (!waiter) return;
      this.waiters.delete(message.id);
      if (message.ok) waiter.resolve(message.data);
      else waiter.reject(new Error(message.error ?? "The Bluetooth bridge failed."));
      return;
    }

    switch (message.event) {
      case "connected": {
        // Ignored when no one is listening or a connection is already open.
        if (!this.incoming || this.active) return;
        const socket = new RfcommSocket(this);
        this.active = socket;
        this.incoming(socket, { name: message.name ?? "", address: message.address ?? "" });
        return;
      }
      case "data":
        this.active?.receive(Buffer.from(typeof message.data === "string" ? message.data : "", "base64"));
        return;
      case "closed": {
        const socket = this.active;
        const reason = message.reason ?? "end";
        if (socket) {
          this.active = null;
          socket.finish(CLEAN_REASONS.has(reason) ? undefined : new Error(reason));
        }
        return;
      }
      case "error":
        this.onFailure(message.message ?? "Bluetooth error");
        return;
      default:
        return;
    }
  }

  private handleExit(reason: string): void {
    this.transport = null;
    this.incoming = null;
    for (const waiter of this.waiters.values()) waiter.reject(new Error(reason));
    this.waiters.clear();
    const socket = this.active;
    this.active = null;
    socket?.finish(new Error(reason));
    if (!this.disposed) this.onFailure(reason);
  }
}

/**
 * A ByteSocket over the bridge. Phones send one base64 line per protocol frame, so this
 * collects the raw bytes, splits them into lines, and decodes each line into one frame.
 */
export class RfcommSocket implements ByteSocket {
  private text = "";
  private decoder = new TextDecoder();
  private queued: Uint8Array[] = [];
  private dataHandler: ((data: Uint8Array) => void) | null = null;
  private closeHandler: ((error?: Error) => void) | null = null;
  private closed = false;

  constructor(private bridge: BluetoothBridge) {}

  write(data: Uint8Array): void {
    if (this.closed) throw new Error("Bluetooth connection is closed");
    this.bridge.command({ cmd: "write", text: encodeLine(data) });
  }

  close(): void {
    if (this.closed) return;
    this.bridge.command({ cmd: "close" });
    this.finish();
  }

  onData(handler: (data: Uint8Array) => void): void {
    this.dataHandler = handler;
    for (const frame of this.queued) handler(frame);
    this.queued = [];
  }

  onClose(handler: (error?: Error) => void): void {
    this.closeHandler = handler;
  }

  /** Raw bytes from the bridge. May hold part of a line, or several lines. */
  receive(bytes: Uint8Array): void {
    if (this.closed) return;
    this.text += this.decoder.decode(bytes, { stream: true });
    let end = this.text.indexOf("\n");
    while (end >= 0) {
      const line = this.text.slice(0, end).trim();
      this.text = this.text.slice(end + 1);
      end = this.text.indexOf("\n");
      if (line.length === 0) continue;
      let frame: Uint8Array;
      try {
        frame = decodeBase64(line);
      } catch {
        this.bridge.command({ cmd: "close" });
        this.finish(new Error("Bad Bluetooth frame"));
        return;
      }
      if (this.dataHandler) this.dataHandler(frame);
      else this.queued.push(frame);
    }
  }

  /** Marks the socket closed and tells the protocol layer. Safe to call more than once. */
  finish(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.bridge.release(this);
    this.closeHandler?.(error);
  }
}
