import { decodePairUri, DEFAULT_PORT } from "@vshare/protocol";

export type ParsedTarget =
  | { ok: true; host: string; port: number; token?: string }
  | { ok: false; error: string };

/** Accepts a pairing link (vshare://...) or a host with an optional port. Never throws. */
export function parseTarget(target: string): ParsedTarget {
  const trimmed = target.trim();
  if (trimmed.startsWith("vshare://")) {
    const invite = decodePairUri(trimmed);
    if (!invite) return { ok: false, error: "That pairing link is not valid or is incomplete." };
    return { ok: true, host: invite.host, port: invite.port, token: invite.token };
  }
  const match = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(trimmed);
  if (!match) return { ok: false, error: "Enter a pairing link or an address like 192.168.1.23:47800." };
  const port = match[2] ? Number(match[2]) : DEFAULT_PORT;
  if (port < 1 || port > 65535) return { ok: false, error: "The port number is out of range." };
  return { ok: true, host: match[1], port };
}
