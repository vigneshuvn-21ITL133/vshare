import { HELLO_TIMEOUT_MS, MAX_FRAME_BYTES, PROTOCOL_VERSION } from "./constants.js";
import { safeRelativeSegments } from "./paths.js";
import { Connection, type ByteSocket, type IncomingChunk } from "./connection.js";
import { chunkCountFor, type FileSink } from "./files.js";
import {
  bytesToHex,
  decryptChunk,
  deriveSession,
  generateKeypair,
  randomHex,
  sha256,
  type Keypair,
  type SessionKeys,
} from "./crypto.js";
import type { ControlMessage, DeviceInfo, FileEndMessage, FileMeta, Hello, Offer } from "./messages.js";

export type ReceiveState =
  | "waiting"
  | "verifying"
  | "offer"
  | "receiving"
  | "paused"
  | "done"
  | "declined"
  | "cancelled"
  | "error";

export interface ReceiveProgress {
  transferId: string;
  fileIndex: number;
  fileCount: number;
  fileName: string;
  fileBytes: number;
  fileSize: number;
  bytesReceived: number;
  totalBytes: number;
}

export interface ReceiverOptions {
  device: DeviceInfo;
  /**
   * Decide whether a connecting sender may proceed. Called once per connection,
   * after HELLO. Typically checks a pairing token or a trusted-device list.
   */
  authorize: (hello: Hello) => boolean;
  /** Ask the user whether to accept an offer. Resolve true to accept. */
  onOffer: (offer: Offer, context: { sender: DeviceInfo; verificationCode: string }) => Promise<boolean>;
  /** Create the destination for a file. Called once per file, after acceptance. */
  openSink: (meta: FileMeta, transferId: string) => Promise<FileSink>;
  onState?: (state: ReceiveState, detail?: { verificationCode?: string; sender?: DeviceInfo; reason?: string; error?: string }) => void;
  onProgress?: (progress: ReceiveProgress) => void;
  onFileComplete?: (meta: FileMeta, location: string) => void;
}

export interface ReceivedFile {
  meta: FileMeta;
  location: string;
}

export type ReceiveResult =
  | { state: "done"; files: ReceivedFile[] }
  | { state: "declined"; reason: string }
  | { state: "cancelled" }
  | { state: "error"; error: string };

interface ActiveFile {
  meta: FileMeta;
  sink: FileSink;
  hasher: ReturnType<typeof sha256.create>;
  expectedIndex: number;
  bytes: number;
}

interface ActiveTransfer {
  transferId: string;
  files: Map<string, FileMeta>;
  totalBytes: number;
  receivedBytes: number;
  current?: ActiveFile;
  completed: ReceivedFile[];
}

/**
 * Receives one connection's worth of files. Chunks and FILE_END messages are
 * processed strictly in arrival order through an internal queue, so the
 * hash and sink writes never interleave.
 */
export class Receiver {
  private connection: Connection;
  private keypair: Keypair;
  private localNonce = randomHex(16);
  private session?: SessionKeys;
  private peer?: DeviceInfo;
  private transfer?: ActiveTransfer;
  private queue: Promise<void> = Promise.resolve();
  private helloTimer?: ReturnType<typeof setTimeout>;
  private finished = false;
  private outcome: Promise<ReceiveResult>;
  private resolveOutcome!: (result: ReceiveResult) => void;

  constructor(
    socket: ByteSocket,
    private options: ReceiverOptions,
  ) {
    this.connection = new Connection(socket);
    this.keypair = generateKeypair();
    this.outcome = new Promise((resolve) => (this.resolveOutcome = resolve));
    this.connection.onMessage((message) => this.handleMessage(message));
    this.connection.onChunk((chunk) => this.enqueue(() => this.handleChunk(chunk)));
    this.connection.onClose((error) => this.onConnectionClosed(error));
  }

  start(): Promise<ReceiveResult> {
    this.emit("waiting");
    this.helloTimer = setTimeout(() => {
      if (!this.session) this.finish({ state: "error", error: "sender did not say hello in time" });
    }, HELLO_TIMEOUT_MS);
    return this.outcome;
  }

  /** Asks the sender to pause, for example from a Pause button on this device. */
  pause(): void {
    if (this.finished || this.connection.isClosed || !this.transfer) return;
    this.connection.sendControl({ type: "PAUSE", transferId: this.transfer.transferId });
    this.emit("paused");
  }

  resume(): void {
    if (this.finished || this.connection.isClosed || !this.transfer) return;
    this.connection.sendControl({ type: "RESUME", transferId: this.transfer.transferId });
    this.emit("receiving");
  }

