// View types shared by the store and the screens. They mirror the Windows app's shapes so the
// two UIs describe transfers the same way.

export interface Settings {
  deviceId: string;
  deviceName: string;
  port: number;
  allowManualConnections: boolean;
  keepScreenAwake: boolean;
  /** A folder the user picked with the system folder picker (content:// URI), or null for the private folder. */
  saveFolderUri: string | null;
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
  /** A file:// URI on this phone, when the file was saved here. */
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
  error: string | null;
}

/** A file the user picked on the phone, ready to send. */
export interface SendableFile {
  uri: string;
  name: string;
  size: number;
  mime: string;
}

export type SendOutcome = { ok: true } | { ok: false; error: string };
export type TransferAction = "pause" | "resume" | "cancel";
