import { create } from "zustand";
import { Directory, File, Paths } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Network from "expo-network";
import {
  DEFAULT_PORT,
  PAIR_TOKEN_TTL_MS,
  Receiver,
  Sender,
  decodePairUri,
  encodePairUri,
  randomHex,
  type ByteSocket,
  type FileMeta,
  type Hello,
  type Offer,
  type ReceiveState,
  type SendState,
} from "@vshare/protocol";
import { connectTo, listenFor, type Listener } from "../net/socket";
import { sinkFor, sourceFor } from "../net/files";
import type {
  HistoryEntry,
  ListenInfo,
  PendingOffer,
  SendableFile,
  SendOutcome,
  Settings,
  TransferAction,
  TransferState,
  TransferView,
} from "./types";

const STATE_FILE = "vshare-state.json";
const OFFER_TIMEOUT_MS = 60_000;
const HISTORY_LIMIT = 500;

interface Live {
  view: TransferView;
  pause(): void;
  resume(): void;
  cancel(): void;
}

interface OfferWaiter {
  offer: PendingOffer;
  resolve(accepted: boolean): void;
}

export interface AppState {
  ready: boolean;
  settings: Settings;
  history: HistoryEntry[];
  transfers: TransferView[];
  offers: PendingOffer[];
  listen: ListenInfo;
  localIp: string | null;
  online: boolean;
  /** Pairing link captured by the scanner, waiting for the Send screen to use it. */
  pendingTarget: string | null;

  init(): Promise<void>;
  refreshNetwork(): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  refreshPairCode(): void;
  respondOffer(offerId: string, accept: boolean): void;
  sendFiles(target: string, files: SendableFile[]): Promise<SendOutcome>;
  transferAction(id: string, action: TransferAction): void;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  clearHistory(): void;
  setPendingTarget(target: string | null): void;
  /** Opens the system folder picker. Resolves to false when the user cancels or the picker fails. */
  chooseSaveFolder(): Promise<boolean>;
}

// Live objects that cannot live in state: sockets, listeners, and promise resolvers.
let listener: Listener | null = null;
let pairToken: { value: string; expiresAt: number } | null = null;
let pairTimer: ReturnType<typeof setTimeout> | null = null;
const live = new Map<string, Live>();
const offerWaiters = new Map<string, OfferWaiter>();
let progressTimer: ReturnType<typeof setTimeout> | null = null;
let lastPush = 0;

const newId = () => randomHex(6);

function defaultSettings(): Settings {
  return {
    deviceId: randomHex(16),
    deviceName: "Android phone",
    port: DEFAULT_PORT,
    allowManualConnections: true,
    keepScreenAwake: true,
    saveFolderUri: null,
  };
}

