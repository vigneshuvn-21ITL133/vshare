import { networkInterfaces } from "node:os";

export interface LocalAddress {
  address: string;
  name: string;
}

/** IPv4 addresses on non-internal interfaces, private LAN ranges first. */
export function localAddresses(): LocalAddress[] {
  const found: LocalAddress[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      found.push({ address: entry.address, name });
    }
  }
  return sortLocalAddresses(found);
}

/** The address phones should connect to. Null if the PC has no network. */
export function primaryAddress(): string | null {
  return localAddresses()[0]?.address ?? null;
}

export function sortLocalAddresses(addresses: LocalAddress[]): LocalAddress[] {
  return [...addresses].sort((a, b) => {
    const virtualDiff = Number(isVirtualAdapter(a.name)) - Number(isVirtualAdapter(b.name));
    if (virtualDiff !== 0) return virtualDiff;
    const addressDiff = rank(a.address) - rank(b.address);
    if (addressDiff !== 0) return addressDiff;
    return a.address.localeCompare(b.address);
  });
}

function rank(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

function isVirtualAdapter(name: string): boolean {
  const normalized = name.toLowerCase();
  return [
    "vethernet",
    "virtualbox",
    "vmware",
    "hyper-v",
    "hyperv",
    "wsl",
    "docker",
  ].some((marker) => normalized.includes(marker));
}
