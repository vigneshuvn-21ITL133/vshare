/**
 * Turns a peer-supplied relative path into safe path segments, or returns null.
 * Rejects absolute paths, drive letters, "..", empty and control-character segments.
 * Accepts "/" and "\" as separators because senders on Windows use "\".
 */
export function safeRelativeSegments(name: string): string[] | null {
  if (name.length === 0 || name.length > 512) return null;
  if (/^[A-Za-z]:/.test(name) || name.startsWith("/") || name.startsWith("\\")) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  const parts = name.split(/[\\/]+/).filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  if (parts.some((part) => part === "." || part === "..")) return null;
  return parts;
}
