# V_share

Wireless file transfer between a Windows PC and an Android phone over your local WiFi. Pair by scanning a QR code, confirm a six-digit code on both screens, and send files encrypted end to end. No cloud, no accounts, no telemetry.

| Part | App name | Stack |
|---|---|---|
| Desktop | **V_share Desktop** (Windows) | Electron 45 + React 19 + TypeScript + Vite 8 |
| Mobile | **V_share Mobile** (Android) | React Native 0.86 + Expo **SDK 57** + expo-router |
| Shared | `@vshare/protocol` | TypeScript: framing, handshake, encryption, and transfer state machines |

Every device can **send**, **receive**, or do both.

---

## Status (v0.1)

| Area | Built | Verified here | Still to do |
|---|---|---|---|
| Protocol | Framing, X25519 + HKDF pairing, AES-256-GCM chunks, SHA-256 per file, send and receive state machines, relative folder names with traversal checks | 14 tests pass: real TCP transfers (multi-file, empty file, multi-chunk, decline, bad token, verification code match, cancel cleanup) plus framing, crypto, schema, path and QR checks | Resume after disconnect |
| Desktop | Send and receive, files and folders, QR pairing, manual address, approval prompt, pause, resume, cancel, history, settings, light and dark themes, system tray, notifications | 9 helper tests (including nested folder writes and unsafe-name refusal); electron-vite build; app launches under a virtual display; UI screenshots of every page rendered with mock data; Windows NSIS installer stage | Run on a real Windows PC; code signing; portable build needs Windows or Wine |
| Android | Send and receive, QR scan, manual address, approval prompt, pause, resume, cancel, history with open and share, settings, keep-awake, received folders with flat names, choosable save folder | Typecheck clean; full Android JavaScript bundle builds with `expo export` | Build the dev client and test on a phone; run an APK on device; sending folders from Android |

