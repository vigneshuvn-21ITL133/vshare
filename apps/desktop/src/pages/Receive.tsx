import { useEffect, useState } from "react";
import type { Snapshot } from "../../electron/shared";
import { api } from "../vshare";

interface Props {
  snapshot: Snapshot;
  notify(text: string): void;
}

export function ReceivePage({ snapshot, notify }: Props) {
  const { listen, localAddresses, settings, bluetooth } = snapshot;
  const [now, setNow] = useState(Date.now());
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = listen.pairExpiresAt ? Math.max(0, Math.ceil((listen.pairExpiresAt - now) / 1000)) : 0;
  const address = listen.host ? `${listen.host}:${listen.port}` : null;
  const otherAddresses = localAddresses.slice(1);

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(() => notify(`${label} copied`));
  }

  const status = listen.error
    ? listen.error
    : listen.listening
      ? "Ready. Waiting for files."
      : "Receiving is off.";

  return (
    <div className="rx">
      <div className="rx-hero">
        <div className={`rx-avatar${listen.listening ? " live" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="82" fill="none" stroke="currentColor" strokeWidth="16" strokeDasharray="34 14" strokeLinecap="round" />
            <circle cx="100" cy="100" r="42" fill="currentColor" />
          </svg>
        </div>
        <h1 className="rx-name">{settings.deviceName}</h1>
        <p className={`rx-status${listen.error ? " bad" : ""}`}>{status}</p>

        <button
          className={`rx-main${listen.listening ? " stop" : ""}`}
          onClick={() => void (listen.listening ? api.stopListening() : api.startListening())}
        >
          {listen.listening ? "Stop receiving" : "Start receiving"}
        </button>
        <button className="rx-pill" disabled={!listen.listening} onClick={() => setShowCode(true)}>
          Show pairing code
        </button>
      </div>

      {showCode && (
        <div className="rx-modal" role="dialog" aria-label="Pairing code" onClick={() => setShowCode(false)}>
          <div className="rx-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="qr-wrap">
              {listen.qrDataUrl ? <img src={listen.qrDataUrl} alt="Pairing QR code" /> : <div className="qr-placeholder">No network address found</div>}
            </div>
            <p className="rx-small">
              {listen.pairUri
                ? `Code expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`
                : "Code expired"}
            </p>
            <div className="rx-row">
              <button className="rx-btn" onClick={() => void api.refreshPairCode()}>New code</button>
              <button className="rx-btn" disabled={!listen.pairUri} onClick={() => copy(listen.pairUri ?? "", "Pairing link")}>
                Copy link
              </button>
            </div>
            <button className="rx-btn" onClick={() => setShowCode(false)}>Close</button>
          </div>
        </div>
      )}

      <div className="rx-list">
        <div className="rx-item">
          <div>
            <strong>Address</strong>
            <span className="mono">{address ?? "No network"}</span>
            {otherAddresses.length > 0 && <span>Other: {otherAddresses.join(", ")}</span>}
          </div>
          <button className="rx-btn" disabled={!address} onClick={() => copy(address ?? "", "Address")}>Copy</button>
        </div>

        <div className="rx-item">
          <div>
            <strong>Accept over Bluetooth</strong>
            <span>For a phone already paired with this PC in Windows settings</span>
          </div>
          <button
            className={`rx-switch${bluetooth.accepting ? " on" : ""}`}
            aria-label="Accept over Bluetooth"
            disabled={!bluetooth.available}
            onClick={() => {
              const wasOn = bluetooth.accepting;
              void (wasOn ? api.stopBluetooth() : api.startBluetooth()).then(() =>
                notify(wasOn ? "Bluetooth receiving is off" : "Bluetooth receiving is on"),
              );
            }}
          />
        </div>
        {bluetooth.error && <div className="rx-error">{bluetooth.error}</div>}

        <div className="rx-item">
          <div>
            <strong>Allow connections without scanning</strong>
            <span>Phones can connect by typing the address. You still approve every transfer.</span>
          </div>
          <button
            className={`rx-switch${settings.allowManualConnections ? " on" : ""}`}
            aria-label="Allow connections without scanning"
            onClick={() => void api.updateSettings({ allowManualConnections: !settings.allowManualConnections })}
          />
        </div>
      </div>
    </div>
  );
}
