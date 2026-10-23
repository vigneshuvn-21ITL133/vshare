import { CHUNK_SIZE, HELLO_TIMEOUT_MS, PROTOCOL_VERSION, WINDOW_SIZE } from "./constants.js";
import { Connection, type ByteSocket } from "./connection.js";
import { chunkCountFor, hashSource, type FileSource } from "./files.js";
import { deriveSession, encryptChunk, generateKeypair, randomHex, type Keypair, type SessionKeys } from "./crypto.js";
import type { ChunkHeader, ControlMessage, DeviceInfo, FileMeta } from "./messages.js";

const encoder = new TextEncoder();

export type SendState =
  | "preparing"
  | "connecting"
  | "verifying"
  | "waiting"
  | "sending"
  | "paused"
  | "done"
  | "declined"
  | "cancelled"
  | "error";

export interface SendProgress {
  transferId: string;
  fileIndex: number;
  fileCount: number;
  fileName: string;
  fileBytes: number;
  fileSize: number;
  bytesSent: number;
  totalBytes: number;
}

export interface SenderOptions {
  device: DeviceInfo;
  files: FileSource[];
  /** Token from the receiver's QR code. Omit for manual IP connections. */
  pairToken?: string;
  chunkSize?: number;
  onState?: (state: SendState, detail?: { verificationCode?: string; reason?: string; error?: string }) => void;
  onProgress?: (progress: SendProgress) => void;
}

export type SendResult =
  | { state: "done" }
  | { state: "declined"; reason: string }
  | { state: "cancelled" }
  | { state: "error"; error: string };

type WaitedType = ControlMessage["type"];
type Narrowed<T extends WaitedType> = Extract<ControlMessage, { type: T }>;

interface Waiter {
  types: readonly WaitedType[];
  match?: (message: ControlMessage) => boolean;
  resolve: (message: ControlMessage) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Counting semaphore for the in-flight chunk window. */
class SendWindow {
  private free: number;
  private waiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

  constructor(size: number) {
    this.free = size;
  }

  acquire(): Promise<void> {
    if (this.free > 0) {
      this.free -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  release(): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve();
    else this.free += 1;
  }

  /** Waits until every in-flight chunk is acknowledged. */
  async drain(size: number): Promise<void> {
    for (let i = 0; i < size; i++) await this.acquire();
    for (let i = 0; i < size; i++) this.release();
  }

  abort(error: Error): void {
    const pending = this.waiters;
    this.waiters = [];
    pending.forEach((waiter) => waiter.reject(error));
  }
}

/**
 * Sends one or more files to a receiver over an established socket.
 * Resolves with the outcome; never rejects.
 */
export class Sender {
  readonly transferId = randomHex(16);

  private connection: Connection;
  private keypair: Keypair;
  private localNonce = randomHex(16);
  private session?: SessionKeys;
  private window = new SendWindow(WINDOW_SIZE);
  private metas: FileMeta[] = [];
  private waiters: Waiter[] = [];
  private pauseGate?: { promise: Promise<void>; release: () => void };
  private finished = false;
  private outcome: Promise<SendResult>;
  private resolveOutcome!: (result: SendResult) => void;

  constructor(
    socket: ByteSocket,
    private options: SenderOptions,
  ) {
    this.connection = new Connection(socket);
    this.keypair = generateKeypair();
    this.outcome = new Promise((resolve) => (this.resolveOutcome = resolve));
    this.connection.onMessage((message) => this.handleMessage(message));
    this.connection.onClose((error) => this.finish({ state: "error", error: error?.message ?? "connection closed" }));
  }

  start(): Promise<SendResult> {
    void this.run();
    return this.outcome;
  }

  /** Pauses sending. The receiver is told so its UI can reflect it. */
  pause(): void {
    this.setPaused(true, false);
  }

  resume(): void {
    this.setPaused(false, false);
  }

  cancel(reason = "cancelled by sender"): void {
    if (this.finished) return;
    if (!this.connection.isClosed) {
      this.connection.sendControl({ type: "CANCEL", transferId: this.transferId, reason });
    }
    this.finish({ state: "cancelled" });
  }

