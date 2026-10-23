import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes, bytesToHex, hexToBytes, concatBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { KDF_INFO_SESSION, KDF_INFO_VERIFY } from "./constants.js";
import type { ChunkHeader } from "./messages.js";

const encoder = new TextEncoder();

export { bytesToHex, hexToBytes, randomBytes, sha256 };

export interface Keypair {
  secretKey: Uint8Array;
  publicKeyHex: string;
}

/** Fresh ephemeral X25519 keypair. One per connection. */
export function generateKeypair(): Keypair {
  const secretKey = x25519.utils.randomSecretKey();
  return { secretKey, publicKeyHex: bytesToHex(x25519.getPublicKey(secretKey)) };
}

/** Random hex string of `byteLength` bytes. Used for ids, nonces, and tokens. */
export function randomHex(byteLength: number): string {
  return bytesToHex(randomBytes(byteLength));
}

/** Both sides derive the same salt because the two nonces are sorted first. */
function sessionSalt(nonceA: string, nonceB: string): Uint8Array {
  const [first, second] = nonceA < nonceB ? [nonceA, nonceB] : [nonceB, nonceA];
  return concatBytes(hexToBytes(first), hexToBytes(second));
}

function sortedPublicKeys(a: string, b: string): Uint8Array {
  const [first, second] = a < b ? [a, b] : [b, a];
  return concatBytes(hexToBytes(first), hexToBytes(second));
}

export interface SessionKeys {
  /** AES-256-GCM key for chunk payloads. */
  key: Uint8Array;
  /** Six-digit code both users compare on screen to detect a man-in-the-middle. */
  verificationCode: string;
}

/**
 * Derives the per-connection session key with X25519 + HKDF-SHA256.
 * `localNonce`/`remoteNonce` and public keys bind the key to this exact handshake.
 */
export function deriveSession(
  local: Keypair,
  remotePublicKeyHex: string,
  localNonce: string,
  remoteNonce: string,
): SessionKeys {
  const shared = x25519.getSharedSecret(local.secretKey, hexToBytes(remotePublicKeyHex));
  const salt = sessionSalt(localNonce, remoteNonce);
  const key = hkdf(sha256, shared, salt, encoder.encode(KDF_INFO_SESSION), 32);

  const verifyInput = concatBytes(
    encoder.encode(KDF_INFO_VERIFY),
    sortedPublicKeys(local.publicKeyHex, remotePublicKeyHex),
    shared,
  );
  const digest = sha256(verifyInput);
  const number = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false) % 1_000_000;
  return { key, verificationCode: number.toString().padStart(6, "0") };
}

/**
 * 12-byte GCM nonce: file index (u32 BE) followed by chunk index (u64 BE).
 * Unique per (key, file, chunk), which is what GCM requires.
 */
function chunkNonce(fileIndex: number, index: number): Uint8Array {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setUint32(0, fileIndex, false);
  view.setBigUint64(4, BigInt(index), false);
  return nonce;
}

/** Encrypts one chunk. The serialized header is authenticated as AAD. */
export function encryptChunk(
  key: Uint8Array,
  header: ChunkHeader,
  headerBytes: Uint8Array,
  plaintext: Uint8Array,
): Uint8Array {
  return gcm(key, chunkNonce(header.fileIndex, header.index), headerBytes).encrypt(plaintext);
}

/** Decrypts one chunk. Throws if the ciphertext or header was tampered with. */
export function decryptChunk(
  key: Uint8Array,
  header: ChunkHeader,
  headerBytes: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  return gcm(key, chunkNonce(header.fileIndex, header.index), headerBytes).decrypt(ciphertext);
}
