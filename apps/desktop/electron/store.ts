import { app } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type { HistoryEntry, Settings } from "./shared.js";

const HISTORY_LIMIT = 500;

interface StoreFile {
  settings: Settings;
  history: HistoryEntry[];
}

/**
 * Settings and history in one JSON file under the user data folder.
 * Written atomically (temp file, then rename) so a crash cannot leave it half written.
 */
export class Store {
  private readonly file: string;
  private data: StoreFile;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    const dir = app.getPath("userData");
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "vshare-store.json");
    this.data = this.load();
  }

  get settings(): Settings {
    return this.data.settings;
  }

  get history(): HistoryEntry[] {
    return this.data.history;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch, deviceId: this.data.settings.deviceId };
    this.save();
    return this.data.settings;
  }

  /** Saves are batched: a folder of thousands of files adds one history row each, without one disk write each. */
  addHistory(entry: HistoryEntry): void {
    this.data.history = [entry, ...this.data.history].slice(0, HISTORY_LIMIT);
    this.saveSoon();
  }

  /** Writes any batched changes now. Call before the app quits. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.save();
  }

  private saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 300);
  }

  clearHistory(): void {
    this.data.history = [];
    this.save();
  }

  private load(): StoreFile {
    const defaults = defaultSettings();
    if (!existsSync(this.file)) {
      return { settings: defaults, history: [] };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StoreFile>;
      return {
        settings: { ...defaults, ...(parsed.settings ?? {}) },
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch {
      // A corrupt store should not stop the app. Keep a copy for inspection and start fresh.
      renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      return { settings: defaults, history: [] };
    }
  }

  private save(): void {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(temp, this.file);
  }
}

function defaultSettings(): Settings {
  return {
    deviceId: randomUUID().replace(/-/g, "").slice(0, 32),
    deviceName: hostname().slice(0, 64) || "Windows PC",
    port: 47800,
    downloadDir: join(app.getPath("downloads"), "V_share"),
    theme: "system",
    allowManualConnections: true,
  };
}

export function newId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}
