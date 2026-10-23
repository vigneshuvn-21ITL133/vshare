import { describe, expect, it } from "vitest";
import {
  decryptChunk,
  deriveSession,
  encodePairUri,
  decodePairUri,
  encryptChunk,
  encodeJsonFrame,
  FrameDecoder,
  generateKeypair,
  randomHex,
  KIND_JSON,
  encodeChunkFrame,
  splitChunkBody,
  KIND_CHUNK,
  parseControl,
  hashSource,
  chunkCountFor,
  type ChunkHeader,
} from "../src/index.js";
import { bytesEqual, memorySource, randomBytesOf } from "./helpers.js";

describe("crypto", () => {
  it("derives the same session key and verification code on both ends", () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const aliceNonce = randomHex(16);
    const bobNonce = randomHex(16);

    const a = deriveSession(alice, bob.publicKeyHex, aliceNonce, bobNonce);
    const b = deriveSession(bob, alice.publicKeyHex, bobNonce, aliceNonce);

    expect(bytesEqual(a.key, b.key)).toBe(true);
    expect(a.verificationCode).toBe(b.verificationCode);
    expect(a.key).toHaveLength(32);
  });

  it("round-trips a chunk and rejects any tampering with payload or header", () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const session = deriveSession(alice, bob.publicKeyHex, "aa".repeat(16), "bb".repeat(16));
    const header: ChunkHeader = { transferId: "t".repeat(16), fileId: "f0", fileIndex: 0, index: 3 };
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const plaintext = randomBytesOf(1000, 11);

    const ciphertext = encryptChunk(session.key, header, headerBytes, plaintext);
    expect(bytesEqual(decryptChunk(session.key, header, headerBytes, ciphertext), plaintext)).toBe(true);

    const flipped = ciphertext.slice();
    flipped[0] ^= 1;
    expect(() => decryptChunk(session.key, header, headerBytes, flipped)).toThrow();

    const otherHeader = new TextEncoder().encode(JSON.stringify({ ...header, index: 4 }));
    expect(() => decryptChunk(session.key, { ...header, index: 4 }, otherHeader, ciphertext)).toThrow();
  });
});

describe("framing", () => {
  it("reassembles frames split at arbitrary byte boundaries", () => {
    const message = { type: "PING" };
    const chunkHeader = new TextEncoder().encode('{"transferId":"x"}');
    const payload = randomBytesOf(5000, 5);
    const stream = new Uint8Array([
      ...encodeJsonFrame(message),
      ...encodeChunkFrame(chunkHeader, payload),
    ]);

    const frames: Array<{ kind: number; body: Uint8Array }> = [];
    const decoder = new FrameDecoder();
    for (let i = 0; i < stream.length; i += 7) {
      decoder.push(stream.subarray(i, i + 7), (frame) => frames.push(frame));
    }

    expect(frames.map((frame) => frame.kind)).toEqual([KIND_JSON, KIND_CHUNK]);
    const split = splitChunkBody(frames[1].body);
    expect(bytesEqual(split.headerBytes, chunkHeader)).toBe(true);
    expect(bytesEqual(split.ciphertext, payload)).toBe(true);
  });

  it("rejects a control message that does not match the schema", () => {
    expect(parseControl({ type: "NOT_A_MESSAGE" })).toBeNull();
    expect(parseControl({ type: "CHUNK_ACK", transferId: "short", fileId: "f0", index: 1 })).toBeNull();
    expect(parseControl({ type: "PING" })).toEqual({ type: "PING" });
  });
});

describe("files", () => {
  it("computes the same SHA-256 regardless of read size and counts chunks correctly", async () => {
    const bytes = randomBytesOf(3_000_001, 21);
    const source = memorySource("x.bin", bytes);
    const hashA = await hashSource(source, 1024 * 1024);
    const hashB = await hashSource(source, 4096);
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(chunkCountFor(3_000_001, 1024 * 1024)).toBe(3);
    expect(chunkCountFor(0, 1024 * 1024)).toBe(0);
  });
});

describe("pairing QR payload", () => {
  it("round-trips an invite and rejects malformed URIs", () => {
    const invite = { host: "192.168.1.23", port: 47800, token: "0123456789abcdef0123456789abcdef", name: "DESKTOP-01 & friends" };
    const uri = encodePairUri(invite);
    expect(uri.startsWith("vshare://pair?")).toBe(true);
    expect(decodePairUri(uri)).toEqual(invite);

    expect(decodePairUri("https://example.com")).toBeNull();
    expect(decodePairUri("vshare://pair?v=1&h=10.0.0.1&p=99999&t=0123456789abcdef0123456789abcdef&n=x")).toBeNull();
    expect(decodePairUri("vshare://pair?v=1&h=10.0.0.1&p=47800&t=short&n=x")).toBeNull();
  });
});
