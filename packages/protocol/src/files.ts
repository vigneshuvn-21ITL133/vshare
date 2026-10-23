import { bytesToHex, sha256 } from "./crypto.js";

/**
 * A file the sender can read from. Implemented by the desktop (fs) and the mobile
 * app (expo-file-system), so the protocol never touches a file system directly.
 */
export interface FileSource {
  readonly name: string;
  readonly size: number;
  readonly mime: string;
  /** Returns exactly `length` bytes starting at `offset`. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * A file the receiver writes to. `finish()` makes the content final and returns a
 * human-readable location (a path or URI). `abort()` discards partial content.
 */
export interface FileSink {
  write(data: Uint8Array): Promise<void>;
  finish(): Promise<string>;
  abort(): Promise<void>;
}

export function chunkCountFor(size: number, chunkSize: number): number {
  return Math.ceil(size / chunkSize);
}

/** Expected plaintext length for a zero-based chunk index. */
export function chunkLengthFor(size: number, chunkSize: number, index: number): number {
  return Math.min(chunkSize, Math.max(0, size - index * chunkSize));
}

/** Streams the whole source through SHA-256 without holding it in memory. */
export async function hashSource(source: FileSource, chunkSize: number): Promise<string> {
  const hasher = sha256.create();
  for (let offset = 0; offset < source.size; offset += chunkSize) {
    const length = Math.min(chunkSize, source.size - offset);
    const bytes = await source.read(offset, length);
    if (bytes.length !== length) {
      throw new Error(`short read while hashing ${source.name}`);
    }
    hasher.update(bytes);
  }
  return bytesToHex(hasher.digest());
}
