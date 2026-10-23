# V_share wire protocol (v1)

This is the contract between the Windows app and the Android app. The code lives in
`packages/protocol/src`. This page describes it for anyone writing a third client.

## Transport

- TCP, one transfer per connection. The receiver listens on port `47800` by default.
- Every message is a frame:

```
frame := length(u32 BE) kind(u8) body
length counts kind + body. Maximum 16 MiB.

kind 0x01  JSON   body = UTF-8 JSON control message
kind 0x02  CHUNK  body = headerLength(u32 BE) header(UTF-8 JSON) ciphertext
```

Frames can split across reads, so decoders buffer until a whole frame arrives.

## Pairing and handshake

1. The receiver shows a pairing link (as a QR code):

   `vshare://pair?v=1&h=<host>&p=<port>&t=<token>&n=<device name>`

   `t` is a random 16-byte token. It is valid for 2 minutes and works once.
2. The sender connects and sends `HELLO` with its X25519 public key, a random nonce, and the token (if it scanned one).
3. The receiver checks the token. If the token is missing, it allows the connection only when "allow connections without scanning" is on. It then replies with its own `HELLO`. Both sides derive:
   - a 32-byte session key: HKDF-SHA256 over the X25519 shared secret, salted with both nonces;
   - a six-digit verification code computed from both public keys and the shared secret.
4. Both screens show the verification code. The receiver shows it again in the approval prompt, and the user must confirm the codes match.

## Messages

| Type | Direction | Body |
|---|---|---|
| `HELLO` | both | `version`, `device {id, name, platform}`, `pubKey`, `nonce`, `pairToken?` |
| `OFFER` | sender → receiver | `transferId`, `files[]` (`id`, `index`, `name`, `size`, `mime`, `sha256`, `chunkSize`, `chunkCount`), `totalBytes` |
| `ACCEPT` / `REJECT` | receiver → sender | `transferId?`, `reason` |
| `CHUNK` | sender → receiver | binary frame. The header `{transferId, fileId, fileIndex, index}` is also the AES-GCM associated data |
| `CHUNK_ACK` | receiver → sender | `transferId`, `fileId`, `index` |
| `FILE_END` | sender → receiver | `transferId`, `fileId`, `chunkCount`, `sha256` |
| `COMPLETE` | receiver → sender | `transferId`, `fileId`, `ok`, `reason?` |
| `PAUSE` / `RESUME` / `CANCEL` | either | `transferId`, `reason?` |
| `PING` / `PONG` | either | keep-alive |

## Encryption and integrity

- Chunk payloads use AES-256-GCM with the session key. The 12-byte nonce is `fileIndex` (u32 BE) followed by `chunkIndex` (u64 BE).
- Each file is also checked with SHA-256 from start to end. A mismatch fails that file and both sides are told.

## Rules

- Chunk size is 1 MiB. At most 4 chunks are unacknowledged at once.
- A protocol version mismatch is rejected in `HELLO`.
- The receiver writes each file to its download folder. If the name is taken, it adds a suffix. It deletes partial files on failure or cancel.
- **Resume after a dropped connection is not in v1.** A retry sends the files again.
- **Folder names.** `FileMeta.name` may be a relative path with `/` separators, for example `Trip/day1/a.txt`. A receiver checks every part: no empty parts, no `.` or `..`, no drive letters, no leading `/` or `\`, no control characters, and at most 512 characters in total. An offer with any unsafe name is rejected. Each receiver decides where the parts go; the desktop app creates folders under its download folder, and the Android app joins the parts into one file name.
- An offer carries 1 to 10,000 files.
