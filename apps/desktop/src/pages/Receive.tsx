import { useEffect, useState } from "react";
import type { Snapshot } from "../../electron/shared";
import { api } from "../vshare";

interface Props {
  snapshot: Snapshot;
  notify(text: string): void;
}

export function ReceivePage({ snapshot, notify }: Props) {
  const { listen, localAddresses, settings } = snapshot;
  const address = listen.host ? `${listen.host}:${listen.port}` : "No network";
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = listen.pairExpiresAt ? Math.max(0, Math.ceil((listen.pairExpiresAt - now) / 1000)) : 0;

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(() => notify(`${label} copied`));
  }

  return (
    <>
      <h1 className="page-title">Receive Files</h1>
      <p className="page-sub">Scan this code with the V_share app on your phone, or enter the address manually.</p>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="qr-wrap">
            {listen.qrDataUrl ? <img src={listen.qrDataUrl} alt="Pairing QR code" /> : <div className="qr-placeholder">{listen.listening ? "No network address found" : "Receiving is off. Turn it on to show a code."}</div>}
          </div>
          <div className="row" style={{ marginTop: 14, justifyContent: "center" }}>
            <span className="small muted">
              {listen.pairUri ? `Code refreshes in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : listen.listening ? "Code expired" : ""}
            </span>
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: "center" }}>
            <button className="btn" disabled={!listen.listening} onClick={() => void api.refreshPairCode()}>New code</button>
            <button className="btn" disabled={!listen.pairUri} onClick={() => copy(listen.pairUri ?? "", "Pairing link")}>Copy link</button>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="row">
              <div>
                <div className="muted small">Accepting files</div>
                <strong>{listen.listening ? "On" : "Off"}</strong>
              </div>
              <span className="spacer" />
              <button
                className={`switch${listen.listening ? " on" : ""}`}
                aria-label="Accept incoming files"
                onClick={() => void (listen.listening ? api.stopListening() : api.startListening())}
              />
            </div>
            {listen.error && <div className="error-text">{listen.error}</div>}
          </div>

          <div className="card">
            <h3>This PC</h3>
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="chip">
                <span>IP address</span>
                <strong className="mono">{listen.host ?? "—"}</strong>
              </div>
              <div className="chip">
                <span>Port</span>
                <strong className="mono">{listen.port}</strong>
              </div>
            </div>
            <div className="row">
              <button className="btn" disabled={!listen.host} onClick={() => copy(address, "Address")}>Copy address</button>
              <span className="spacer" />
              <span className="small muted">{listen.listening ? "Waiting for connection..." : "Off"}</span>
            </div>
            {localAddresses.length > 1 && (
              <p className="small muted" style={{ marginBottom: 0 }}>Other addresses: {localAddresses.slice(1).join(", ")}</p>
            )}
          </div>

          <div className="card">
            <div className="row">
              <div>
                <strong>Allow connections without scanning</strong>
                <div className="small muted">Phones can connect by typing the address. You still approve every transfer.</div>
              </div>
              <span className="spacer" />
              <button
                className={`switch${settings.allowManualConnections ? " on" : ""}`}
                aria-label="Allow manual connections"
                onClick={() => void api.updateSettings({ allowManualConnections: !settings.allowManualConnections })}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
