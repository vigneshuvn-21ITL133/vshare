// Must be the first import of the app (see app/_layout.tsx).
// Hermes and React Native do not provide every browser/Node global the protocol uses.
import { Buffer } from "buffer";
import "fast-text-encoding";
import { getRandomValues } from "expo-crypto";

const globals = globalThis as unknown as {
  Buffer?: typeof Buffer;
  crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
};

if (!globals.Buffer) {
  globals.Buffer = Buffer;
}

if (!globals.crypto) {
  globals.crypto = {};
}
if (typeof globals.crypto.getRandomValues !== "function") {
  // noble-hashes/ciphers use crypto.getRandomValues for nonces and key generation.
  globals.crypto.getRandomValues = (array: Uint8Array) => getRandomValues(array);
}

export {};
