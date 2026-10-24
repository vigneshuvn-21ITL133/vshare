import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { decodeBase64, encodeBase64, encodeLine, LINE_DELIMITER } from "../src/lineCodec.js";
import { randomBytesOf } from "./helpers.js";

describe("base64 for text transports", () => {
  it("matches the standard encoding for every length from 0 to 300", () => {
    for (let length = 0; length <= 300; length++) {
      const bytes = randomBytesOf(length, length + 1);
      expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  it("round-trips arbitrary bytes", () => {
    for (let length = 0; length <= 300; length++) {
      const bytes = randomBytesOf(length, length + 7);
      expect(Buffer.from(decodeBase64(encodeBase64(bytes)))).toEqual(Buffer.from(bytes));
    }
  });

  it("round-trips a large frame the size of a transfer chunk", () => {
    const bytes = randomBytesOf(1024 * 1024 + 17, 42);
    const decoded = decodeBase64(encodeBase64(bytes));
    expect(decoded.length).toBe(bytes.length);
    expect(Buffer.from(decoded).equals(Buffer.from(bytes))).toBe(true);
  });

  it("never produces the line delimiter", () => {
    for (let seed = 1; seed < 50; seed++) {
      expect(encodeBase64(randomBytesOf(400, seed))).not.toContain(LINE_DELIMITER);
    }
  });

  it("adds exactly one delimiter per frame", () => {
    const line = encodeLine(new Uint8Array([1, 2, 3]));
    expect(line.endsWith(LINE_DELIMITER)).toBe(true);
    expect(line.slice(0, -1)).toBe(encodeBase64(new Uint8Array([1, 2, 3])));
  });

  it("rejects malformed input", () => {
    expect(() => decodeBase64("abc")).toThrow();
    expect(() => decodeBase64("ab!d")).toThrow();
    expect(() => decodeBase64("=abc")).toThrow();
    expect(() => decodeBase64("ab=c")).toThrow();
  });
});