**Not in v0.1:** nearby-device discovery (mDNS), hotspot mode, Bluetooth LE, auto-update, resume after a dropped connection, and trusted-device auto-accept (deliberately left out, see [Security model](#security-model)). iOS is out of scope.

---

## Table of contents

1. [Features](#features)
2. [How it works](#how-it-works)
3. [Repository structure](#repository-structure)
4. [Tech stack and version pins](#tech-stack-and-version-pins)
5. [Prerequisites](#prerequisites)
6. [Quick start](#quick-start)
7. [Building the Windows app](#building-the-windows-app)
8. [Building the Android app](#building-the-android-app)
9. [Protocol](#protocol)
10. [Security model](#security-model)
11. [UI design](#ui-design)
12. [Configuration](#configuration)
13. [Permissions](#permissions)
14. [Testing](#testing)
15. [Troubleshooting](#troubleshooting)
16. [Known limitations](#known-limitations)
17. [Roadmap](#roadmap)
18. [License](#license)

---

## Features

**Transfer**
- Send one or many files from either device. Each file is split into 1 MiB encrypted chunks, up to 4 in flight.
- Live progress, speed, and time remaining.
- Pause, resume, and cancel from either side. Cancelling removes the partial file on the receiver.
- SHA-256 check for every file. A mismatch fails that file and tells both devices.

**Connecting**
- QR pairing: the receiver shows a code, the sender scans it. Codes expire after 2 minutes and work once.
- Manual address (`192.168.x.x:47800`), for when the camera is unavailable. You can turn this off in Settings.

**Security**
- X25519 key exchange per connection, with HKDF-derived session keys.
- Six-digit verification code shown on both devices. The receiver approves each transfer; unanswered requests are declined after 60 seconds.
- AES-256-GCM on every chunk. Encryption cannot be turned off.

**Desktop**
- Drag and drop files or folders, browse, or add a folder, to send. A folder is sent with its structure, up to 10,000 files. Paste a pairing link or address to choose the receiver.
- Receive page with QR code, address, and an on/off switch.
- Transfers, History (search, filter, open file, show in folder), and Settings (device name, port, download folder, theme).
- System tray. Closing the window keeps V_share running so phones can still send. The tray menu shows the window, starts or stops receiving, and quits.
- Windows notifications when a transfer is waiting for approval and when a transfer finishes. Clicking one opens the app.

**Android**
- Pick files from the device, scan the PC's QR code, or type an address.
- Receive page with QR code and an on/off switch. Optional keep-screen-awake during transfers.
- History lets you open or share received files.
- A folder sent from the PC arrives as one file per item, with the folder names in front: `Trip - day1 - a.txt`.
- Settings can save received files to a folder you choose with Android's folder picker.

---

## How it works

1. **Receiver shows a code.** The PC or phone shows a QR code that holds its address, port, and a one-time token.
2. **Sender connects.** The sender scans the code (or types an address) and opens a TCP connection.
3. **Pairing.** Both sides exchange X25519 keys and derive a session key and a six-digit verification code.
4. **Approval.** The receiver shows the file list and the code. The user checks that the codes match and accepts.
5. **Transfer.** Encrypted chunks flow with acknowledgements. Each file is verified with SHA-256.
6. **Done.** Files are saved on the receiver, and both sides record the result in History.

The full message list and frame format are in [`docs/protocol.md`](docs/protocol.md).

---

## Repository structure

```
V_share/
├─ apps/
│  ├─ desktop/                       # V_share Desktop (Electron + React)
│  │  ├─ electron/
│  │  │  ├─ main.ts                  # window, IPC handlers
│  │  │  ├─ preload.ts               # typed bridge exposed as window.vshare
│  │  │  ├─ transfers.ts             # TCP listener, pairing token, sends, receives
│  │  │  ├─ target.ts                # parses a pairing link or address
│  │  │  ├─ files.ts                 # chunked reads, safe writes, name cleanup
│  │  │  ├─ store.ts                 # settings and history (JSON, atomic writes)
│  │  │  ├─ network.ts               # LAN address detection
│  │  │  └─ shared.ts                # types shared with the renderer
│  │  ├─ src/
│  │  │  ├─ App.tsx, styles.css
│  │  │  ├─ components/              # Sidebar, OfferDialog, Toast
│  │  │  └─ pages/                   # Home, Send, Receive, Transfers, History, Settings
│  │  ├─ test/                       # Vitest: target parsing and file helpers
│  │  ├─ build/                      # icons (add icon.ico before release)
│  │  └─ electron-builder.yml
│  │
│  └─ mobile/                        # V_share Mobile (Expo SDK 57, Android)
│     ├─ app/                        # expo-router screens
│     │  ├─ _layout.tsx             # polyfills, root stack, offer sheet
│     │  ├─ scan.tsx                 # QR scanner (modal)
│     │  └─ (tabs)/                  # Home, Send, Receive, History, Settings
│     ├─ src/
│     │  ├─ state/store.ts           # app state, transfers, persistence
│     │  ├─ net/socket.ts            # react-native-tcp-socket adapter
│     │  ├─ net/files.ts             # expo-file-system readers and writers
│     │  ├─ components/              # UI primitives, QR code, offer sheet
│     │  └─ polyfills.ts             # Buffer, TextEncoder, crypto.getRandomValues
│     ├─ assets/                     # app icons (placeholders; replace before release)
│     ├─ app.config.ts, eas.json
│     └─ package.json
│
├─ packages/
│  └─ protocol/                      # @vshare/protocol (shared by both apps)
│     ├─ src/
│     │  ├─ constants.ts             # version, port, chunk size, timeouts
│     │  ├─ messages.ts              # zod schemas for every control message
│     │  ├─ framing.ts              # length-prefixed frames and incremental decoder
│     │  ├─ crypto.ts                # X25519, HKDF, verification code, AES-GCM
│     │  ├─ connection.ts            # framed, typed connection over a byte socket
│     │  ├─ sender.ts, receiver.ts   # transfer state machines
│     │  ├─ files.ts                 # source and sink interfaces, hashing
│     │  ├─ qr.ts                    # pairing link encode and decode
│     │  └─ node.ts                  # Node TCP adapters (desktop and tests)
│     └─ test/                       # Vitest: crypto, framing, QR, end-to-end TCP
│
├─ docs/
│  ├─ protocol.md                    # wire format and handshake
│  └─ design/                        # reference images used for the UI
│
├─ pnpm-workspace.yaml
├─ package.json
└─ README.md
```

Ownership rule: anything that touches the wire format lives in `packages/protocol`. Neither app defines its own message shapes.

---

## Tech stack and version pins

### Mobile (Android)

| Package | Version |
|---|---|
| Expo SDK | **57**: `expo ~57.0.31` |
| React Native | 0.86.3 |
| React | 19.2.3 |
| expo-router | ~57.0.29 |
| expo-camera, expo-file-system, expo-document-picker | SDK 57 bundled versions (`~57.0.6`, `~57.0.7`, `~57.0.3`) |
| expo-sharing, expo-keep-awake, expo-network, expo-crypto | SDK 57 bundled versions |
| react-native-tcp-socket | 6.4.3 (needs the dev client) |
| zustand | 5.x |
| qrcode | 1.5.x (renders the QR code with plain Views) |

**Do not upgrade to Expo SDK 58.** This project is pinned to SDK 57. The versions above come from the `bundledNativeModules.json` file in the SDK 57 `expo` package. The `expo install` command could not reach its compatibility server from the build environment, so set versions by hand from that file.

### Desktop

| Package | Version |
|---|---|
| Electron | 45.0.0 |
| electron-vite | 6.x |
| electron-builder | 26.x |
| React, React DOM | 19.2.9 |
| Vite | 8.x |
| qrcode | 1.5.x |

Settings and history are stored as JSON in the Electron user-data folder. This avoids the native build that `better-sqlite3` needs on Windows.

### Shared

| Package | Notes |
|---|---|
| `@noble/curves`, `@noble/hashes`, `@noble/ciphers` | X25519, SHA-256, HKDF, AES-GCM. Pure JavaScript, so the same code runs in Electron and React Native. |
| `zod` | Validates every incoming control message. |

---

## Prerequisites

**All platforms**
- Node.js **22.13 or later**
- pnpm 10 (the repo pins `pnpm@10.28.0`)
- Git

**Windows development**
- Windows 10 (22H2) or Windows 11, 64-bit
- Building the installer on Linux needs Wine. Building on Windows does not.

**Android development**
- Android Studio (latest stable), with an SDK platform for API 35 or later
- JDK 17
- An Android phone with USB debugging on, or an emulator

---

## Quick start

```bash
git clone https://github.com/<your-org>/V_share.git
cd V_share
pnpm install

pnpm test                 # protocol and desktop unit tests
pnpm dev:desktop          # run the Windows app in development mode

pnpm --filter @vshare/mobile prebuild:android   # generate the Android project
pnpm --filter @vshare/mobile android            # build and install the dev client
pnpm dev:mobile                                 # start Metro for the dev client
```

Both devices must be on the same WiFi network. Guest networks and some routers isolate clients, which blocks transfers.

---

## Building the Windows app

```bash
pnpm build:desktop        # compile main, preload, and renderer (out/)
pnpm build:win            # NSIS installer and portable exe (dist/)
```

Outputs in `apps/desktop/dist/`:

| File | Purpose |
|---|---|
| `V_share-0.1.0-x64.exe` | NSIS installer. Start menu and desktop shortcuts, with an uninstaller. |
| `V_share-0.1.0-x64.nsis.7z` | Installer payload. Electron-builder writes it next to the installer. Ship only the `.exe`, and check that the release build includes its payload. |
| `V_share-0.1.0-x64-portable.exe` | Runs without installing. |

**Verification status:** the compile step and the NSIS stage run on Linux. The final installer step calls `wine`, which this environment does not have. Build on Windows before you distribute anything.

### Code signing (before public release)

Unsigned builds show Windows SmartScreen warnings. Sign with a code-signing certificate:

```
CSC_LINK=path\to\certificate.pfx
CSC_KEY_PASSWORD=********
```

Then remove `signAndEditExecutable: false` from `apps/desktop/electron-builder.yml`.

### Firewall

On first launch, Windows asks whether V_share may communicate on private networks. Allow it on **Private** networks only. To add the rule by hand:

```powershell
New-NetFirewallRule -DisplayName "V_share" -Direction Inbound -Program "C:\Program Files\V_share\V_share.exe" -Action Allow -Profile Private
```

---

## Building the Android app

The Android project is generated by `expo prebuild` and is not committed. Regenerate it after you change `app.config.ts` or a native dependency.

### Development build (required)

Expo Go cannot load `react-native-tcp-socket`, so the app needs a development build:

```bash
cd apps/mobile
npx expo prebuild --platform android
npx expo run:android
npx expo start --dev-client --host lan   # in another terminal
```

If the QR code opens a `localhost` URL or refuses to connect, start Metro with `--host lan` (above). If LAN discovery still fails on your network, use:

```bash
npx expo start --dev-client --tunnel
```

### Cloud build with EAS

```bash
npm install -g eas-cli
eas login
pnpm --filter @vshare/mobile build:android:dev   # installable APK with the dev client
pnpm --filter @vshare/mobile build:android       # AAB for the Play Store
```

### Bundle check (no device needed)

```bash
pnpm --filter @vshare/mobile export:android
```

This compiles the whole JavaScript app for Android, which catches broken imports. It does not produce an APK.

### Upgrading Expo

Stay on SDK 57 patch releases. Update versions only by reading `bundledNativeModules.json` from the target `expo` package, then run `npx expo prebuild --clean`.

---

## Protocol

All control messages are JSON. Chunks are binary frames. Both travel over one TCP connection, in order.

| Message | Purpose |
|---|---|
| `HELLO` | Version, device info, public key, nonce, and optional pairing token |
| `OFFER` | File list with names, sizes, SHA-256 hashes, and chunk counts |
| `ACCEPT` / `REJECT` | The receiver's decision |
| `CHUNK` / `CHUNK_ACK` | Encrypted data and its acknowledgement |
| `FILE_END` / `COMPLETE` | End of a file, and whether its hash matched |
| `PAUSE` / `RESUME` / `CANCEL` | Transfer control from either side |
| `PING` / `PONG` | Keep-alive |

Full details, frame layout, and nonce rules are in [`docs/protocol.md`](docs/protocol.md).

---

## Security model

- **Verification code.** Both devices show the same six-digit code, derived from both public keys and the shared secret. Confirming it defends against a man in the middle on the local network.
- **Fresh keys per connection.** Each connection uses ephemeral X25519 keys and an HKDF-derived session key.
- **Authenticated encryption.** Every chunk uses AES-256-GCM. The chunk header is authenticated as associated data, so a tampered header fails decryption.
- **Integrity.** Each file's SHA-256 is checked against the hash in the offer.
- **Replay and misuse.** Pairing tokens are single use and expire after 2 minutes. Malformed frames close the connection.
- **Approval.** Nothing is written to disk until the receiver accepts.
- **Folder names.** A relative name such as `Trip/day1/a.txt` creates folders only inside the download folder. Each part is checked for `..`, `.`, drive letters, absolute paths, and control characters. Unsafe names are refused.
- **No trusted-device auto-accept.** Trust based on a device ID would let any device on the network claim to be a trusted one, because an ID sent over the LAN can be copied. Every transfer keeps its verification code and approval prompt. This is a deliberate choice, not a missing feature.
- **Local only.** Files never leave the local network. There are no accounts and no analytics.

Report security issues privately to the maintainers. A `SECURITY.md` file is planned before public release.

---

## UI design

Both apps use the same design: near-black surfaces, an orange accent, rounded cards, and a cream Send and Receive card on Home. The reference mockups are in `docs/design/`.

### V_share Desktop (1100 × 720, left sidebar)

- **Home:** hero with listening status, Send and Receive cards, quick-connect tiles, and recent activity.
- **Send:** drop zone (files or folders), Browse files and Add folder buttons, selected-file list, pairing link or address field, and Send button.
- **Receive:** QR code with a refresh countdown, accept switch, IP and port, and copy buttons.
- **Transfers:** Active, Completed, and Failed tabs. Each live transfer shows progress, speed, pause, and cancel.
- **History:** search, filter (All, Sent, Received), and Open and Folder actions.
- **Settings:** device name, download folder, port, manual connections, and theme.
- **Approval dialog:** appears over any page with the file list and verification code.

### V_share Mobile (Android, five tabs)

- **Home:** status banner, Send and Receive cards, active transfers with pause and cancel, recent activity.
- **Send:** file list, add files, pairing link or address field, and a button to scan the PC's QR code.
- **Receive:** QR code with countdown, accept switch, and address.
- **History:** search and filter, with Open or share for received files.
- **Settings:** device name, port, manual connections, keep awake, and encryption status.
- **Scan:** full-screen camera with a framing guide.
- **Approval sheet:** appears over any screen with the file list and verification code.

---

## Configuration

| Setting | Default | Where |
|---|---|---|
| Device name | Computer or phone name | Settings on both apps |
| Listening port | `47800` (1024–65535) | Settings on both apps. Changing it restarts listening. |
| Download folder | `Downloads\V_share` | Desktop Settings |
| Storage on Android | App-private folder | Settings lets you choose a save folder. Use History to open or share files. |
| Tray and notifications | On | Desktop tray menu. Windows notification settings apply to the notifications. |
| Allow connections without scanning | On | Settings on both apps |
| Keep screen awake during transfers | On | Android Settings |
| Theme | System | Desktop Settings |
| Encryption | Always on | Not configurable |

Identifiers: Android package `com.vshare.app`. Windows product name `V_share`.

---

## Permissions

### Windows
- Firewall rule for private networks (see [Firewall](#firewall)).

### Android (declared in `app.config.ts`)
- `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`: network access and the phone's address.
- `CHANGE_WIFI_MULTICAST_STATE`: reserved for nearby-device discovery (planned).
- `CAMERA`: reads the pairing QR code.
- `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO`: picking media (Android 13+).

---

## Testing

```bash
pnpm test                                    # protocol (12) and desktop helpers (7)
pnpm typecheck                               # all workspaces
pnpm --filter @vshare/mobile export:android  # Android JavaScript bundle
```

Results at this version: all tests pass, the typecheck is clean for desktop and mobile, and the Android bundle builds.

The protocol tests run real TCP connections between a sender and a receiver. They cover multi-file transfer, an empty file, a file of several chunks, decline, a rejected pairing token, matching verification codes, and cancellation with cleanup.

### Manual test matrix (run before each release)

| Case | Expected |
|---|---|
| 1 GB file, Windows to Android, 5 GHz WiFi | Completes, hash verified |
| Cancel at 50% | Both sides show cancelled, no partial file on receiver |
| Scan a QR code twice | Second scan rejected (token is single use) |
| Wrong verification code on one side | Do not accept; decline on the receiver |
| Decline on the receiver | Sender shows declined |
| Pause, then resume | Transfer continues from where it stopped |
| Phone screen off mid-transfer (keep awake off) | Transfer may pause; resumes when the app is foregrounded |
| 100 small files | All appear in History |

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Phone cannot reach the PC | Firewall blocks the port | Allow V_share on Private networks |
| Works on one WiFi, not another | Guest network or client isolation | Use the main network |
| QR scan fails | Glare or a dim screen | Raise screen brightness, or type the address |
| "Could not reach …" | Wrong address, or receiving is off | Check the address and that receiving is on |
| "That pairing link is not valid" | Old or incomplete link | Refresh the code on the receiver |
| Approval times out | No answer within 60 seconds | Accept quickly, or send again |
| Transfer slow | 2.4 GHz WiFi, or distance | Move closer or use 5 GHz |
| Android app shows "Unable to resolve module react-native-tcp-socket" | Running in Expo Go | Build the dev client (see [Building the Android app](#building-the-android-app)) |
| Windows installer build fails on Linux with "wine ENOENT" | Wine is not installed | Build on Windows, or install Wine |
| Android build fails after an SDK change | Stale native project | `npx expo prebuild --clean` |

---

## Known limitations

- **Same network required.** Routed networks and VPNs usually block device-to-device traffic. A manual address can work if routing allows it.
- **No resume.** If the connection drops, the transfer starts over.
- **Folders go one way for now.** The PC can send folders. The Android app sends single files. Symbolic links inside a folder are skipped on the PC so they cannot pull in files from outside it. A transfer holds at most 10,000 files.
- **Android storage.** Received files go to V_share's private folder unless you choose a folder in Settings. Android may not keep access to a chosen folder after a restart; files then fall back to the private folder. Saving to the public Downloads folder needs a MediaStore integration (planned).
- **Background limits.** Android may pause the app during long transfers. Keep the screen awake and keep V_share in the foreground.
- **Expo Go is not supported.** The app needs a development build or a production build.
- **Not yet run on real devices.** The Windows installer and the Android app have been compiled and checked, but not installed and tested on hardware.

---

## Roadmap

**v0.1 (current): Core transfer**
- Protocol, pairing, encrypted chunked transfer, history
- Windows and Android send and receive

**v0.2: Reliability**
- Resume after disconnect
- Folder sending from Android
- Saving to the public Downloads folder on Android
- Device tests and fixes for Android background behavior

**v0.3: Discovery and hotspot**
- Nearby-device discovery (mDNS)
- Hotspot mode
- Bluetooth LE discovery with small-file fallback

**v1.0: Release**
- Auto-update
- Code signing, Play Store listing, and the full test matrix

**Later**
- Clipboard sync, transfer to several devices at once, camera-based QR scanning on the desktop

---

## License

To be decided before first public release. Until then, all rights are reserved by the project owner.
