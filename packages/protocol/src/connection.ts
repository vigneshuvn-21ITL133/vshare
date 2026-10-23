import {
  FrameDecoder,
  KIND_CHUNK,
  KIND_JSON,
  encodeChunkFrame,
  encodeJsonFrame,
  splitChunkBody,
} from "./framing.js";
import { ChunkHeader, parseControl, type ControlMessage } from "./messages.js";

/**
 * Minimal byte-stream socket. Node's net.Socket and react-native-tcp-socket both
 * satisfy this through the small adapters in node.ts and in the mobile app.
 */
export interface ByteSocket {
  write(data: Uint8Array): void;
  /** Graceful close: pending writes are flushed first. */
  close(): void;
  onData(handler: (data: Uint8Array) => void): void;
  onClose(handler: (error?: Error) => void): void;
}

export interface IncomingChunk {
  header: ChunkHeader;
  headerBytes: Uint8Array;
  ciphertext: Uint8Array;
}

const decoder = new TextDecoder();

/**
 * A framed, typed connection over a ByteSocket. Emits parsed control messages
 * and raw (still encrypted) chunks. Encryption and transfer state live above it.
 */
export class Connection {
  private framer = new FrameDecoder();
  private messageHandlers = new Set<(message: ControlMessage) => void>();
  private chunkHandlers = new Set<(chunk: IncomingChunk) => void>();
  private closeHandlers = new Set<(error?: Error) => void>();
  private closed = false;

  constructor(private socket: ByteSocket) {
    socket.onData((data) => this.handleData(data));
    socket.onClose((error) => this.finish(error));
  }

  get isClosed(): boolean {
    return this.closed;
  }

  sendControl(message: ControlMessage): void {
    this.write(encodeJsonFrame(message));
  }

  sendChunk(headerBytes: Uint8Array, ciphertext: Uint8Array): void {
    this.write(encodeChunkFrame(headerBytes, ciphertext));
  }

  onMessage(handler: (message: ControlMessage) => void): void {
    this.messageHandlers.add(handler);
  }

  onChunk(handler: (chunk: IncomingChunk) => void): void {
    this.chunkHandlers.add(handler);
  }

  onClose(handler: (error?: Error) => void): void {
    this.closeHandlers.add(handler);
  }

  close(): void {
    if (this.closed) return;
    this.socket.close();
    this.finish();
  }

  private write(frame: Uint8Array): void {
    if (this.closed) throw new Error("connection is closed");
    this.socket.write(frame);
  }

  private handleData(data: Uint8Array): void {
    if (this.closed) return;
    try {
      this.framer.push(data, (frame) => {
        if (frame.kind === KIND_JSON) {
          const message = parseControl(JSON.parse(decoder.decode(frame.body)));
          if (!message) throw new Error("unrecognized control message");
          this.messageHandlers.forEach((handler) => handler(message));
        } else if (frame.kind === KIND_CHUNK) {
          const { headerBytes, ciphertext } = splitChunkBody(frame.body);
          const header = ChunkHeader.parse(JSON.parse(decoder.decode(headerBytes)));
          this.chunkHandlers.forEach((handler) => handler({ header, headerBytes, ciphertext }));
        } else {
          throw new Error(`unknown frame kind ${frame.kind}`);
        }
      });
    } catch (error) {
      // Malformed input is a protocol violation: drop the connection.
      const failure = error instanceof Error ? error : new Error(String(error));
      this.socket.close();
      this.finish(failure);
    }
  }

  private finish(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandlers.forEach((handler) => handler(error));
    this.messageHandlers.clear();
    this.chunkHandlers.clear();
    this.closeHandlers.clear();
  }
}
