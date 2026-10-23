import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  CHANNEL,
  type PickedFile,
  type SendOutcome,
  type Settings,
  type Snapshot,
  type TransferAction,
  type VShareApi,
} from "./shared.js";

const api: VShareApi = {
  getSnapshot: () => ipcRenderer.invoke(CHANNEL.getSnapshot) as Promise<Snapshot>,
  onSnapshot(callback) {
    const listener = (_event: unknown, snapshot: Snapshot) => callback(snapshot);
    ipcRenderer.on(CHANNEL.snapshot, listener);
    return () => ipcRenderer.removeListener(CHANNEL.snapshot, listener);
  },
  pickFiles: () => ipcRenderer.invoke(CHANNEL.pickFiles) as Promise<PickedFile[]>,
  pickFolder: () => ipcRenderer.invoke(CHANNEL.pickFolder) as Promise<PickedFile[]>,
  statFiles: (paths) => ipcRenderer.invoke(CHANNEL.statFiles, paths) as Promise<PickedFile[]>,
  // Electron 32+ removed File.path; webUtils is the supported way to get a real path for a dropped file.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  startListening: () => ipcRenderer.invoke(CHANNEL.startListening) as Promise<void>,
  stopListening: () => ipcRenderer.invoke(CHANNEL.stopListening) as Promise<void>,
  refreshPairCode: () => ipcRenderer.invoke(CHANNEL.refreshPairCode) as Promise<void>,
  respondOffer: (offerId, accept) => ipcRenderer.invoke(CHANNEL.respondOffer, offerId, accept) as Promise<void>,
  sendFiles: (target, files) => ipcRenderer.invoke(CHANNEL.sendFiles, target, files) as Promise<SendOutcome>,
  transferAction: (id, action: TransferAction) => ipcRenderer.invoke(CHANNEL.transferAction, id, action) as Promise<void>,
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke(CHANNEL.updateSettings, patch) as Promise<Settings>,
  chooseDownloadDir: () => ipcRenderer.invoke(CHANNEL.chooseDownloadDir) as Promise<string | null>,
  openPath: (path) => ipcRenderer.invoke(CHANNEL.openPath, path) as Promise<void>,
  showInFolder: (path) => ipcRenderer.invoke(CHANNEL.showInFolder, path) as Promise<void>,
  clearHistory: () => ipcRenderer.invoke(CHANNEL.clearHistory) as Promise<void>,
};

contextBridge.exposeInMainWorld("vshare", api);