export const useStore = create<AppState>((set, get) => {
  /** Writes settings and history to the app's private storage. Failures are not fatal. */
  const persist = () => {
    try {
      const file = new File(Paths.document, STATE_FILE);
      const { settings, history } = get();
      file.write(JSON.stringify({ settings, history }));
    } catch {
      // Storage can be unavailable (for example, a full disk). The app keeps working in memory.
    }
  };

  const push = (partial: Partial<AppState>) => {
    set(partial);
  };

  /** Coalesces progress updates so the UI re-renders at most about 7 times a second. */
  const pushTransfers = () => {
    const wait = 150 - (Date.now() - lastPush);
    const emit = () => {
      lastPush = Date.now();
      push({ transfers: [...live.values()].map((entry) => ({ ...entry.view })) });
      syncKeepAwake();
    };
    if (wait <= 0) return emit();
    if (!progressTimer) {
      progressTimer = setTimeout(() => {
        progressTimer = null;
        emit();
      }, wait);
    }
  };

  const syncKeepAwake = () => {
    const { settings } = get();
    if (settings.keepScreenAwake && live.size > 0) {
      void activateKeepAwakeAsync("transfer").catch(() => undefined);
    } else {
      deactivateKeepAwake("transfer");
    }
  };

  const addHistory = (entry: Omit<HistoryEntry, "id" | "when">) => {
    const next: HistoryEntry = { id: newId(), when: Date.now(), ...entry };
    push({ history: [next, ...get().history].slice(0, HISTORY_LIMIT) });
    persist();
  };

  const register = (id: string, direction: "send" | "receive", peer: string, fileNames: string[]): Live => {
    const view: TransferView = {
      id,
      direction,
      peer,
      fileNames,
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
    const entry: Live = { view, pause: () => undefined, resume: () => undefined, cancel: () => undefined };
    live.set(id, entry);
    pushTransfers();
    return entry;
  };

  const setState = (entry: Live, state: TransferState) => {
    entry.view.state = state;
    pushTransfers();
  };

  const finish = (id: string, state: TransferState, error: string | null) => {
    const entry = live.get(id);
    if (!entry) return;
    entry.view.state = state;
    entry.view.error = state === "error" || state === "declined" ? error : null;
    live.delete(id);
    pushTransfers();
  };

  const failureRow = (entry: Live, status: "declined" | "cancelled" | "error", reason: string | null, location: string | null) => {
    const names = entry.view.fileNames.length > 0 ? entry.view.fileNames.join(", ") : "(no files)";
    addHistory({
      direction: entry.view.direction,
      name: reason ? `${names} (${reason})` : names,
      size: entry.view.totalBytes,
      peer: entry.view.peer,
      status,
      location,
    });
  };

  const askUser = (id: string, offer: Offer, peer: string, verificationCode: string): Promise<boolean> => {
    const entry = live.get(id);
    if (entry) {
      entry.view.fileNames = offer.files.map((file) => file.name);
      entry.view.fileCount = offer.files.length;
      entry.view.totalBytes = offer.totalBytes;
    }
    const offerId = newId();
    const pending: PendingOffer = {
      id: offerId,
      peer,
      fileNames: offer.files.map((file) => file.name),
      fileCount: offer.files.length,
      totalBytes: offer.totalBytes,
      verificationCode,
      expiresAt: Date.now() + OFFER_TIMEOUT_MS,
    };
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => settle(false), OFFER_TIMEOUT_MS);
      const settle = (accepted: boolean) => {
        if (!offerWaiters.has(offerId)) return;
        clearTimeout(timer);
        offerWaiters.delete(offerId);
        push({ offers: get().offers.filter((item) => item.id !== offerId) });
        resolve(accepted);
      };
      offerWaiters.set(offerId, { offer: pending, resolve: settle });
      push({ offers: [...get().offers, pending] });
    });
  };

  const authorize = (hello: Hello): boolean => {
    if (hello.pairToken && pairToken && Date.now() < pairToken.expiresAt && hello.pairToken === pairToken.value) {
      pairToken = null; // single use
      get().refreshPairCode();
      return true;
    }
    return get().settings.allowManualConnections;
  };

  const handleIncoming = (socket: ByteSocket) => {
    const id = newId();
    const entry = register(id, "receive", "Connecting...", []);
    const savedLocations: string[] = [];

    const receiver = new Receiver(socket, {
      device: { id: get().settings.deviceId, name: get().settings.deviceName, platform: "android" },
      authorize,
      onOffer: (offer, context) => askUser(id, offer, context.sender.name, context.verificationCode),
      openSink: async (meta: FileMeta) => {
        const { sink, uri } = sinkFor(meta, get().settings.saveFolderUri);
        savedLocations.push(uri());
        return sink;
      },
      onState: (state: ReceiveState, detail) => {
        if (detail?.sender) entry.view.peer = detail.sender.name;
        if (detail?.verificationCode) entry.view.verificationCode = detail.verificationCode;
        setState(entry, state === "offer" ? "waiting" : (state as TransferState));
      },
      onProgress: (progress) => {
        entry.view.currentFile = progress.fileName;
        entry.view.bytesDone = progress.bytesReceived;
        entry.view.totalBytes = progress.totalBytes;
        pushTransfers();
      },
      onFileComplete: (meta, location) => {
        addHistory({ direction: "receive", name: meta.name, size: meta.size, peer: entry.view.peer, status: "done", location });
      },
    });

    entry.pause = () => receiver.pause();
    entry.resume = () => receiver.resume();
    entry.cancel = () => receiver.cancel();

    void receiver.start().then((result) => {
      if (result.state === "done") {
        finish(id, "done", null);
        return;
      }
      const reason = result.state === "error" ? result.error : result.state === "declined" ? result.reason : null;
      const status = result.state === "declined" ? "declined" : result.state === "cancelled" ? "cancelled" : "error";
      failureRow(entry, status, reason, savedLocations[0] ?? null);
      finish(id, result.state, reason);
    });
  };

  return {
    ready: false,
    settings: defaultSettings(),
    history: [],
    transfers: [],
    offers: [],
    listen: { listening: false, host: null, port: DEFAULT_PORT, pairUri: null, pairExpiresAt: null, error: null },
    localIp: null,
    online: false,
    pendingTarget: null,

    async init() {
      try {
        const file = new File(Paths.document, STATE_FILE);
        if (file.exists) {
          const parsed = JSON.parse(await file.text()) as { settings?: Partial<Settings>; history?: HistoryEntry[] };
          const defaults = defaultSettings();
          push({
            settings: { ...defaults, ...(parsed.settings ?? {}), deviceId: parsed.settings?.deviceId ?? defaults.deviceId },
            history: Array.isArray(parsed.history) ? parsed.history : [],
          });
        }
      } catch {
        // A corrupt state file is ignored; the defaults are used and overwritten on the next save.
      }
      push({ ready: true });
      await get().refreshNetwork();
      await get().startListening();
    },

    async refreshNetwork() {
      try {
        const [state, ip] = await Promise.all([Network.getNetworkStateAsync(), Network.getIpAddressAsync()]);
        const usable = ip && ip !== "0.0.0.0" ? ip : null;
        push({ online: Boolean(state.isConnected) && usable !== null, localIp: usable });
      } catch {
        push({ online: false, localIp: null });
      }
    },

    async startListening() {
      if (listener) return;
      const { settings } = get();
      try {
        listener = await listenFor(settings.port, (socket) => handleIncoming(socket));
        push({ listen: { ...get().listen, listening: true, port: settings.port, error: null } });
        get().refreshPairCode();
      } catch (error) {
        push({
          listen: {
            ...get().listen,
            listening: false,
            port: settings.port,
            pairUri: null,
            error: error instanceof Error ? error.message : "Could not start receiving.",
          },
        });
      }
    },

    async stopListening() {
      const current = listener;
      listener = null;
      if (pairTimer) clearTimeout(pairTimer);
      pairToken = null;
      if (current) await current.close();
      push({ listen: { ...get().listen, listening: false, pairUri: null, pairExpiresAt: null } });
    },

    refreshPairCode() {
      const { localIp, settings, listen } = get();
      if (pairTimer) clearTimeout(pairTimer);
      if (!listener) return;
      pairToken = { value: randomHex(16), expiresAt: Date.now() + PAIR_TOKEN_TTL_MS };
      const pairUri = localIp
        ? encodePairUri({ host: localIp, port: settings.port, token: pairToken.value, name: settings.deviceName })
        : null;
      push({ listen: { ...listen, pairUri, pairExpiresAt: pairToken.expiresAt } });
      pairTimer = setTimeout(() => {
        pairToken = null;
        push({ listen: { ...get().listen, pairUri: null, pairExpiresAt: null } });
      }, PAIR_TOKEN_TTL_MS);
    },

    respondOffer(offerId, accept) {
      offerWaiters.get(offerId)?.resolve(accept);
    },

    async sendFiles(target, files) {
      const trimmed = target.trim();
      let host: string;
      let port: number;
      let token: string | undefined;

      if (trimmed.startsWith("vshare://")) {
        const invite = decodePairUri(trimmed);
        if (!invite) return { ok: false, error: "That pairing link is not valid or is incomplete." };
        ({ host, port } = invite);
        token = invite.token;
      } else {
        const match = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(trimmed);
        if (!match) return { ok: false, error: "Enter a pairing link or an address like 192.168.1.23:47800." };
        host = match[1];
        port = match[2] ? Number(match[2]) : DEFAULT_PORT;
      }
      if (port < 1 || port > 65535) return { ok: false, error: "The port number is out of range." };
      if (files.length === 0) return { ok: false, error: "Choose at least one file to send." };

      let socket: ByteSocket;
      try {
        socket = await connectTo(host, port);
      } catch (error) {
        return { ok: false, error: `Could not reach ${host}:${port}. ${error instanceof Error ? error.message : ""}`.trim() };
      }

      const id = newId();
      const entry = register(id, "send", `${host}:${port}`, files.map((file) => file.name));
      entry.view.totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      const sources = files.map(sourceFor);

      const sender = new Sender(socket, {
        device: { id: get().settings.deviceId, name: get().settings.deviceName, platform: "android" },
        files: sources,
        pairToken: token,
        onState: (state: SendState, detail) => {
          if (detail?.verificationCode) entry.view.verificationCode = detail.verificationCode;
          setState(entry, state as TransferState);
        },
        onProgress: (progress) => {
          entry.view.currentFile = progress.fileName;
          entry.view.bytesDone = progress.bytesSent;
          pushTransfers();
        },
      });

      entry.pause = () => sender.pause();
      entry.resume = () => sender.resume();
      entry.cancel = () => sender.cancel();

      void sender.start().then((result) => {
        if (result.state === "done") {
          for (const file of files) {
            addHistory({ direction: "send", name: file.name, size: file.size, peer: entry.view.peer, status: "done", location: file.uri });
          }
          finish(id, "done", null);
          return;
        }
        const reason = result.state === "error" ? result.error : result.state === "declined" ? result.reason : null;
        const status = result.state === "declined" ? "declined" : result.state === "cancelled" ? "cancelled" : "error";
        failureRow(entry, status, reason, null);
        finish(id, result.state, reason);
      });

      return { ok: true };
    },

    transferAction(id, action) {
      const entry = live.get(id);
      if (!entry) return;
      if (action === "pause") {
        entry.view.paused = true;
        entry.pause();
      } else if (action === "resume") {
        entry.view.paused = false;
        entry.resume();
      } else {
        entry.cancel();
      }
      pushTransfers();
    },

    async updateSettings(patch) {
      const previous = get().settings;
      push({ settings: { ...previous, ...patch, deviceId: previous.deviceId } });
      persist();
      if (patch.port !== undefined && patch.port !== previous.port && listener) {
        await get().stopListening();
        await get().startListening();
      } else if (patch.deviceName !== undefined) {
        get().refreshPairCode();
      }
      syncKeepAwake();
    },

    clearHistory() {
      push({ history: [] });
      persist();
    },

    setPendingTarget(target) {
      push({ pendingTarget: target });
    },

    async chooseSaveFolder() {
      try {
        const folder = await Directory.pickDirectoryAsync();
        await get().updateSettings({ saveFolderUri: folder.uri });
        return true;
      } catch {
        return false;
      }
    },
  };
});

/** Convenience for screens that need the protocol's default port without importing the protocol. */
export const DEFAULT_LISTEN_PORT = DEFAULT_PORT;
