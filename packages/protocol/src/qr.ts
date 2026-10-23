/**
 * Pairing invite carried in the receiver's QR code.
 *
 *   vshare://pair?v=1&h=<host>&p=<port>&t=<token>&n=<device name>
 *
 * Parsed by hand instead of with URL/URLSearchParams so the same code behaves
 * identically in Node, Electron, and Hermes.
 */
export interface PairInvite {
  host: string;
  port: number;
  token: string;
  name: string;
}

const SCHEME = "vshare://pair?";
const HOST_PATTERN = /^[A-Za-z0-9.-]{1,253}$/;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export function encodePairUri(invite: PairInvite): string {
  const parts = [
    `v=1`,
    `h=${encodeURIComponent(invite.host)}`,
    `p=${invite.port}`,
    `t=${invite.token}`,
    `n=${encodeURIComponent(invite.name)}`,
  ];
  return SCHEME + parts.join("&");
}

/** Returns null for anything that is not a valid V_share pairing URI. */
export function decodePairUri(uri: string): PairInvite | null {
  const trimmed = uri.trim();
  if (!trimmed.startsWith(SCHEME)) return null;

  const fields = new Map<string, string>();
  for (const pair of trimmed.slice(SCHEME.length).split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    try {
      fields.set(pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1)));
    } catch {
      return null;
    }
  }

  if (fields.get("v") !== "1") return null;

  const host = fields.get("h") ?? "";
  const port = Number(fields.get("p"));
  const token = fields.get("t") ?? "";
  const name = (fields.get("n") ?? "").slice(0, 64) || "Device";

  if (!HOST_PATTERN.test(host)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!TOKEN_PATTERN.test(token)) return null;

  return { host, port, token, name };
}