  /** Cancels the transfer, discards partial files, and closes the connection. */
  cancel(reason = "cancelled by receiver"): void {
    if (this.finished) return;
    if (!this.connection.isClosed && this.transfer) {
      this.connection.sendControl({ type: "CANCEL", transferId: this.transfer.transferId, reason });
    }
    this.finish({ state: "cancelled" });
  }

  private handleMessage(message: ControlMessage): void {
    if (this.finished) return;

    switch (message.type) {
      case "HELLO":
        this.onHello(message);
        return;
      case "OFFER":
        this.enqueue(() => this.onOffer(message));
        return;
      case "FILE_END":
        this.enqueue(() => this.onFileEnd(message));
        return;
      case "CANCEL":
        if (!this.transfer || message.transferId === this.transfer.transferId) {
          this.finish({ state: "cancelled" });
        }
        return;
      case "PAUSE":
        this.emit("paused");
        return;
      case "RESUME":
        this.emit("receiving");
        return;
      case "PING":
        this.connection.sendControl({ type: "PONG" });
        return;
      default:
        // ACCEPT, REJECT, CHUNK_ACK, COMPLETE and PONG are sender-bound; ignore.
        return;
    }
  }

  private onHello(hello: Hello): void {
    if (this.session || this.peer) return;
    if (this.helloTimer) clearTimeout(this.helloTimer);

    if (hello.version !== PROTOCOL_VERSION) {
      this.reject(`unsupported protocol version ${hello.version}`);
      return;
    }
    if (!this.options.authorize(hello)) {
      this.reject("not authorized: check the pairing code or trust this device first");
      return;
    }

    this.peer = hello.device;
    this.connection.sendControl({
      type: "HELLO",
      version: PROTOCOL_VERSION,
      device: this.options.device,
      pubKey: this.keypair.publicKeyHex,
      nonce: this.localNonce,
    });
    this.session = deriveSession(this.keypair, hello.pubKey, this.localNonce, hello.nonce);
    this.emit("verifying", { verificationCode: this.session.verificationCode, sender: hello.device });
  }

  private reject(reason: string): void {
    this.connection.sendControl({ type: "REJECT", reason });
    this.finish({ state: "declined", reason });
  }

  private async onOffer(offer: Offer): Promise<void> {
    if (!this.session || !this.peer) throw new Error("offer before handshake");
    if (this.transfer) throw new Error("a transfer is already in progress");
    this.validateOffer(offer);

    this.emit("offer", { sender: this.peer, verificationCode: this.session.verificationCode });
    const accepted = await this.options.onOffer(offer, {
      sender: this.peer,
      verificationCode: this.session.verificationCode,
    });

    if (this.finished) return;
    if (!accepted) {
      this.connection.sendControl({ type: "REJECT", transferId: offer.transferId, reason: "declined by receiver" });
      this.finish({ state: "declined", reason: "declined by receiver" });
      return;
    }

    this.transfer = {
      transferId: offer.transferId,
      files: new Map(offer.files.map((file) => [file.id, file])),
      totalBytes: offer.totalBytes,
      receivedBytes: 0,
      completed: [],
    };
    this.connection.sendControl({ type: "ACCEPT", transferId: offer.transferId });
    this.emit("receiving");
  }

  private validateOffer(offer: Offer): void {
    const total = offer.files.reduce((sum, file) => sum + file.size, 0);
    if (total !== offer.totalBytes) throw new Error("offer totalBytes does not match its files");

    for (const file of offer.files) {
      if (!safeRelativeSegments(file.name)) throw new Error(`unsafe file name in offer: ${file.name}`);
      if (file.chunkSize > MAX_FRAME_BYTES / 2) throw new Error("chunk size too large");
      if (file.chunkCount !== chunkCountFor(file.size, file.chunkSize)) {
        throw new Error(`chunk count for ${file.name} is inconsistent`);
      }
    }
    const ids = new Set(offer.files.map((file) => file.id));
    if (ids.size !== offer.files.length) throw new Error("duplicate file ids in offer");
  }

