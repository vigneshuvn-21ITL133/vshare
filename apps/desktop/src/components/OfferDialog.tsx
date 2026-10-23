import { useEffect, useState } from "react";
import type { Snapshot } from "../../electron/shared";
import { api, formatBytes } from "../vshare";

/** Shown over any page while a sender is waiting for approval. */
export function OfferDialog({ snapshot }: { snapshot: Snapshot }) {
  const offer = snapshot.offers[0];
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!offer) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [offer]);

  if (!offer) return null;
  const secondsLeft = Math.max(0, Math.ceil((offer.expiresAt - now) / 1000));

  return (
    <div className="scrim">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="offer-title">
        <h2 id="offer-title">Incoming files from {offer.peer}</h2>
        <div className="muted small">
          {offer.fileCount} {offer.fileCount === 1 ? "file" : "files"} · {formatBytes(offer.totalBytes)} · auto-declines in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </div>
        <div className="code" aria-label="Verification code">{offer.verificationCode}</div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Check that this code matches the code shown on the sending device before you accept.
        </p>
        <ul className="small" style={{ paddingLeft: 18, maxHeight: 120, overflow: "auto" }}>
          {offer.fileNames.slice(0, 20).map((name) => (
            <li key={name} className="mono">{name}</li>
          ))}
        </ul>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn danger" onClick={() => void api.respondOffer(offer.id, false)}>Decline</button>
          <span className="spacer" />
          <button className="btn primary" onClick={() => void api.respondOffer(offer.id, true)}>Accept</button>
        </div>
      </div>
    </div>
  );
}
