import { Buffer } from "buffer";
import TcpSocket from "react-native-tcp-socket";
import type { ByteSocket } from "@vshare/protocol";

/** Adapts react-native-tcp-socket to the byte-stream interface the protocol expects. */
export function wrapSocket(socket: TcpSocket.Socket): ByteSocket {
  socket.setNoDelay(true);
  return {
    write: (data) => {
      socket.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    },
    close: () => {
      socket.end();
    },
    onData: (handler) => {
      socket.on("data", (chunk: string | Buffer) => {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        handler(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      });
    },
    onClose: (handler) => {
      let reported = false;
      const report = (error?: Error) => {
        if (reported) return;
        reported = true;
        handler(error);
      };
      socket.on("error", (error: Error) => report(error));
      socket.on("close", () => report());
    },
  };
}

/** Opens an outgoing connection to a receiver. Rejects after `timeoutMs`. */
export function connectTo(host: string, port: number, timeoutMs = 8000): Promise<ByteSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = TcpSocket.createConnection({ host, port }, () => {
      settled = true;
      clearTimeout(timer);
      resolve(wrapSocket(socket));
    });
    const timer = setTimeout(() => {
      if (settled) return;
      socket.destroy();
      reject(new Error(`no answer from ${host}:${port} after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    socket.on("error", (error: Error) => {
      if (settled) return;
      clearTimeout(timer);
      reject(error);
    });
  });
}

export interface Listener {
  close(): Promise<void>;
}

/** Listens for senders on every interface. Each connection is handed over as a ByteSocket. */
export function listenFor(
  port: number,
  onConnection: (socket: ByteSocket, remoteAddress: string | undefined) => void,
): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const server = TcpSocket.createServer((socket) => {
      onConnection(wrapSocket(socket), socket.remoteAddress);
    });
    server.once("error", reject);
    server.listen({ port, host: "0.0.0.0" }, () => {
      server.off("error", reject);
      resolve({
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
