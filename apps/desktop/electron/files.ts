import { open, stat, lstat, unlink, mkdir, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { existsSync } from "node:fs";
import { safeRelativeSegments, type FileSink, type FileSource } from "@vshare/protocol";
import type { PickedFile } from "./shared.js";

/** Most files one transfer may carry. Matches the protocol's offer limit. */
export const MAX_FILES = 10_000;

const MIME_BY_EXT: Record<string, string> = {
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".zip": "application/zip",
  ".json": "application/json",
};

export function mimeFor(name: string): string {
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Turns picked paths into sendable files. A folder becomes all of its files,
 * named relative to the folder's parent, e.g. "Trip/day1/a.txt".
 * Symbolic links are skipped so a link cannot pull in files from outside the folder.
 */
export async function expandPaths(paths: string[]): Promise<PickedFile[]> {
  if (!Array.isArray(paths) || paths.length > MAX_FILES) {
    throw new Error(`Choose at most ${MAX_FILES} paths at a time.`);
  }
  const out: PickedFile[] = [];
  for (const path of paths) {
    if (typeof path !== "string" || path.length === 0 || path.length > 32_767) {
      throw new Error("A selected path is invalid.");
    }
    // lstat does not follow a top-level symlink/junction. walk() already skips
    // symlinks found inside folders, so this closes the top-level escape path too.
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new Error(`Symbolic links cannot be sent: "${basename(path)}".`);
    }
    if (info.isFile()) {
      out.push({ path, name: basename(path), size: info.size });
    } else if (info.isDirectory()) {
      const root = basename(path);
      const before = out.length;
      await walk(path, root, out);
      if (out.length === before) throw new Error(`"${root}" has no files to send.`);
    } else {
      throw new Error(`${basename(path)} is not a file or folder.`);
    }
    if (out.length > MAX_FILES) throw new Error(`Too many files. Send at most ${MAX_FILES} at a time.`);
  }
  return out;
}

async function walk(dir: string, prefix: string, out: PickedFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(full, name, out);
    } else if (entry.isFile()) {
      if (!safeRelativeSegments(name)) throw new Error(`"${entry.name}" has a name that cannot be sent.`);
      const info = await stat(full);
      out.push({ path: full, name, size: info.size });
      if (out.length > MAX_FILES) throw new Error(`Too many files. Send at most ${MAX_FILES} at a time.`);
    }
  }
}

/**
 * Reads a local file in ranges. The file is opened per read, so nothing stays locked between chunks.
 * `displayName` is the name the receiver sees; it defaults to the file's own name.
 */
export async function fileSourceFor(path: string, displayName?: string): Promise<FileSource> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${basename(path)} is not a regular file`);
  const name = displayName ?? basename(path);
  return {
    name,
    size: info.size,
    mime: mimeFor(name),
    async read(offset: number, length: number): Promise<Uint8Array> {
      const handle = await open(path, "r");
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
      } finally {
        await handle.close();
      }
    },
  };
}

/** Returns a path inside `dir` that does not exist yet: "name.ext", then "name (2).ext", and so on. */
export function uniquePath(dir: string, name: string): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  let candidate = join(dir, name);
  for (let n = 2; existsSync(candidate); n++) {
    candidate = join(dir, `${stem} (${n})${ext}`);
  }
  return candidate;
}

/**
 * Creates the destination file for an incoming transfer. A relative name such as
 * "Trip/day1/a.txt" creates the folders under `dir`. Every segment is checked and
 * sanitized, so nothing can land outside `dir`. Partial files are removed on abort.
 */
export async function fileSinkIn(dir: string, name: string): Promise<FileSink & { path: string }> {
  const segments = safeRelativeSegments(name);
  if (!segments) throw new Error(`Refusing an unsafe file name: ${name}`);
  const parts = segments.map((segment) => sanitizeName(segment));
  const folder = join(dir, ...parts.slice(0, -1));
  await mkdir(folder, { recursive: true });
  const path = uniquePath(folder, parts[parts.length - 1]);
  const handle = await open(path, "wx");
  return {
    path,
    async write(data: Uint8Array): Promise<void> {
      await handle.write(data);
    },
    async finish(): Promise<string> {
      await handle.close();
      return path;
    },
    async abort(): Promise<void> {
      await handle.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
    },
  };
}

/** Strips path separators and reserved Windows characters from a name sent by a peer. */
export function sanitizeName(name: string): string {
  const cleaned = basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "");
  const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
  const safe = cleaned.length === 0 || reserved.test(cleaned) ? `file_${cleaned}` : cleaned;
  return safe.slice(0, 200);
}
