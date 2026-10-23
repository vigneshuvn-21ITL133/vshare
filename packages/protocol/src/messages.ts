import { z } from "zod";

export const DevicePlatform = z.enum(["windows", "android", "other"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

export const DeviceInfo = z.object({
  id: z.string().min(8).max(128),
  name: z.string().min(1).max(64),
  platform: DevicePlatform,
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const FileMeta = z.object({
  id: z.string().min(1).max(64),
  index: z.number().int().nonnegative(),
  /** File name, or a relative path such as "photos/2026/a.jpg" when a folder was sent. */
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative(),
  mime: z.string().max(255),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  chunkSize: z.number().int().positive(),
  chunkCount: z.number().int().nonnegative(),
});
export type FileMeta = z.infer<typeof FileMeta>;

const transferId = z.string().min(8).max(64);

export const Hello = z.object({
  type: z.literal("HELLO"),
  version: z.number().int(),
  device: DeviceInfo,
  /** X25519 public key, hex. */
  pubKey: z.string().regex(/^[0-9a-f]{64}$/),
  /** Random per-connection nonce, hex. Feeds the session key salt. */
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  /** Pairing token from the receiver's QR code, if the sender scanned one. */
  pairToken: z.string().regex(/^[0-9a-f]{32}$/).optional(),
});
export type Hello = z.infer<typeof Hello>;

export const Offer = z.object({
  type: z.literal("OFFER"),
  transferId,
  files: z.array(FileMeta).min(1).max(10_000),
  totalBytes: z.number().int().nonnegative(),
});
export type Offer = z.infer<typeof Offer>;

export const Accept = z.object({ type: z.literal("ACCEPT"), transferId });
export const Reject = z.object({
  type: z.literal("REJECT"),
  transferId: transferId.optional(),
  reason: z.string().max(200),
});

export const ChunkAck = z.object({
  type: z.literal("CHUNK_ACK"),
  transferId,
  fileId: z.string(),
  index: z.number().int().nonnegative(),
});

/** Sent by the sender after the last chunk of a file. Lets the receiver verify. */
export const FileEnd = z.object({
  type: z.literal("FILE_END"),
  transferId,
  fileId: z.string(),
  chunkCount: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type FileEndMessage = z.infer<typeof FileEnd>;

export const Complete = z.object({
  type: z.literal("COMPLETE"),
  transferId,
  fileId: z.string(),
  ok: z.boolean(),
  reason: z.string().max(200).optional(),
});

export const Control = z.object({
  type: z.enum(["PAUSE", "RESUME", "CANCEL"]),
  transferId,
  reason: z.string().max(200).optional(),
});

export const Ping = z.object({ type: z.literal("PING") });
export const Pong = z.object({ type: z.literal("PONG") });

export const ControlMessage = z.discriminatedUnion("type", [
  Hello,
  Offer,
  Accept,
  Reject,
  ChunkAck,
  FileEnd,
  Complete,
  Control,
  Ping,
  Pong,
]);
export type ControlMessage = z.infer<typeof ControlMessage>;

/** Header carried in clear (and authenticated as AAD) in front of each chunk. */
export const ChunkHeader = z.object({
  transferId,
  fileId: z.string(),
  fileIndex: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
});
export type ChunkHeader = z.infer<typeof ChunkHeader>;

/** Parse an untrusted JSON value. Returns null if it is not a valid message. */
export function parseControl(value: unknown): ControlMessage | null {
  const result = ControlMessage.safeParse(value);
  return result.success ? result.data : null;
}
