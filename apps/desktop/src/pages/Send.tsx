import { useState, type DragEvent } from "react";
import type { BluetoothDeviceInfo, PickedFile, SendOutcome, Snapshot } from "../../electron/shared";
import type { PageId } from "../components/Sidebar";
import { api, formatBytes } from "../vshare";

interface Props {
  snapshot: Snapshot;
  notify(text: string): void;
  go(page: PageId): void;
}

/** Rows drawn in the selection list. A big folder would otherwise make the page slow. */
const LIST_LIMIT = 200;

export function SendPage({ snapshot, notify, go }: Props) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [target, setTarget] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<BluetoothDeviceInfo[] | null>(null);
  const [btError, setBtError] = useState<string | null>(null);
  const [btBusy, setBtBusy] = useState(false);
  void snapshot;

  const total = files.reduce((sum, file) => sum + file.size, 0);

  function merge(picked: PickedFile[]) {
    if (picked.length === 0) return;
    setFiles((current) => {
      const seen = new Set(current.map((file) => file.path));
      return [...current, ...picked.filter((file) => !seen.has(file.path))];
    });
  }

  function fail(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
  }

  /** Dropped paths may be files or folders; the main process expands folders into their files. */
  function addPaths(paths: string[]) {
    if (paths.length === 0) return;
    api.statFiles(paths).then(merge, (err: unknown) => fail(err, "Could not read those files."));
  }

  async function browse() {
    try {
      merge(await api.pickFiles());
    } catch (err) {
      fail(err, "Could not open the file picker.");
    }
  }

  async function addFolder() {
    try {
      setError(null);
      merge(await api.pickFolder());
    } catch (err) {
      fail(err, "Could not read that folder.");
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const paths = Array.from(event.dataTransfer.files).map((file) => api.pathForFile(file)).filter(Boolean);
    addPaths(paths);
  }

  /** Common result handling for both Wi-Fi and Bluetooth sends. */
  function afterSend(outcome: SendOutcome, report: (message: string) => void) {
    if (outcome.ok) {
      setFiles([]);
      notify("Sent. Approve the transfer on the other device if asked.");
      go("transfers");
    } else {
      report(outcome.error);
    }
  }

  async function send() {
    setError(null);
    setBusy(true);
    const outcome = await api.sendFiles(target, files);
    setBusy(false);
    afterSend(outcome, setError);
  }

  async function loadPaired() {
    setBtError(null);
    const result = await api.bluetoothPaired();
    if (result.ok) {
      setDevices(result.devices);
    } else {
      setDevices(null);
      setBtError(result.error);
    }
  }

  async function sendOverBluetooth(device: BluetoothDeviceInfo) {
    setBtError(null);
    setBtBusy(true);
    const outcome = await api.sendBluetooth(device.address, files);
    setBtBusy(false);
    afterSend(outcome, setBtError);
  }

  return (
    <>
      <h1 className="page-title">Send Files</h1>
      <p className="page-sub">Drop files or folders here, or browse. Then paste the receiver's pairing link or address.</p>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="stack">
          <div
            className={`dropzone${dragging ? " over" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <div className="up">⇪</div>
            <div>Drag and drop files or folders</div>
            <div className="small muted" style={{ marginBottom: 12 }}>Any size. Sent in encrypted 1 MB chunks.</div>
            <div className="row" style={{ justifyContent: "center", gap: 8 }}>
              <button className="btn" onClick={() => void browse()}>Browse files</button>
              <button className="btn" onClick={() => void addFolder()}>Add folder</button>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>Selected ({files.length})</h3>
              <span className="spacer" />
              {files.length > 0 && <button className="btn ghost small" onClick={() => setFiles([])}>Clear all</button>}
            </div>
            {files.length === 0 && <div className="empty">No files selected yet.</div>}
            {files.slice(0, LIST_LIMIT).map((file) => (
              <div className="list-row" key={file.path}>
                <div className="file-icon">▤</div>
                <div className="file-meta">
                  <strong>{file.name}</strong>
                  <span>{formatBytes(file.size)}</span>
                </div>
                <button className="icon-btn" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item.path !== file.path))}>✕</button>
              </div>
            ))}
            {files.length > LIST_LIMIT && <div className="small muted" style={{ marginTop: 8 }}>and {files.length - LIST_LIMIT} more</div>}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3>Receiver</h3>
            <div className="field">
              <label htmlFor="target">Pairing link or address</label>
              <input
                id="target"
                className="input mono"
                placeholder="vshare://pair?... or 192.168.1.23:47800"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
            </div>
            <p className="small muted" style={{ marginTop: 0 }}>
              On the phone, open Receive and copy the pairing link, or type the address shown under the QR code.
              A link is one-time use and expires in two minutes.
            </p>
            {error && <div className="error-text">{error}</div>}
            <div className="row" style={{ marginTop: 14 }}>
              <span className="muted small">{files.length} file(s) · {formatBytes(total)}</span>
              <span className="spacer" />
              <button className="btn primary" disabled={busy || files.length === 0 || target.trim() === ""} onClick={() => void send()}>
                {busy ? "Connecting..." : `Send${files.length ? ` (${files.length}) ${formatBytes(total)}` : ""}`}
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Send over Bluetooth</h3>
            <p className="small muted" style={{ marginTop: 0 }}>
              The phone must be paired with this PC in Windows settings, and V_share on the phone must have
              "Receive over Bluetooth" turned on. Choose files on the left first.
            </p>
            <button className="btn" disabled={btBusy} onClick={() => void loadPaired()}>Show paired phones</button>
            {btError && <div className="error-text">{btError}</div>}
            {devices !== null && devices.length === 0 && <div className="empty">No paired devices found.</div>}
            {devices?.map((device) => (
              <div className="list-row" key={device.address}>
                <div className="file-meta">
                  <strong>{device.name || "Unnamed device"}</strong>
                  <span className="mono">{device.address}</span>
                </div>
                <button
                  className="btn primary small"
                  disabled={btBusy || files.length === 0}
                  onClick={() => void sendOverBluetooth(device)}
                >
                  {btBusy ? "Sending..." : "Send"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
