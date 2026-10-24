// Base64 for transports that only carry text, such as Bluetooth Classic through a
// string-based library. Each protocol write is sent as one base64 line ending in "\n".
// Base64 never contains "\n", so the line boundary is always safe.
// Plain JavaScript, so it runs in Node, Electron, and Hermes alike.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

/** The delimiter that ends each encoded frame on a text transport. */
export const LINE_DELIMITER = "\n";

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    parts.push(ALPHABET[(n >> 18) & 63], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63], ALPHABET[n & 63]);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    parts.push(ALPHABET[(n >> 18) & 63], ALPHABET[(n >> 12) & 63], "==");
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    parts.push(ALPHABET[(n >> 18) & 63], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63], "=");
  }
  return parts.join("");
}

/** Throws on anything that is not valid padded base64. */
export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new Error("invalid base64: length is not a multiple of 4");
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const outLength = (text.length / 4) * 3 - padding;
  const out = new Uint8Array(outLength);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const last = i + 4 === text.length;
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const code = text.charCodeAt(i + k);
      if (code === 61) {
        // "=" is only allowed as trailing padding in the final group.
        if (!last || k < 4 - padding) throw new Error("invalid base64: misplaced padding");
        n <<= 6;
        continue;
      }
      const value = code < 128 ? LOOKUP[code] : -1;
      if (value < 0) throw new Error("invalid base64: unexpected character");
      n = (n << 6) | value;
    }
    const bytes = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (const byte of bytes) {
      if (o < outLength) out[o++] = byte;
    }
  }
  return out;
}

/** One frame as a single line on a text transport. */
export function encodeLine(bytes: Uint8Array): string {
  return encodeBase64(bytes) + LINE_DELIMITER;
}