  private async handleChunk(chunk: IncomingChunk): Promise<void> {
    if (this.finished) return;
    const session = this.session;
    const transfer = this.transfer;
    if (!session || !transfer) throw new Error("chunk without an accepted offer");

    const { header } = chunk;
    if (header.transferId !== transfer.transferId) throw new Error("chunk for an unknown transfer");
    const meta = transfer.files.get(header.fileId);
    if (!meta || meta.index !== header.fileIndex) throw new Error("chunk for an unknown file");
    if (header.index >= meta.chunkCount) throw new Error("chunk index out of range");

    let active = transfer.current;
    if (active && active.meta.id !== meta.id) throw new Error("file ended without FILE_END");
    if (!active) active = await this.openActiveFile(transfer, meta);
    if (header.index !== active.expectedIndex) throw new Error("chunk arrived out of order");

    const plaintext = decryptChunk(session.key, header, chunk.headerBytes, chunk.ciphertext);
    if (plaintext.length > meta.chunkSize) throw new Error("chunk larger than declared size");

    await active.sink.write(plaintext);
    active.hasher.update(plaintext);
    active.expectedIndex += 1;
    active.bytes += plaintext.length;
    transfer.receivedBytes += plaintext.length;

    this.connection.sendControl({
      type: "CHUNK_ACK",
      transferId: transfer.transferId,
      fileId: meta.id,
      index: header.index,
    });
    this.emitProgress(transfer, active);
  }

  private async onFileEnd(end: FileEndMessage): Promise<void> {
    const transfer = this.transfer;
    if (!transfer) throw new Error("FILE_END without a transfer");
    const meta = transfer.files.get(end.fileId);
    if (!meta) throw new Error("FILE_END for an unknown file");

    let active = transfer.current;
    if (active && active.meta.id !== meta.id) throw new Error("FILE_END for the wrong file");
    if (!active) active = await this.openActiveFile(transfer, meta);

    const digest = bytesToHex(active.hasher.digest());
    const complete = active.expectedIndex === end.chunkCount && end.chunkCount === meta.chunkCount;
    const hashMatches = digest === meta.sha256 && end.sha256 === meta.sha256;

    if (!complete || !hashMatches) {
      await active.sink.abort().catch(() => undefined);
      transfer.current = undefined;
      const reason = !complete ? "missing chunks" : "hash mismatch";
      this.connection.sendControl({ type: "COMPLETE", transferId: transfer.transferId, fileId: meta.id, ok: false, reason });
      this.finish({ state: "error", error: `${meta.name}: ${reason}` });
      return;
    }

    const location = await active.sink.finish();
    transfer.current = undefined;
    transfer.completed.push({ meta, location });
    this.options.onFileComplete?.(meta, location);
    this.connection.sendControl({ type: "COMPLETE", transferId: transfer.transferId, fileId: meta.id, ok: true });

    if (transfer.completed.length === transfer.files.size) {
      this.finish({ state: "done", files: transfer.completed });
    }
  }

  private async openActiveFile(transfer: ActiveTransfer, meta: FileMeta): Promise<ActiveFile> {
    const sink = await this.options.openSink(meta, transfer.transferId);
    const active: ActiveFile = { meta, sink, hasher: sha256.create(), expectedIndex: 0, bytes: 0 };
    transfer.current = active;
    return active;
  }

  private emitProgress(transfer: ActiveTransfer, active: ActiveFile): void {
    const fileIndex = active.meta.index;
    const fileCount = transfer.files.size;
    this.options.onProgress?.({
      transferId: transfer.transferId,
      fileIndex,
      fileCount,
      fileName: active.meta.name,
      fileBytes: active.bytes,
      fileSize: active.meta.size,
      bytesReceived: transfer.receivedBytes,
      totalBytes: transfer.totalBytes,
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue
      .then(() => {
        if (this.finished) return;
        return task();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!this.finished) {
          if (!this.connection.isClosed && this.transfer) {
            this.connection.sendControl({ type: "CANCEL", transferId: this.transfer.transferId, reason: message });
          }
          this.finish({ state: "error", error: message });
        }
      });
  }

  private onConnectionClosed(error?: Error): void {
    if (this.finished) return;
    this.finish({ state: "error", error: error?.message ?? "connection closed before the transfer finished" });
  }

  private emit(state: ReceiveState, detail?: { verificationCode?: string; sender?: DeviceInfo; reason?: string; error?: string }): void {
    this.options.onState?.(state, detail);
  }

  private finish(result: ReceiveResult): void {
    if (this.finished) return;
    this.finished = true;
    if (this.helloTimer) clearTimeout(this.helloTimer);

    const active = this.transfer?.current;
    if (active && result.state !== "done") {
      void active.sink.abort().catch(() => undefined);
      this.transfer!.current = undefined;
    }
    if (!this.connection.isClosed) this.connection.close();

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
