import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTarget } from "../electron/target.js";
import { sanitizeName, uniquePath, fileSourceFor, fileSinkIn, expandPaths } from "../electron/files.js";
import { encodePairUri, randomHex } from "@vshare/protocol";

describe("parseTarget", () => {
  it("accepts a pairing link and keeps its token", () => {
    const token = randomHex(16);
    const uri = encodePairUri({ host: "192.168.1.20", port: 47800, token, name: "Pixel" });
    expect(parseTarget(uri)).toEqual({ ok: true, host: "192.168.1.20", port: 47800, token });
  });

  it("accepts a bare address and uses the default port when none is given", () => {
    expect(parseTarget("192.168.1.23")).toEqual({ ok: true, host: "192.168.1.23", port: 47800 });
    expect(parseTarget(" 10.0.0.5:9000 ")).toEqual({ ok: true, host: "10.0.0.5", port: 9000 });
  });

  it("rejects malformed input without throwing", () => {
    expect(parseTarget("vshare://pair?v=1&h=10.0.0.1").ok).toBe(false);
    expect(parseTarget("http://example.com").ok).toBe(false);
    expect(parseTarget("10.0.0.1:70000").ok).toBe(false);
    expect(parseTarget("").ok).toBe(false);
  });
});

describe("sanitizeName", () => {
  it("strips path segments and reserved Windows characters", () => {
    expect(sanitizeName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeName("a<b>c:d.txt")).toBe("a_b_c_d.txt");
    expect(sanitizeName("con.txt")).toBe("file_con.txt");
    expect(sanitizeName("trailing. ")).toBe("trailing");
    expect(sanitizeName("")).toBe("file_");
  });
});

describe("file helpers on disk", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vshare-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("picks a free name instead of overwriting", () => {
    writeFileSync(join(dir, "photo.jpg"), "x");
    expect(uniquePath(dir, "photo.jpg")).toBe(join(dir, "photo (2).jpg"));
    writeFileSync(join(dir, "photo (2).jpg"), "y");
    expect(uniquePath(dir, "photo.jpg")).toBe(join(dir, "photo (3).jpg"));
  });

  it("reads a source in ranges that match the original bytes", async () => {
    const path = join(dir, "data.bin");
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
    writeFileSync(path, bytes);
    const source = await fileSourceFor(path);
    expect(source.size).toBe(5000);
    const slice = await source.read(1000, 100);
    expect(Array.from(slice)).toEqual(Array.from(bytes.subarray(1000, 1100)));
  });

  it("writes a sink and removes it on abort", async () => {
    const sink = await fileSinkIn(dir, "out.txt");
    await sink.write(new TextEncoder().encode("hello"));
    const finished = await sink.finish();
    expect(readFileSync(finished, "utf8")).toBe("hello");

    const aborted = await fileSinkIn(dir, "partial.txt");
    await aborted.write(new TextEncoder().encode("half"));
    await aborted.abort();
    expect(existsSync(aborted.path)).toBe(false);
  });

  it("rejects a selected top-level symbolic link", async () => {
    const target = join(dir, "outside.txt");
    const link = join(dir, "linked.txt");
    writeFileSync(target, "outside");
    try {
      symlinkSync(target, link);
    } catch {
      // Some Windows setups disable symlink creation without Developer Mode/admin rights.
      return;
    }
    await expect(expandPaths([link])).rejects.toThrow(/symbolic links cannot be sent/i);
    await expect(fileSourceFor(link)).rejects.toThrow(/not a regular file/i);
  });

  it("expands a folder into relative names", async () => {
    const root = join(dir, "Trip");
    mkdirSync(join(root, "day1"), { recursive: true });
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "day1", "b.txt"), "bb");
    const items = await expandPaths([root]);
    expect(items.map((item) => item.name).sort()).toEqual(["Trip/a.txt", "Trip/day1/b.txt"]);
    expect(items.find((item) => item.name === "Trip/day1/b.txt")?.size).toBe(2);
  });

  it("creates nested folders for a relative name and refuses unsafe ones", async () => {
    const sink = await fileSinkIn(dir, "Photos/2024/cat.jpg");
    await sink.write(new TextEncoder().encode("meow"));
    const finished = await sink.finish();
    expect(finished).toBe(join(dir, "Photos", "2024", "cat.jpg"));
    expect(readFileSync(finished, "utf8")).toBe("meow");
    await expect(fileSinkIn(dir, "../escape.txt")).rejects.toThrow();
    await expect(fileSinkIn(dir, "a/../../b.txt")).rejects.toThrow();
    expect(existsSync(join(dir, "..", "escape.txt"))).toBe(false);
  });
});
