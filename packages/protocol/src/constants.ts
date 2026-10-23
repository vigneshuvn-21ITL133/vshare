/** Wire protocol version. Bumped only for incompatible changes. */
export const PROTOCOL_VERSION = 1;

/** Default TCP port a V_share device listens on. */
export const DEFAULT_PORT = 47800;

/** Plaintext bytes per encrypted chunk (1 MiB). */
export const CHUNK_SIZE = 1024 * 1024;

/** Maximum chunks awaiting acknowledgement at once. */
export const WINDOW_SIZE = 4;

/** Largest frame body accepted from a peer. Guards against memory exhaustion. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** Time a peer has to answer HELLO before the connection is dropped. */
export const HELLO_TIMEOUT_MS = 10_000;

/** Lifetime of a pairing token shown in a QR code. */
export const PAIR_TOKEN_TTL_MS = 2 * 60 * 1000;

export const KDF_INFO_SESSION = "vshare/v1 session key";
export const KDF_INFO_VERIFY = "vshare/v1 verification code";
