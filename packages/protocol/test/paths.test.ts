import { describe, expect, it } from "vitest";
import { safeRelativeSegments } from "../src/index.js";

describe("safeRelativeSegments", () => {
  it("splits folder paths from either separator", () => {
    expect(safeRelativeSegments("photos/2026/a.jpg")).toEqual(["photos", "2026", "a.jpg"]);
    expect(safeRelativeSegments("photos\\2026\\a.jpg")).toEqual(["photos", "2026", "a.jpg"]);
  });

  it("rejects traversal, absolute paths, and drive letters", () => {
    expect(safeRelativeSegments("../secret.txt")).toBeNull();
    expect(safeRelativeSegments("a/../../b")).toBeNull();
    expect(safeRelativeSegments("/etc/passwd")).toBeNull();
    expect(safeRelativeSegments("C:\\Windows\\x")).toBeNull();
    expect(safeRelativeSegments("")).toBeNull();
    expect(safeRelativeSegments("a\u0000b")).toBeNull();
  });
});
