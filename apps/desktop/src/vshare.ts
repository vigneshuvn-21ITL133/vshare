import type { VShareApi } from "../electron/shared";

declare global {
  interface Window {
    vshare: VShareApi;
  }
}

export const api: VShareApi = window.vshare;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatWhen(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  return `${date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}, ${time}`;
}

export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

export const STATE_LABEL: Record<string, string> = {
  preparing: "Preparing",
  connecting: "Connecting",
  verifying: "Verify code",
  waiting: "Waiting for approval",
  sending: "Sending",
  receiving: "Receiving",
  paused: "Paused",
  done: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
  error: "Failed",
};
