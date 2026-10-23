import { Menu, Tray, nativeImage } from "electron";
import { TRAY_ICON_PNG_BASE64 } from "./trayIcon.js";

export interface TrayActions {
  show(): void;
  isReceiving(): boolean;
  toggleReceive(): void;
  quit(): void;
}

export interface TrayHandle {
  /** Rebuilds the menu so its labels match the current state. */
  refresh(): void;
}

/** System tray icon with a small menu: show the window, switch receiving, quit. */
export function createTray(actions: TrayActions): TrayHandle {
  const tray = new Tray(nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_PNG_BASE64}`));
  tray.setToolTip("V_share");

  const refresh = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Show V_share", click: actions.show },
        { label: actions.isReceiving() ? "Stop receiving" : "Start receiving", click: actions.toggleReceive },
        { type: "separator" },
        { label: "Quit V_share", click: actions.quit },
      ]),
    );
  };

  refresh();
  tray.on("click", actions.show);
  return { refresh };
}
