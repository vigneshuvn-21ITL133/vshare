import { Directory, File, Paths } from "expo-file-system";
import { safeRelativeSegments, type FileMeta, type FileSink, type FileSource } from "@vshare/protocol";
import type { SendableFile } from "../state/types";

const INCOMING_FOLDER = "V_share";

/** A read-only source backed by a file:// URI. Each read opens the file, reads the range, and closes it. */
export function sourceFor(file: SendableFile): FileSource {
  return {
    name: file.name,
    size: file.size,
    mime: file.mime,
    read(offset: number, length: number): Promise<Uint8Array> {
      const handle = new File(file.uri).open();
      try {
        handle.offset = offset;
        return Promise.resolve(handle.readBytes(length));
      } finally {
        handle.close();
      }
    },
  };
}

/** Folder inside the app's private documents where received files are written. */
export function incomingFolder(): Directory {
  const folder = new Directory(Paths.document, INCOMING_FOLDER);
  folder.create({ idempotent: true, intermediates: true });
  return folder;
}

/**
 * A folder sent from the PC arrives as "Trip/day1/a.txt". Phones have no folder
 * tree for it here, so the parts are joined into one safe file name: "Trip - day1 - a.txt".
 */
export function flatName(name: string): string {
  const segments = safeRelativeSegments(name);
  if (!segments) return sanitizeName(name);
  return sanitizeName(segments.map((segment) => sanitizeName(segment)).join(" - "));
}

/** Creates a new file in the incoming folder, adding " (2)", " (3)" and so on if the name is taken. */
export function createIncomingFile(name: string): File {
  const folder = incomingFolder();
  const safe = flatName(name);
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  let candidate = new File(folder, safe);
  for (let n = 2; candidate.exists; n++) {
    candidate = new File(folder, `${stem} (${n})${ext}`);
  }
  candidate.create({ intermediates: true });
  return candidate;
}

/**
 * Writes an incoming file. When the user chose a save folder, the file goes there;
 * if that folder can no longer be written (for example, after a restart revoked access),
 * the file goes to the app's private folder instead. `abort` deletes whatever was written so far.
 */
export function sinkFor(meta: FileMeta, saveFolderUri: string | null): { sink: FileSink; uri: () => string } {
  let file: File | null = null;
  if (saveFolderUri) {
    try {
      file = new Directory(saveFolderUri).createFile(flatName(meta.name), meta.mime);
    } catch {
      file = null;
    }
  }
  if (!file) file = createIncomingFile(meta.name);

  const target = file;
  const handle = target.open();
  let finished = false;
  return {
    uri: () => target.uri,
    sink: {
      write: async (data: Uint8Array) => {
        handle.writeBytes(data);
      },
      finish: async () => {
        handle.close();
        finished = true;
        return target.uri;
      },
      abort: async () => {
        if (!finished) handle.close();
        if (target.exists) target.delete();
      },
    },
  };
}

/** Removes path separators and characters Android file systems reject. */
export function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim();
  return (cleaned.length > 0 ? cleaned : "file").slice(0, 200);
}
