/**
 * Node.js adapters for the protocol. Desktop (Electron main process) and the test
 * suite import from "@vshare/protocol/node". The mobile app never imports this file.
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import type { ByteSocket } from "./connection.js";

export function wrapNodeSocket(socket: Socket): ByteSocket {
  socket.setNoDelay(true);
  return {
    write: (data) => {
      socket.write(data);
    },
    close: () => {
      socket.end();
    },
    onData: (handler) => {
      socket.on("data", (chunk: Buffer) => handler(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
    },
    onClose: (handler) => {
      let reported = false;
      const report = (error?: Error) => {
        if (reported) return;
        reported = true;
        handler(error);
      };
      socket.on("error", (error) => report(error));
      socket.on("close", () => report());
    },
  };
}

/** Opens an outgoing TCP connection to a receiver. */
export function connectToReceiver(host: string, port: number, timeoutMs = 8000): Promise<ByteSocket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`could not reach ${host}:${port} within ${timeoutMs} ms`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(wrapNodeSocket(socket));
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Starts a TCP listener. Each accepted connection is handed over as a ByteSocket. */
export function listenForSenders(
  port: number,
  onConnection: (socket: ByteSocket, remoteAddress: string | undefined) => void,
  host = "0.0.0.0",
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      onConnection(wrapNodeSocket(socket), socket.remoteAddress);
    });
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
