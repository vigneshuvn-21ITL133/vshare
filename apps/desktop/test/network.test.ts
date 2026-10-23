import { describe, expect, it } from "vitest";
import { sortCandidates } from "../electron/network.js";

describe("sortCandidates", () => {
  it("prefers the real Wi-Fi address over a virtual 192.168 adapter", () => {
    const sorted = sortCandidates([
      { address: "192.168.56.1", name: "VirtualBox Host-Only Network" },
      { address: "10.0.0.5", name: "Wi-Fi" },
    ]);
    expect(sorted[0].address).toBe("10.0.0.5");
  });

  it("prefers 192.168 over 10.x on real adapters", () => {
    const sorted = sortCandidates([
      { address: "10.0.0.5", name: "Ethernet" },
      { address: "192.168.1.20", name: "Wi-Fi" },
    ]);
    expect(sorted[0].address).toBe("192.168.1.20");
  });

  it("still returns a virtual address when it is the only one", () => {
    const sorted = sortCandidates([{ address: "172.20.0.1", name: "vEthernet (WSL)" }]);
    expect(sorted[0].address).toBe("172.20.0.1");
  });
});
