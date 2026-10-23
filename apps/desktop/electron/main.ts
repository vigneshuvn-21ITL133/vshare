import { app, BrowserWindow, Notification, dialog, ipcMain, shell, nativeTheme } from "electron";
import { join } from "node:path";
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
  ipcMain.handle(CHANNEL.getSnapshot, () => hub.snapshot());
  ipcMain.handle(CHANNEL.pickFiles, async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: "Choose files to send",
      properties: ["openFile", "multiSelections"],
    });
    return result.canceled ? [] : expandPaths(result.filePaths);
  });
  ipcMain.handle(CHANNEL.pickFolder, async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: "Choose a folder to send",
      properties: ["openDirectory"],
    });
    return result.canceled ? [] : expandPaths(result.filePaths);
  });
  ipcMain.handle(CHANNEL.statFiles, (_event, paths: string[]) => expandPaths(paths));
  ipcMain.handle(CHANNEL.startListening, () => hub.startListening());
  ipcMain.handle(CHANNEL.stopListening, () => hub.stopListening());
  ipcMain.handle(CHANNEL.refreshPairCode, () => hub.refreshPairCode());
  ipcMain.handle(CHANNEL.respondOffer, (_event, offerId: string, accept: boolean) => hub.respondOffer(offerId, accept));
  ipcMain.handle(CHANNEL.sendFiles, (_event, target: string, files: PickedFile[]) => hub.sendFiles(target, files));
  ipcMain.handle(CHANNEL.transferAction, (_event, id: string, action: TransferAction) => hub.transferAction(id, action));
  ipcMain.handle(CHANNEL.updateSettings, (_event, patch: Partial<Settings>) => {
    const settings = store.updateSettings(patch);
    applyTheme(settings.theme);
    hub.emitNow();
    return settings;
  });
  ipcMain.handle(CHANNEL.chooseDownloadDir, async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: "Choose the download folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    store.updateSettings({ downloadDir: result.filePaths[0] });
    hub.emitNow();
    return result.filePaths[0];
  });
  ipcMain.handle(CHANNEL.openPath, (_event, path: string) => shell.openPath(path));
  ipcMain.handle(CHANNEL.showInFolder, (_event, path: string) => shell.showItemInFolder(path));
  ipcMain.handle(CHANNEL.clearHistory, () => {
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
