import { useState } from "react";
import type { Snapshot, ThemeMode } from "../../electron/shared";
import { api } from "../vshare";

interface Props {
  snapshot: Snapshot;
  notify(text: string): void;
}

export function SettingsPage({ snapshot, notify }: Props) {
  const { settings } = snapshot;
  const [name, setName] = useState(settings.deviceName);
  const [port, setPort] = useState(String(settings.port));
  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535;

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === settings.deviceName) return;
    await api.updateSettings({ deviceName: trimmed.slice(0, 64) });
    notify("Device name saved");
  }

  async function savePort() {
    if (!portValid || portNumber === settings.port) return;
    await api.stopListening();
    await api.updateSettings({ port: portNumber });
    await api.startListening();
    notify(`Listening on port ${portNumber}`);
  }

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">How this PC appears to other devices, and where files go.</p>

      <div className="stack" style={{ maxWidth: 720 }}>
        <div className="card">
          <h3>Device</h3>
          <div className="field">
            <label htmlFor="device-name">Device name</label>
            <div className="row">
              <input id="device-name" className="input" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} />
              <button className="btn" onClick={() => void saveName()}>Save</button>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Download folder</label>
            <div className="row">
              <div className="input mono small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{settings.downloadDir}</div>
              <button className="btn" onClick={() => void api.chooseDownloadDir().then((dir) => dir && notify("Download folder changed"))}>Change</button>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Network</h3>
          <div className="field">
            <label htmlFor="port">Listening port (1024–65535)</label>
            <div className="row">
              <input id="port" className="input mono" style={{ maxWidth: 160 }} value={port} inputMode="numeric" onChange={(event) => setPort(event.target.value)} />
              <button className="btn" disabled={!portValid} onClick={() => void savePort()}>Apply</button>
            </div>
          </div>
          <div className="row" style={{ marginBottom: 14 }}>
            <div>
              <strong>Allow connections without scanning</strong>
              <div className="small muted">Phones can type this PC's address instead of scanning the code.</div>
            </div>
            <span className="spacer" />
            <button
              className={`switch${settings.allowManualConnections ? " on" : ""}`}
              aria-label="Allow connections without scanning"
              onClick={() => void api.updateSettings({ allowManualConnections: !settings.allowManualConnections })}
            />
          </div>
          <div className="row">
            <div>
              <strong>Encryption</strong>
              <div className="small muted">End-to-end AES-256-GCM. Always on, and it cannot be turned off.</div>
            </div>
            <span className="spacer" />
            <span className="badge ok">On</span>
          </div>
        </div>

        <div className="card">
          <h3>Appearance</h3>
          <div className="row">
            <span>Theme</span>
            <span className="spacer" />
            <div className="segmented">
              {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
                <button key={mode} className={settings.theme === mode ? "on" : ""} onClick={() => void api.updateSettings({ theme: mode })}>
                  {mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
