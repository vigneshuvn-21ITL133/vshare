import type { FileSink, FileSource } from "../src/files.js";

export function memorySource(name: string, bytes: Uint8Array, mime = "application/octet-stream"): FileSource {
  return {
    name,
    size: bytes.length,
    mime,
    read: async (offset, length) => bytes.slice(offset, offset + length),
  };
}

export interface MemoryStore {
  files: Map<string, Uint8Array>;
  aborted: string[];
}

export function memorySinkFactory(store: MemoryStore) {
  return async (meta: { name: string }): Promise<FileSink> => {
    const parts: Uint8Array[] = [];
    return {
      write: async (data) => {
        parts.push(data.slice());
      },
      finish: async () => {
        const total = parts.reduce((sum, part) => sum + part.length, 0);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
          out.set(part, offset);
          offset += part.length;
        }
        store.files.set(meta.name, out);
        return `mem://${meta.name}`;
      },
      abort: async () => {
        store.aborted.push(meta.name);
      },
    };
  };
}

export function randomBytesOf(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = state & 0xff;
  }
  return out;
}

export function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

/** Fast byte comparison. Vitest's toEqual on large typed arrays is very slow. */
export function bytesEqual(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
