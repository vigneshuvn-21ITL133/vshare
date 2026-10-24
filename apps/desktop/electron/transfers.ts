import type { Server } from "node:net";
import QRCode from "qrcode";
import {
  PAIR_TOKEN_TTL_MS,
  Receiver,
  Sender,
  safeRelativeSegments,
  encodePairUri,
  randomHex,
  type ByteSocket,
  type FileMeta,
  type Hello,
  type Offer,
  type ReceiveState,
  type SendState,
} from "@vshare/protocol";
import { connectToReceiver, listenForSenders } from "@vshare/protocol/node";
import { MAX_FILES, fileSinkIn, fileSourceFor } from "./files.js";
import { parseTarget } from "./target.js";
import { localAddresses, primaryAddress } from "./network.js";
import { newId, type Store } from "./store.js";
import { BluetoothBridge, type BridgeTransport } from "./bluetooth.js";
import type {
  BluetoothPairedResult,
  HistoryEntry,
  ListenInfo,
  PendingOffer,
  PickedFile,
  SendOutcome,
  Snapshot,
  TransferAction,
  TransferState,
  TransferView,
} from "./shared.js";

/** Things the user should hear about even when the window is hidden. */
export type HubEvent =
  | { kind: "offer"; peer: string; fileCount: number }
  | { kind: "done"; direction: "send" | "receive"; peer: string; fileCount: number };

type OutgoingFile = Awaited<ReturnType<typeof fileSourceFor>>;

const OFFER_TIMEOUT_MS = 60_000;
/** Names kept in a transfer's view. A folder can hold thousands of files; snapshots must stay small. */
const VIEW_NAME_LIMIT = 50;
const PROGRESS_INTERVAL_MS = 150;

/** A transfer in progress, plus the controls the UI can send to it. */
interface Live {
  view: TransferView;
  /** Local destination paths, filled in as files are created (receive side only). */
  locations: string[];
  pause(): void;
  resume(): void;
  cancel(): void;
}

interface OfferWaiter {
  offer: PendingOffer;
  resolve(accepted: boolean): void;
}

/**
 * Owns the TCP listener, the Bluetooth bridge, the pairing token, active transfers, and incoming offers.
 * The protocol package does the wire work; this class connects it to the UI and disk.
 */
export class TransferHub {
  private server: Server | null = null;
  private token: { value: string; expiresAt: number } | null = null;
  private tokenTimer: NodeJS.Timeout | null = null;
  private listenError: string | null = null;
  private live = new Map<string, Live>();
  private offers = new Map<string, OfferWaiter>();
  private qrCache: { uri: string; dataUrl: string } | null = null;
  private lastEmit = 0;
  private progressTimer: NodeJS.Timeout | null = null;
  private bluetooth: BluetoothBridge | null = null;
  private btAccepting = false;
  private btError: string | null = null;

  /**
   * @param bluetoothFactory starts the Windows Bluetooth bridge. Null turns Bluetooth off.
   */
  constructor(
    private store: Store,
    private onChange: (snapshot: Snapshot) => void,
    private notifyUser: (event: HubEvent) => void = () => undefined,
    bluetoothFactory: (() => BridgeTransport) | null = null,
  ) {
    this.bluetooth = bluetoothFactory
      ? new BluetoothBridge(bluetoothFactory, (message) => this.bluetoothFailed(message))
      : null;
  }

  isListening(): boolean {
    return this.server !== null;
  }

  // ---------- listening and pairing ----------

  async startListening(): Promise<void> {
    if (this.server) return;
    try {
      this.server = await listenForSenders(this.store.settings.port, (socket) => this.handleIncoming(socket), "0.0.0.0");
      this.listenError = null;
      this.issuePairToken();
    } catch (error) {
      this.listenError = describe(error);
      this.server = null;
    }
    this.emitNow();
  }

  async stopListening(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.clearPairToken();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    this.emitNow();
  }

  /** Issues a new single-use pairing token. Any previous QR code stops working. */
  refreshPairCode(): void {
    if (!this.server) return;
    this.issuePairToken();
    this.emitNow();
  }

  private issuePairToken(): void {
    this.clearPairToken();
    this.token = { value: randomHex(16), expiresAt: Date.now() + PAIR_TOKEN_TTL_MS };
    this.tokenTimer = setTimeout(() => {
      this.token = null;
      this.emitNow();
    }, PAIR_TOKEN_TTL_MS);
  }

  private clearPairToken(): void {
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    this.tokenTimer = null;
    this.token = null;
  }

