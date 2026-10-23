import type { Snapshot } from "../../electron/shared";
import type { PageId } from "../components/Sidebar";
import { formatBytes, formatWhen } from "../vshare";

interface Props {
  snapshot: Snapshot;
  go(page: PageId): void;
}

export function Home({ snapshot, go }: Props) {
  const recent = snapshot.history.slice(0, 5);
  const address = snapshot.listen.host ? `${snapshot.listen.host}:${snapshot.listen.port}` : "No network connection";

  return (
    <div className="stack">
      <div className="hero">
        <div className="hero-art" aria-hidden="true" />
        <h1>Share Files.<br />Connect Devices.<br /><span>No Limits.</span></h1>
        <p>Fast, encrypted, local file transfer between your Windows PC and Android phone. Nothing leaves your WiFi.</p>
        <div className="row" style={{ marginTop: 18 }}>
          <span className="pill">
            <span className={`dot${snapshot.listen.listening ? " on" : ""}`} />
            {snapshot.listen.listening ? `Listening on ${address}` : snapshot.listen.error ? "Receiving is off" : "Receiving is off"}
          </span>
        </div>
        {snapshot.listen.error && <div className="error-text">{snapshot.listen.error}</div>}
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="grid-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <button className="action-card cream" onClick={() => go("send")}>
              <span className="icon">↑</span>
              <strong>Send Files</strong>
              <span>Choose files to send to another device.</span>
              <span className="arrow">→</span>
            </button>
            <button className="action-card cream" onClick={() => go("receive")}>
              <span className="icon">↓</span>
              <strong>Receive Files</strong>
              <span>Show the QR code or your address to receive.</span>
              <span className="arrow">→</span>
            </button>
          </div>

          <div className="card">
            <h3>Quick connect</h3>
            <div className="row">
              <div className="chip"><strong>Local network</strong><span>{snapshot.localAddresses[0] ?? "Not connected"}</span></div>
              <div className="chip"><strong>Hotspot mode</strong><span className="tag">Planned</span><div className="small muted">Create or join a network</div></div>
              <div className="chip"><strong>Bluetooth LE</strong><span className="tag">Planned</span><div className="small muted">Small files only</div></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>Recent activity</h3>
            <span className="spacer" />
            <button className="btn ghost small" onClick={() => go("history")}>View all</button>
          </div>
          {recent.length === 0 && <div className="empty">No transfers yet.</div>}
          {recent.map((entry) => (
            <div className="list-row" key={entry.id}>
              <div className="file-icon">{entry.direction === "send" ? "↑" : "↓"}</div>
              <div className="file-meta">
                <strong>{entry.name}</strong>
                <span>{formatBytes(entry.size)} · {entry.direction === "send" ? "Sent" : "Received"} · {formatWhen(entry.when)}</span>
              </div>
              <span className={`badge ${entry.status === "done" ? "ok" : entry.status === "error" ? "bad" : ""}`}>
                {entry.status === "done" ? "Done" : entry.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
