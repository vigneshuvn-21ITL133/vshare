import { describe, expect, it } from "vitest";
import { sortLocalAddresses } from "../electron/network.js";

describe("sortLocalAddresses", () => {
  it("ranks virtual adapters after non-virtual adapters", () => {
    const sorted = sortLocalAddresses([
      { name: "VirtualBox Host-Only Network", address: "192.168.56.1" },
      { name: "Wi-Fi", address: "10.0.0.45" },
    ]);
    expect(sorted.map((entry) => entry.address)).toEqual(["10.0.0.45", "192.168.56.1"]);
  });

  it("keeps private IPv4 ranges preferred for non-virtual adapters", () => {
    const sorted = sortLocalAddresses([
      { name: "Ethernet", address: "172.20.10.4" },
      { name: "Wi-Fi", address: "10.0.0.45" },
      { name: "Local Area Connection", address: "192.168.1.20" },
      { name: "Public", address: "8.8.8.8" },
    ]);
    expect(sorted.map((entry) => entry.address)).toEqual(["192.168.1.20", "10.0.0.45", "172.20.10.4", "8.8.8.8"]);
  });
});