  private authorize(hello: Hello): boolean {
    const token = this.token;
    if (hello.pairToken && token && Date.now() < token.expiresAt && hello.pairToken === token.value) {
      this.clearPairToken(); // single use: a scanned QR code cannot be reused
      this.emitNow();
      return true;
    }
    return this.store.settings.allowManualConnections;
  }

  private listenInfo(): ListenInfo {
    const host = primaryAddress();
    const port = this.store.settings.port;
    const active = this.token && Date.now() < this.token.expiresAt ? this.token : null;
    const pairUri =
      this.server && host && active
        ? encodePairUri({ host, port, token: active.value, name: this.store.settings.deviceName })
        : null;
    return {
      listening: this.server !== null,
      host,
      port,
      pairUri,
      pairExpiresAt: active?.expiresAt ?? null,
      qrDataUrl: null,
      error: this.listenError,
    };
  }

  // ---------- receiving ----------

  /**
   * @param bluetoothPeer set when the connection came over Bluetooth. The phone is already paired
   * with this PC, so no QR code is needed. The six-digit check and per-transfer approval still apply.
   */
  private handleIncoming(socket: ByteSocket, bluetoothPeer?: string): void {
    const id = newId();
    const live = this.register(id, "receive", bluetoothPeer ?? "Connecting...", []);
    const viaBluetooth = bluetoothPeer !== undefined;

    const receiver = new Receiver(socket, {
      device: { id: this.store.settings.deviceId, name: this.store.settings.deviceName, platform: "windows" },
      authorize: (hello) => viaBluetooth || this.authorize(hello),
      onOffer: (offer, context) => this.askUser(id, offer, context.sender.name, context.verificationCode),
      openSink: async (meta: FileMeta) => {
        const sink = await fileSinkIn(this.store.settings.downloadDir, meta.name);
        live.locations.push(sink.path);
        return sink;
      },
      onState: (state, detail) => {
        if (detail?.sender) live.view.peer = detail.sender.name;
        if (detail?.verificationCode) live.view.verificationCode = detail.verificationCode;
        this.applyState(live, mapReceiveState(state));
      },
      onProgress: (progress) => {
        live.view.currentFile = progress.fileName;
        live.view.bytesDone = progress.bytesReceived;
        live.view.totalBytes = progress.totalBytes;
        this.emitProgress();
      },
      onFileComplete: (meta, location) => {
        this.store.addHistory({
          id: newId(),
          direction: "receive",
          name: meta.name,
          size: meta.size,
          peer: live.view.peer,
          status: "done",
          when: Date.now(),
          location,
        });
        this.emitNow();
      },
    });

    live.pause = () => receiver.pause();
    live.resume = () => receiver.resume();
    live.cancel = () => receiver.cancel();

    void receiver.start().then((result) => {
      if (result.state === "done") {
        this.finish(id, "done", null);
        return;
      }
      const reason = result.state === "error" ? result.error : result.state === "declined" ? result.reason : null;
      this.recordFailure(live, result.state === "declined" ? "declined" : result.state === "cancelled" ? "cancelled" : "error", reason);
      this.finish(id, result.state, reason);
    });
  }

