import { useMemo, useState } from "react";
import type { HistoryEntry, Snapshot } from "../../electron/shared";
import { api, formatBytes, formatWhen } from "../vshare";

type Filter = "all" | "send" | "receive";

interface Props {
  snapshot: Snapshot;
  notify(text: string): void;
}

export function HistoryPage({ snapshot, notify }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return snapshot.history.filter((entry) => {
      if (filter !== "all" && entry.direction !== filter) return false;
      if (!needle) return true;
      return entry.name.toLowerCase().includes(needle) || entry.peer.toLowerCase().includes(needle);
    });
  }, [snapshot.history, filter, query]);

  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <div>
          <h1 className="page-title">Transfer History</h1>
          <p className="page-sub" style={{ marginBottom: 18 }}>Files you sent and received on this PC.</p>
        </div>
        <span className="spacer" />
        <button className="btn ghost" disabled={snapshot.history.length === 0} onClick={() => void api.clearHistory().then(() => notify("History cleared"))}>Clear history</button>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <input className="input" style={{ maxWidth: 340 }} placeholder="Search files or devices" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="segmented">
          {(["all", "send", "receive"] as Filter[]).map((value) => (
            <button key={value} className={filter === value ? "on" : ""} onClick={() => setFilter(value)}>
              {value === "all" ? "All" : value === "send" ? "Sent" : "Received"}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {rows.length === 0 && <div className="empty">{snapshot.history.length === 0 ? "No transfers yet." : "No matches."}</div>}
        {rows.map((entry) => (
          <HistoryRow key={entry.id} entry={entry} notify={notify} />
        ))}
      </div>
    </>
  );
}

function HistoryRow({ entry, notify }: { entry: HistoryEntry; notify: (text: string) => void }) {
  const badge = entry.status === "done" ? "ok" : entry.status === "declined" || entry.status === "cancelled" ? "warn" : "bad";
  const label = entry.status === "done" ? (entry.direction === "send" ? "Sent" : "Received") : entry.status;
  return (
    <div className="list-row">
      <div className="file-icon">{entry.direction === "send" ? "↑" : "↓"}</div>
      <div className="file-meta">
        <strong>{entry.name}</strong>
        <span>{formatBytes(entry.size)} · {entry.direction === "send" ? "to" : "from"} {entry.peer} · {formatWhen(entry.when)}</span>
      </div>
      <span className={`badge ${badge}`}>{label}</span>
      {entry.location && (
        <>
          <button className="btn small" onClick={() => void api.openPath(entry.location!).then(() => undefined, () => notify("That file is no longer there"))}>Open</button>
          <button className="btn small" onClick={() => void api.showInFolder(entry.location!)}>Folder</button>
        </>
      )}
    </div>
  );
}
