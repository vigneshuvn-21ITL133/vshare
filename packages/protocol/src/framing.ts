import { MAX_FRAME_BYTES } from "./constants.js";

/**
 * Wire framing.
 *
 *   frame := length(u32 BE) kind(u8) body
 *   length counts kind + body.
 *
 *   kind 0x01 JSON  : body is a UTF-8 JSON control message.
 *   kind 0x02 CHUNK : body := headerLength(u32 BE) header(UTF-8 JSON) ciphertext
 *
 * Both Node's net module and react-native-tcp-socket deliver arbitrary byte
 * boundaries, so the decoder below buffers until whole frames are available.
 */

export const KIND_JSON = 0x01;
export const KIND_CHUNK = 0x02;

export interface Frame {
  kind: number;
  body: Uint8Array;
}

const encoder = new TextEncoder();

export function encodeFrame(kind: number, body: Uint8Array): Uint8Array {
  const length = body.length + 1;
  if (length > MAX_FRAME_BYTES) {
    throw new Error(`frame too large: ${length} bytes`);
  }
  const out = new Uint8Array(4 + length);
  const view = new DataView(out.buffer);
  view.setUint32(0, length, false);
  out[4] = kind;
  out.set(body, 5);
  return out;
}

export function encodeJsonFrame(message: unknown): Uint8Array {
  return encodeFrame(KIND_JSON, encoder.encode(JSON.stringify(message)));
}

/**
 * `headerBytes` must be the exact bytes that were authenticated as AAD when the
 * ciphertext was produced, so the sender serializes the header only once.
 */
export function encodeChunkFrame(headerBytes: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + headerBytes.length + ciphertext.length);
  const view = new DataView(body.buffer);
  view.setUint32(0, headerBytes.length, false);
  body.set(headerBytes, 4);
  body.set(ciphertext, 4 + headerBytes.length);
  return encodeFrame(KIND_CHUNK, body);
}

/** Splits a chunk frame body into its header bytes and ciphertext. */
export function splitChunkBody(body: Uint8Array): { headerBytes: Uint8Array; ciphertext: Uint8Array } {
  if (body.length < 4) throw new Error("chunk body too short");
  const headerLength = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, false);
  if (4 + headerLength > body.length) throw new Error("chunk header overruns body");
  return {
    headerBytes: body.subarray(4, 4 + headerLength),
    ciphertext: body.subarray(4 + headerLength),
  };
}

/** Incremental decoder. Feed it bytes as they arrive; it emits complete frames. */
export class FrameDecoder {
  private buffer: Uint8Array = new Uint8Array(0);

  push(data: Uint8Array, onFrame: (frame: Frame) => void): void {
    if (data.length === 0) return;
    this.buffer = concat(this.buffer, data);

    let offset = 0;
    while (this.buffer.length - offset >= 4) {
      const length = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset, 4).getUint32(0, false);
      if (length < 1 || length > MAX_FRAME_BYTES) {
        throw new Error(`invalid frame length ${length}`);
      }
      if (this.buffer.length - offset - 4 < length) break;

      const kind = this.buffer[offset + 4];
      const body = this.buffer.slice(offset + 5, offset + 4 + length);
      offset += 4 + length;
      onFrame({ kind, body });
    }

    this.buffer = offset === 0 ? this.buffer : this.buffer.slice(offset);
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b.slice();
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
