export type PageId = "home" | "send" | "receive" | "transfers" | "history" | "settings";

const ITEMS: Array<{ id: PageId; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "send", label: "Send", icon: "↑" },
  { id: "receive", label: "Receive", icon: "↓" },
  { id: "transfers", label: "Transfers", icon: "⇄" },
  { id: "history", label: "History", icon: "◷" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

interface Props {
  active: PageId;
  onNavigate(page: PageId): void;
  deviceName: string;
  listening: boolean;
  activeCount: number;
}

export function Sidebar({ active, onNavigate, deviceName, listening, activeCount }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">V</span>
        <span>V_share</span>
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={`nav-item${active === item.id ? " active" : ""}`}
          onClick={() => onNavigate(item.id)}
        >
          <span className="nav-icon">{item.icon}</span>
          <span>{item.label}</span>
          {item.id === "transfers" && activeCount > 0 && <span className="badge accent" style={{ marginLeft: "auto" }}>{activeCount}</span>}
        </button>
      ))}
      <div className="sidebar-foot">
        <strong>{deviceName}</strong>
        <span className={`dot${listening ? " on" : ""}`} />
        {listening ? "Online" : "Receiving off"}
      </div>
    </aside>
  );
}