  private askUser(id: string, offer: Offer, peer: string, verificationCode: string): Promise<boolean> {
    const live = this.live.get(id);
    if (live) {
      live.view.fileNames = offer.files.slice(0, VIEW_NAME_LIMIT).map((file) => file.name);
      live.view.fileCount = offer.files.length;
      live.view.totalBytes = offer.totalBytes;
    }
    const offerId = newId();
    const pending: PendingOffer = {
      id: offerId,
      peer,
      fileNames: offer.files.slice(0, VIEW_NAME_LIMIT).map((file) => file.name),
      fileCount: offer.files.length,
      totalBytes: offer.totalBytes,
      verificationCode,
      expiresAt: Date.now() + OFFER_TIMEOUT_MS,
    };
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => settle(false), OFFER_TIMEOUT_MS);
      const settle = (accepted: boolean) => {
        if (!this.offers.has(offerId)) return;
        clearTimeout(timer);
        this.offers.delete(offerId);
        resolve(accepted);
        this.emitNow();
      };
      this.offers.set(offerId, { offer: pending, resolve: settle });
      this.notifyUser({ kind: "offer", peer, fileCount: offer.files.length });
      this.emitNow();
    });
  }

  respondOffer(offerId: string, accept: boolean): void {
    this.offers.get(offerId)?.resolve(accept);
  }

  // ---------- sending over Wi-Fi ----------

  async sendFiles(target: string, items: PickedFile[]): Promise<SendOutcome> {
    const parsed = parseTarget(target);
    if (!parsed.ok) return parsed;
    const prepared = await this.prepareFiles(items);
    if (!prepared.ok) return prepared;

    const { host, port, token } = parsed;
    let socket: ByteSocket;
    try {
      socket = await connectToReceiver(host, port);
    } catch (error) {
      return { ok: false, error: `Could not reach ${host}:${port}. ${describe(error)}` };
    }

    this.startOutgoing(socket, `${host}:${port}`, prepared.files, token);
    return { ok: true };
  }

  // ---------- Bluetooth ----------

  /** Starts accepting phones over Bluetooth. The phone must be paired with this PC in Windows first. */
  async startBluetooth(): Promise<void> {
    if (!this.bluetooth || this.btAccepting) return;
    try {
      await this.bluetooth.listen((socket, peer) => {
        this.handleIncoming(socket, peer.name || peer.address || "Bluetooth phone");
      });
      this.btAccepting = true;
      this.btError = null;
    } catch (error) {
      this.btAccepting = false;
      this.btError = describe(error);
    }
    this.emitNow();
  }

  async stopBluetooth(): Promise<void> {
    if (!this.bluetooth) return;
    this.btAccepting = false;
    try {
      await this.bluetooth.stopListen();
    } catch {
      // The bridge may already be gone. Nothing is listening either way.
    }
    this.emitNow();
  }

  /** Devices paired with this PC in Windows. */
  async bluetoothPaired(): Promise<BluetoothPairedResult> {
    if (!this.bluetooth) return { ok: false, error: "Bluetooth is not available on this PC." };
    try {
      return { ok: true, devices: await this.bluetooth.paired() };
    } catch (error) {
      return { ok: false, error: describe(error) };
    }
  }

  async sendBluetooth(address: string, items: PickedFile[]): Promise<SendOutcome> {
    const prepared = await this.prepareFiles(items);
    if (!prepared.ok) return prepared;
    if (!this.bluetooth) return { ok: false, error: "Bluetooth is not available on this PC." };
    let socket: ByteSocket;
    try {
      socket = await this.bluetooth.connect(address);
    } catch (error) {
      return { ok: false, error: `Could not reach the phone over Bluetooth. ${describe(error)}` };
    }
    this.startOutgoing(socket, address, prepared.files, undefined);
    return { ok: true };
  }

  /** Stops the Bluetooth bridge process. Called when the app quits. */
  disposeBluetooth(): void {
    this.bluetooth?.dispose();
    this.bluetooth = null;
    this.btAccepting = false;
  }

  private bluetoothFailed(message: string): void {
    this.btAccepting = false;
    this.btError = message;
    this.emitNow();
  }

  // ---------- shared send path ----------

  private async prepareFiles(
    items: PickedFile[],
  ): Promise<{ ok: true; files: OutgoingFile[] } | { ok: false; error: string }> {
    if (items.length === 0) return { ok: false, error: "Choose at least one file to send." };
    if (items.length > MAX_FILES) return { ok: false, error: `Send at most ${MAX_FILES} files at a time.` };
    if (items.some((item) => !safeRelativeSegments(item.name))) {
      return { ok: false, error: "A file has a name that cannot be sent. Rename it and try again." };
    }
    try {
      return { ok: true, files: await Promise.all(items.map((item) => fileSourceFor(item.path, item.name))) };
    } catch (error) {
      return { ok: false, error: describe(error) };
    }
  }

  /** Runs one outgoing transfer over an open socket. Wi-Fi and Bluetooth both end up here. */
  private startOutgoing(socket: ByteSocket, peer: string, files: OutgoingFile[], pairToken: string | undefined): void {
    const id = newId();
    const live = this.register(id, "send", peer, files.map((file) => file.name));
    live.view.totalBytes = files.reduce((sum, file) => sum + file.size, 0);

    const sender = new Sender(socket, {
      device: { id: this.store.settings.deviceId, name: this.store.settings.deviceName, platform: "windows" },
      files,
      pairToken,
      onState: (state: SendState, detail) => {
        if (detail?.verificationCode) live.view.verificationCode = detail.verificationCode;
        this.applyState(live, mapSendState(state));
      },
      onProgress: (progress) => {
        live.view.currentFile = progress.fileName;
        live.view.bytesDone = progress.bytesSent;
        this.emitProgress();
      },
    });

    live.pause = () => sender.pause();
    live.resume = () => sender.resume();
    live.cancel = () => sender.cancel();

    void sender.start().then((result) => {
      if (result.state === "done") {
        for (const file of files) {
          this.store.addHistory({ id: newId(), direction: "send", name: file.name, size: file.size, peer: live.view.peer, status: "done", when: Date.now(), location: null });
        }
        this.finish(id, "done", null);
        return;
      }
      const reason = result.state === "error" ? result.error : result.state === "declined" ? result.reason : null;
      this.recordFailure(live, result.state === "declined" ? "declined" : result.state === "cancelled" ? "cancelled" : "error", reason);
      this.finish(id, result.state, reason);
    });
  }

  // ---------- transfer controls ----------

  transferAction(id: string, action: TransferAction): void {
    const live = this.live.get(id);
    if (!live) return;
    if (action === "pause") {
      live.view.paused = true;
      live.pause();
    } else if (action === "resume") {
      live.view.paused = false;
      live.resume();
    } else {
      live.cancel();
    }
    this.emitNow();
  }

  // ---------- snapshots ----------

  async snapshot(): Promise<Snapshot> {
    const listen = this.listenInfo();
    if (listen.pairUri) {
      if (this.qrCache?.uri !== listen.pairUri) {
        const dataUrl = await QRCode.toDataURL(listen.pairUri, {
          margin: 1,
          width: 240,
          errorCorrectionLevel: "M",
          color: { dark: "#111111", light: "#ffffff" },
        });
        this.qrCache = { uri: listen.pairUri, dataUrl };
      }
      listen.qrDataUrl = this.qrCache.dataUrl;
    }
    return {
      settings: this.store.settings,
      listen,
      localAddresses: localAddresses().map((entry) => entry.address),
      transfers: [...this.live.values()].map((entry) => ({ ...entry.view })),
      history: this.store.history as HistoryEntry[],
      offers: [...this.offers.values()].map((entry) => entry.offer),
      bluetooth: {
        available: this.bluetooth !== null,
        accepting: this.btAccepting,
        error: this.btError,
      },
    };
  }

  emitNow(): void {
    this.lastEmit = Date.now();
    void this.snapshot().then((snapshot) => this.onChange(snapshot));
  }

  /** Coalesces progress updates so the renderer is not flooded during fast transfers. */
  private emitProgress(): void {
    const wait = PROGRESS_INTERVAL_MS - (Date.now() - this.lastEmit);
    if (wait <= 0) {
      this.emitNow();
      return;
    }
    if (!this.progressTimer) {
      this.progressTimer = setTimeout(() => {
        this.progressTimer = null;
        this.emitNow();
      }, wait);
    }
  }

  // ---------- internal bookkeeping ----------

  private register(id: string, direction: "send" | "receive", peer: string, fileNames: string[]): Live {
    const view: TransferView = {
      id,
      direction,
      peer,
      fileNames: fileNames.slice(0, VIEW_NAME_LIMIT),
      fileCount: fileNames.length,
      totalBytes: 0,
      bytesDone: 0,
      currentFile: null,
      state: direction === "send" ? "connecting" : "waiting",
      paused: false,
      verificationCode: null,
      error: null,
      startedAt: Date.now(),
    };
    const live: Live = {
      view,
      locations: [],
      pause: () => undefined,
      resume: () => undefined,
      cancel: () => undefined,
    };
    this.live.set(id, live);
    this.emitNow();
    return live;
  }

  private applyState(live: Live, state: TransferState): void {
    live.view.state = state;
    this.emitNow();
  }

  /** One history row for a transfer that did not complete, so failures are visible. */
  private recordFailure(live: Live, status: "declined" | "cancelled" | "error", reason: string | null): void {
    const shown = live.view.fileNames.slice(0, 3).join(", ");
    const more = live.view.fileCount > 3 ? ` and ${live.view.fileCount - 3} more` : "";
    const names = live.view.fileNames.length > 0 ? `${shown}${more}` : "(no files)";
    this.store.addHistory({
      id: newId(),
      direction: live.view.direction,
      name: reason ? `${names} (${reason})` : names,
      size: live.view.totalBytes,
      peer: live.view.peer,
      status,
      when: Date.now(),
      location: live.locations[0] ?? null,
    });
  }

  private finish(id: string, state: string, reason: string | null): void {
    const live = this.live.get(id);
    if (!live) return;
    const terminal: TransferState =
      state === "done" ? "done" : state === "declined" ? "declined" : state === "cancelled" ? "cancelled" : "error";
    live.view.state = terminal;
    live.view.error = terminal === "error" || terminal === "declined" ? reason : null;
    if (terminal === "done") {
      this.notifyUser({ kind: "done", direction: live.view.direction, peer: live.view.peer, fileCount: live.view.fileCount });
    }
    this.live.delete(id);
    this.emitNow();
  }
}

// ---------- helpers ----------

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapReceiveState(state: ReceiveState): TransferState {
  switch (state) {
    case "offer":
      return "waiting";
    case "receiving":
      return "receiving";
    default:
      return state;
  }
}

function mapSendState(state: SendState): TransferState {
  return state === "preparing" ? "preparing" : state;
}
