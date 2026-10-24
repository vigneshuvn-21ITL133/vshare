import { networkInterfaces } from "node:os";

export interface LocalAddress {
  address: string;
  name: string;
}

/** Adapters that are usually virtual or local-only. Phones cannot reach a PC through these. */
const VIRTUAL_ADAPTER = /virtual|vethernet|vmware|vmnet|virtualbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|bluetooth|default switch/i;

/** IPv4 addresses on non-internal interfaces, best candidates first. */
export function localAddresses(): LocalAddress[] {
  const found: LocalAddress[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      found.push({ address: entry.address, name });
    }
  }
  return sortCandidates(found);
}

/** The address phones should connect to. Null if the PC has no network. */
export function primaryAddress(): string | null {
  return localAddresses()[0]?.address ?? null;
}

/**
 * Orders candidates so real adapters beat virtual ones, and private LAN ranges
 * beat everything else. Without the adapter check, a VirtualBox or Hyper-V
 * "192.168.x.x" address could be chosen over the real Wi-Fi address.
 */
export function sortCandidates(entries: LocalAddress[]): LocalAddress[] {
  return [...entries].sort((a, b) => score(a) - score(b));
}

function score(entry: LocalAddress): number {
  return (VIRTUAL_ADAPTER.test(entry.name) ? 10 : 0) + rank(entry.address);
}

function rank(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}