  private async run(): Promise<void> {
    try {
      const { files } = this.options;
      if (files.length === 0) throw new Error("no files selected");
      const chunkSize = this.options.chunkSize ?? CHUNK_SIZE;

      this.emit("preparing");
      this.metas = [];
      for (const [index, file] of files.entries()) {
        this.metas.push({
          id: `f${index}`,
          index,
          name: file.name,
          size: file.size,
          mime: file.mime,
          sha256: await hashSource(file, chunkSize),
          chunkSize,
          chunkCount: chunkCountFor(file.size, chunkSize),
        });
      }

      this.emit("connecting");
      this.connection.sendControl({
        type: "HELLO",
        version: PROTOCOL_VERSION,
        device: this.options.device,
        pubKey: this.keypair.publicKeyHex,
        nonce: this.localNonce,
        pairToken: this.options.pairToken,
      });
      const reply = await this.waitFor(["HELLO", "REJECT"], { timeoutMs: HELLO_TIMEOUT_MS });
      if (reply.type === "REJECT") {
        this.finish({ state: "declined", reason: reply.reason });
        return;
      }

      this.session = deriveSession(this.keypair, reply.pubKey, this.localNonce, reply.nonce);
      this.emit("verifying", { verificationCode: this.session.verificationCode });

      const totalBytes = this.metas.reduce((sum, meta) => sum + meta.size, 0);
      this.connection.sendControl({ type: "OFFER", transferId: this.transferId, files: this.metas, totalBytes });

      this.emit("waiting");
      const decision = await this.waitFor(["ACCEPT", "REJECT"]);
      if (decision.type === "REJECT") {
        this.finish({ state: "declined", reason: decision.reason });
        return;
      }

      this.emit("sending");
      await this.sendAllFiles(chunkSize);
      this.finish({ state: "done" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.connection.isClosed && !this.finished) {
        this.connection.sendControl({ type: "CANCEL", transferId: this.transferId, reason: message });
      }
      this.finish({ state: "error", error: message });
    }
  }

  private async sendAllFiles(chunkSize: number): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("no session");

    for (const [fileIndex, file] of this.options.files.entries()) {
      const meta = this.metas[fileIndex];
      let bytesSent = 0;

      for (let index = 0; index < meta.chunkCount; index++) {
        await this.waitWhilePaused();
        await this.window.acquire();

        const offset = index * chunkSize;
        const length = Math.min(chunkSize, meta.size - offset);
        const plaintext = await file.read(offset, length);
        if (plaintext.length !== length) throw new Error(`short read on ${file.name}`);

        const header: ChunkHeader = { transferId: this.transferId, fileId: meta.id, fileIndex, index };
        const headerBytes = encoder.encode(JSON.stringify(header));
        const ciphertext = encryptChunk(session.key, header, headerBytes, plaintext);
        this.connection.sendChunk(headerBytes, ciphertext);

        bytesSent += length;
        this.emitProgress(fileIndex, file, bytesSent);
      }

      await this.window.drain(WINDOW_SIZE);
      this.connection.sendControl({
        type: "FILE_END",
        transferId: this.transferId,
        fileId: meta.id,
        chunkCount: meta.chunkCount,
        sha256: meta.sha256,
      });

      const complete = await this.waitFor(["COMPLETE"], {
        match: (message) => message.type === "COMPLETE" && message.fileId === meta.id,
      });
      if (complete.type === "COMPLETE" && !complete.ok) {
        throw new Error(complete.reason ?? `receiver could not save ${file.name}`);
      }
    }
  }

  private handleMessage(message: ControlMessage): void {
    if (this.finished) return;

    switch (message.type) {
      case "CHUNK_ACK":
        if (message.transferId === this.transferId) this.window.release();
        return;
      case "CANCEL":
        if (message.transferId === this.transferId) {
          this.finish({ state: "cancelled" });
        }
        return;
      case "PAUSE":
        this.setPaused(true, true);
        return;
      case "RESUME":
        this.setPaused(false, true);
        return;
      case "PING":
        this.connection.sendControl({ type: "PONG" });
        return;
      default:
        break;
    }

    const index = this.waiters.findIndex(
      (waiter) => waiter.types.includes(message.type) && (!waiter.match || waiter.match(message)),
    );
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1);
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  private waitFor<T extends WaitedType>(
    types: readonly T[],
    options: { timeoutMs?: number; match?: (message: ControlMessage) => boolean } = {},
  ): Promise<Narrowed<T>> {
    return new Promise<Narrowed<T>>((resolve, reject) => {
      const waiter: Waiter = {
        types,
        match: options.match,
        resolve: (message) => resolve(message as Narrowed<T>),
        reject,
      };
      if (options.timeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new Error("timed out waiting for the receiver"));
        }, options.timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  private setPaused(paused: boolean, fromPeer: boolean): void {
    if (this.finished) return;
    if (paused && !this.pauseGate) {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => (release = resolve));
      this.pauseGate = { promise, release };
      this.emit("paused");
      if (!fromPeer) this.connection.sendControl({ type: "PAUSE", transferId: this.transferId });
    } else if (!paused && this.pauseGate) {
      this.pauseGate.release();
      this.pauseGate = undefined;
      this.emit("sending");
      if (!fromPeer) this.connection.sendControl({ type: "RESUME", transferId: this.transferId });
    }
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.pauseGate) {
      await this.pauseGate.promise;
    }
  }

  private emit(state: SendState, detail?: { verificationCode?: string; reason?: string; error?: string }): void {
    this.options.onState?.(state, detail);
  }

  private emitProgress(fileIndex: number, file: FileSource, bytesSent: number): void {
    const totalBytes = this.metas.reduce((sum, meta) => sum + meta.size, 0);
    const bytesBefore = this.metas.slice(0, fileIndex).reduce((sum, meta) => sum + meta.size, 0);
    this.options.onProgress?.({
      transferId: this.transferId,
      fileIndex,
      fileCount: this.metas.length,
      fileName: file.name,
      fileBytes: bytesSent,
      fileSize: file.size,
      bytesSent: bytesBefore + bytesSent,
      totalBytes,
    });
  }

  private finish(result: SendResult): void {
    if (this.finished) return;
    this.finished = true;

    const error = new Error("transfer finished");
    this.window.abort(error);
    this.waiters.forEach((waiter) => {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(error);
    });
    this.waiters = [];
    this.pauseGate?.release();
    this.pauseGate = undefined;

    if (result.state === "done" || result.state === "declined") {
      this.connection.close();
    } else if (!this.connection.isClosed) {
      this.connection.close();
    }

    switch (result.state) {
      case "done":
        this.emit("done");
        break;
      case "declined":
        this.emit("declined", { reason: result.reason });
        break;
      case "cancelled":
        this.emit("cancelled");
        break;
      case "error":
        this.emit("error", { error: result.error });
        break;
    }
    this.resolveOutcome(result);
  }
}
