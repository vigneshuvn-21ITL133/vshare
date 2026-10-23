// Types and channel names shared by the Electron main process, preload script, and renderer.
// Nothing in this file may import Node or Electron modules.

export type ThemeMode = "system" | "light" | "dark";

export interface Settings {
  deviceId: string;
  deviceName: string;
  port: number;
  downloadDir: string;
  theme: ThemeMode;
  /** Accept senders that connect by IP:port without scanning the QR code. */
  allowManualConnections: boolean;
}

export type TransferState =
  | "preparing"
  | "connecting"
  | "verifying"
  | "waiting"
  | "sending"
  | "receiving"
  | "paused"
  | "done"
  | "declined"
  | "cancelled"
  | "error";

export interface TransferView {
  id: string;
  direction: "send" | "receive";
  peer: string;
  fileNames: string[];
  fileCount: number;
  totalBytes: number;
  bytesDone: number;
  currentFile: string | null;
  state: TransferState;
  paused: boolean;
  verificationCode: string | null;
  error: string | null;
  startedAt: number;
}

export type HistoryStatus = "done" | "declined" | "cancelled" | "error";

export interface HistoryEntry {
  id: string;
  direction: "send" | "receive";
  name: string;
  size: number;
  peer: string;
  status: HistoryStatus;
  when: number;
  location: string | null;
}

export interface PendingOffer {
  id: string;
  peer: string;
  fileNames: string[];
  fileCount: number;
  totalBytes: number;
  verificationCode: string;
  expiresAt: number;
}

export interface ListenInfo {
  listening: boolean;
  host: string | null;
  port: number;
  pairUri: string | null;
  pairExpiresAt: number | null;
  qrDataUrl: string | null;
  error: string | null;
}

export interface Snapshot {
  settings: Settings;
  listen: ListenInfo;
  localAddresses: string[];
  transfers: TransferView[];
  history: HistoryEntry[];
  offers: PendingOffer[];
}

/** `name` is the path the receiver sees. For folder contents it includes the folder: "Trip/day1/a.txt". */
export interface PickedFile {
  path: string;
  name: string;
  size: number;
}

export type SendOutcome = { ok: true } | { ok: false; error: string };

export type TransferAction = "pause" | "resume" | "cancel";

/** Channel names. The preload script maps each one to a method on window.vshare. */
export const CHANNEL = {
  getSnapshot: "vshare:getSnapshot",
  snapshot: "vshare:snapshot",
  pickFiles: "vshare:pickFiles",
  pickFolder: "vshare:pickFolder",
  statFiles: "vshare:statFiles",
  startListening: "vshare:startListening",
  stopListening: "vshare:stopListening",
  refreshPairCode: "vshare:refreshPairCode",
  respondOffer: "vshare:respondOffer",
  sendFiles: "vshare:sendFiles",
  transferAction: "vshare:transferAction",
  updateSettings: "vshare:updateSettings",
  chooseDownloadDir: "vshare:chooseDownloadDir",
  openPath: "vshare:openPath",
  showInFolder: "vshare:showInFolder",
  clearHistory: "vshare:clearHistory",
} as const;

export interface VShareApi {
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
  pickFiles(): Promise<PickedFile[]>;
  pickFolder(): Promise<PickedFile[]>;
  statFiles(paths: string[]): Promise<PickedFile[]>;
  pathForFile(file: File): string;
  startListening(): Promise<boolean>;
  stopListening(): Promise<void>;
  refreshPairCode(): Promise<void>;
  respondOffer(offerId: string, accept: boolean): Promise<void>;
  sendFiles(target: string, files: PickedFile[]): Promise<SendOutcome>;
  transferAction(id: string, action: TransferAction): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  chooseDownloadDir(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  showInFolder(path: string): Promise<void>;
  clearHistory(): Promise<void>;
}
