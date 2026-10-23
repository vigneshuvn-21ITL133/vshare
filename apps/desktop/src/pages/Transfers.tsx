import { useState } from "react";
import type { Snapshot, TransferView } from "../../electron/shared";
import { api, formatBytes, percent, STATE_LABEL } from "../vshare";

type Tab = "active" | "completed" | "failed";
const ACTIVE_STATES = new Set(["preparing", "connecting", "verifying", "waiting", "sending", "receiving", "paused"]);

export function TransfersPage({ snapshot }: { snapshot: Snapshot }) {
  const [tab, setTab] = useState<Tab>("active");
  const finished = snapshot.history.filter((entry) => entry.status === "done");
  const failed = snapshot.history.filter((entry) => entry.status !== "done");
  const liveList = snapshot.transfers;

  return (
    <>
      <h1 className="page-title">Transfers</h1>
      <p className="page-sub">Live transfers, and what finished recently.</p>
      <div className="segmented" style={{ marginBottom: 18 }}>
        {(["active", "completed", "failed"] as Tab[]).map((value) => (
          <button key={value} className={tab === value ? "on" : ""} onClick={() => setTab(value)}>
            {value === "active" ? `Active (${liveList.length})` : value === "completed" ? "Completed" : "Failed"}
          </button>
        ))}
      </div>

      {tab === "active" && (
        <div className="stack">
          {liveList.length === 0 && <div className="card empty">Nothing is transferring right now.</div>}
          {liveList.map((transfer) => (
            <LiveRow key={transfer.id} transfer={transfer} />
          ))}
        </div>
      )}

      {tab === "completed" && (
        <div className="card">
          {finished.length === 0 && <div className="empty">No completed transfers yet.</div>}
          {finished.map((entry) => (
            <div className="list-row" key={entry.id}>
              <div className="file-icon">{entry.direction === "send" ? "↑" : "↓"}</div>
              <div className="file-meta"><strong>{entry.name}</strong><span>{formatBytes(entry.size)} · {entry.peer}</span></div>
              <span className="badge ok">Completed</span>
            </div>
          ))}
        </div>
      )}

      {tab === "failed" && (
        <div className="card">
          {failed.length === 0 && <div className="empty">Nothing failed.</div>}
          {failed.map((entry) => (
            <div className="list-row" key={entry.id}>
              <div className="file-icon">!</div>
              <div className="file-meta"><strong>{entry.name}</strong><span>{entry.peer}</span></div>
              <span className="badge bad">{entry.status}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function LiveRow({ transfer }: { transfer: TransferView }) {
  const pct = percent(transfer.bytesDone, transfer.totalBytes);
  const elapsed = (Date.now() - transfer.startedAt) / 1000;
  const speed = elapsed >= 2 ? transfer.bytesDone / elapsed : 0;
  const remaining = speed > 0 ? (transfer.totalBytes - transfer.bytesDone) / speed : 0;
  const canControl = transfer.state === "sending" || transfer.state === "receiving" || transfer.state === "paused";
  const title = transfer.fileNames.length === 1 ? transfer.fileNames[0] : `${transfer.fileCount} files`;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="file-icon">{transfer.direction === "send" ? "↑" : "↓"}</div>
        <div className="file-meta">
          <strong>{title}</strong>
          <span>{transfer.direction === "send" ? "To" : "From"} {transfer.peer} · {formatBytes(transfer.totalBytes)}</span>
        </div>
        <span className={`badge ${transfer.state === "paused" ? "warn" : transfer.state === "verifying" || transfer.state === "waiting" ? "accent" : ""}`}>
          {STATE_LABEL[transfer.state] ?? transfer.state}
        </span>
        {canControl && (
          <>
            <button className="icon-btn" aria-label={transfer.paused ? "Resume" : "Pause"} onClick={() => void api.transferAction(transfer.id, transfer.paused ? "resume" : "pause")}>
              {transfer.paused ? "▶" : "❚❚"}
            </button>
          </>
        )}
        {(canControl || transfer.state === "waiting" || transfer.state === "connecting") && (
          <button className="icon-btn" aria-label="Cancel" onClick={() => void api.transferAction(transfer.id, "cancel")}>✕</button>
        )}
      </div>
      <div className="progress"><div style={{ width: `${pct}%` }} /></div>
      <div className="row small muted" style={{ marginTop: 8 }}>
        <span>{pct}% · {formatBytes(transfer.bytesDone)} of {formatBytes(transfer.totalBytes)}</span>
        {transfer.currentFile && <span>· {transfer.currentFile}</span>}
        <span className="spacer" />
        {transfer.state === "verifying" || transfer.state === "waiting"
          ? <span className="mono">Code {transfer.verificationCode ?? "------"}</span>
          : transfer.state === "sending" || transfer.state === "receiving" ? <span>{remaining > 0 ? `${formatDuration(remaining)} left` : ""}</span> : null}
      </div>
    </div>
  );
}

/** "42s", "3m 05s", "1h 12m"; anything beyond a day is treated as unknown. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86_400) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}
