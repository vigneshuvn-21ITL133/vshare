import { app, BrowserWindow, Notification, dialog, ipcMain, shell, nativeTheme, type IpcMainInvokeEvent } from "electron";
import { isAbsolute, join } from "node:path";
import { CHANNEL, type PickedFile, type Settings, type Snapshot, type TransferAction } from "./shared.js";
import { expandPaths } from "./files.js";
import { Store } from "./store.js";
import { TransferHub, type HubEvent } from "./transfers.js";
import { createTray, type TrayHandle } from "./tray.js";

// Only one instance may own the listening port and the store file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let store: Store;
let hub: TransferHub;
let lastSnapshot: Snapshot | null = null;
let tray: TrayHandle | null = null;
/** Set when the user really quits. Closing the window only hides it, so receiving continues in the tray. */
let quitting = false;

type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

function handleIpc(channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, (event, ...args) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || !isTrustedRenderer(frame.url)) {
      throw new Error("Rejected IPC request from an untrusted renderer.");
    }
    return handler(event, ...args);
  });
}

function isTrustedRenderer(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "file:") return true;
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    return Boolean(devUrl && url.origin === new URL(devUrl).origin);
  } catch {
    return false;
  }
}

function requireString(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function validateSettingsPatch(value: unknown): Partial<Settings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Settings update must be an object.");
  }
  const patch = value as Record<string, unknown>;
  const allowed = new Set(["deviceName", "port", "downloadDir", "theme", "allowManualConnections"]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new Error(`Unsupported settings field: ${key}`);
  }
  if ("deviceName" in patch && (typeof patch.deviceName !== "string" || !patch.deviceName.trim() || patch.deviceName.trim().length > 64)) {
    throw new Error("Device name must contain 1–64 characters.");
  }
  if ("port" in patch && (!Number.isInteger(patch.port) || (patch.port as number) < 1024 || (patch.port as number) > 65535)) {
    throw new Error("Port must be an integer between 1024 and 65535.");
  }
  if ("downloadDir" in patch && (typeof patch.downloadDir !== "string" || !isAbsolute(patch.downloadDir))) {
    throw new Error("Download folder must be an absolute path.");
  }
  if ("theme" in patch && !["system", "light", "dark"].includes(String(patch.theme))) {
    throw new Error("Invalid theme.");
  }
  if ("allowManualConnections" in patch && typeof patch.allowManualConnections !== "boolean") {
    throw new Error("Invalid manual-connection setting.");
  }
  return patch as Partial<Settings>;
}

function validatePickedFiles(value: unknown): PickedFile[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) {
    throw new Error("Choose between 1 and 10,000 files.");
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid file entry.");
    const file = entry as Record<string, unknown>;
    const path = requireString(file.path, "file path");
    const name = requireString(file.name, "file name", 4096);
    if (!isAbsolute(path) || !Number.isSafeInteger(file.size) || (file.size as number) < 0) {
      throw new Error("Invalid file metadata.");
    }
    return { path, name, size: file.size as number };
  });
}

function applyTheme(theme: Settings["theme"]): void {
  nativeTheme.themeSource = theme;
}

function broadcast(snapshot: Snapshot): void {
  lastSnapshot = snapshot;
  mainWindow?.webContents.send(CHANNEL.snapshot, snapshot);
  tray?.refresh();
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Shows a Windows notification for an incoming offer or a finished transfer. Clicking it opens the app. */
function notifyUser(event: HubEvent): void {
  if (!Notification.isSupported()) return;
  const count = event.fileCount === 1 ? "1 file" : `${event.fileCount} files`;
  const text =
    event.kind === "offer"
      ? { title: "Incoming files", body: `${event.peer} wants to send ${count}. Open V_share to approve.` }
      : {
          title: event.direction === "receive" ? "Files received" : "Files sent",
          body: `${count} ${event.direction === "receive" ? "from" : "to"} ${event.peer}`,
        };
  const notification = new Notification(text);
  notification.on("click", () => showWindow());
  notification.show();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 960,
    minHeight: 640,
    title: "V_share",
    backgroundColor: "#0e0e10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Closing the window keeps the app running in the tray, so the phone can still send files.
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function registerIpc(): void {
  handleIpc(CHANNEL.getSnapshot, () => hub.snapshot());
  handleIpc(CHANNEL.pickFiles, async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: "Choose files to send",
      properties: ["openFile", "multiSelections"],
    });
    return result.canceled ? [] : expandPaths(result.filePaths);
  });
  handleIpc(CHANNEL.pickFolder, async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: "Choose a folder to send",
      properties: ["openDirectory"],
    });
    return result.canceled ? [] : expandPaths(result.filePaths);
  });
  handleIpc(CHANNEL.statFiles, (_event, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) throw new Error("Invalid file paths.");
    return expandPaths(paths as string[]);
  });
  handleIpc(CHANNEL.startListening, () => hub.startListening());
  handleIpc(CHANNEL.stopListening, () => hub.stopListening());
  handleIpc(CHANNEL.refreshPairCode, () => hub.refreshPairCode());
  handleIpc(CHANNEL.respondOffer, (_event, offerId: string, accept: boolean) => {
    requireString(offerId, "offer ID", 128);
    if (typeof accept !== "boolean") throw new Error("Invalid offer response.");
    return hub.respondOffer(offerId, accept);
  });
  handleIpc(CHANNEL.sendFiles, (_event, target: string, files: unknown) => hub.sendFiles(requireString(target, "target", 4096), validatePickedFiles(files)));
  handleIpc(CHANNEL.transferAction, (_event, id: string, action: TransferAction) => {
    requireString(id, "transfer ID", 128);
    if (!["pause", "resume", "cancel"].includes(action)) throw new Error("Invalid transfer action.");
    return hub.transferAction(id, action);
  });
  handleIpc(CHANNEL.updateSettings, (_event, patch: Partial<Settings>) => {
    const settings = store.updateSettings(validateSettingsPatch(patch));
    applyTheme(settings.theme);
    hub.emitNow();
    return settings;
  });
  handleIpc(CHANNEL.chooseDownloadDir, async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: "Choose the download folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    store.updateSettings({ downloadDir: result.filePaths[0] });
    hub.emitNow();
    return result.filePaths[0];
  });
  handleIpc(CHANNEL.openPath, (_event, path: string) => {
    const safePath = requireString(path, "path");
    if (!isAbsolute(safePath)) throw new Error("Path must be absolute.");
    return shell.openPath(safePath);
  });
  handleIpc(CHANNEL.showInFolder, (_event, path: string) => {
    const safePath = requireString(path, "path");
    if (!isAbsolute(safePath)) throw new Error("Path must be absolute.");
    return shell.showItemInFolder(safePath);
  });
  handleIpc(CHANNEL.clearHistory, () => {
    store.clearHistory();
    hub.emitNow();
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  app.setAppUserModelId("com.vshare.desktop");
  store = new Store();
  applyTheme(store.settings.theme);
  hub = new TransferHub(store, broadcast, notifyUser);
  registerIpc();
  createWindow();
  tray = createTray({
    show: showWindow,
    isReceiving: () => hub.isListening(),
    toggleReceive: () => {
      void (hub.isListening() ? hub.stopListening() : hub.startListening());
    },
    quit: () => app.quit(),
  });
  await hub.startListening();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
  store?.flush();
});

app.on("window-all-closed", () => {
  void hub?.stopListening().finally(() => app.quit());
});

export function currentSnapshot(): Snapshot | null {
  return lastSnapshot;
}
