import { spawn } from "node:child_process";
import { join } from "node:path";
import { app } from "electron";
import type { BridgeTransport } from "./bluetooth.js";

const EXE_NAME = "VShare.BluetoothBridge.exe";

/**
 * Starts the Windows Bluetooth bridge.
 * - VSHARE_BT_BRIDGE, when set: that exe.
 * - Packaged app: the published exe in the app's resources folder.
 * - Development: `dotnet run` on the bridge project.
 */
export function startBridgeProcess(): BridgeTransport {
  let command: string;
  let args: string[];
  const override = process.env.VSHARE_BT_BRIDGE;
  if (override) {
    command = override;
    args = [];
  } else if (app.isPackaged) {
    command = join(process.resourcesPath, "bluetooth-bridge", EXE_NAME);
    args = [];
  } else {
    command = "dotnet";
    args = ["run", "--project", join(app.getAppPath(), "bluetooth-bridge")];
  }

  const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const lineHandlers: Array<(line: string) => void> = [];
  const exitHandlers: Array<(reason: string) => void> = [];
  let buffer = "";
  let stderrTail = "";
  let stopping = false;
  let exited = false;

  // Errors when writing to a process that has already exited must not crash the app.
  child.stdin.on("error", () => undefined);

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) lineHandlers.forEach((handler) => handler(line));
      index = buffer.indexOf("\n");
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2000);
    console.error("[bluetooth bridge]", chunk.trim());
  });

  const finish = (reason: string) => {
    if (exited) return;
    exited = true;
    exitHandlers.forEach((handler) => handler(reason));
  };

  child.on("error", (error) => {
    finish(`Could not start the Bluetooth bridge (${error.message}). It needs the .NET 8 runtime on Windows.`);
  });
  child.on("exit", (code) => {
    if (stopping) return;
    const lastLine = stderrTail.trim().split("\n").pop() ?? "";
    finish(`The Bluetooth bridge stopped (exit code ${code}). ${lastLine}`.trim());
  });

  return {
    send(line: string): void {
      child.stdin.write(`${line}\n`);
    },
    onLine(handler) {
      lineHandlers.push(handler);
    },
    onExit(handler) {
      exitHandlers.push(handler);
    },
    stop(): void {
      stopping = true;
      child.kill();
    },
  };
}
