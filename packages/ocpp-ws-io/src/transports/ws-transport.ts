import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import type {
  TransportConnector,
  TransportServer,
  TransportSocket,
} from "../transport.js";

// ─── WsTransportSocket ────────────────────────────────────────────

/**
 * Default TransportSocket wrapping the `ws` library's WebSocket.
 * Normalizes message data to `Buffer | string` and exposes
 * `upgradeResponse` to replace the `ws._req?.res` internal hack.
 */
export class WsTransportSocket extends EventEmitter implements TransportSocket {
  constructor(public readonly ws: WebSocket) {
    super();

    // ── Event forwarding ──
    ws.on("message", (data: WebSocket.RawData) => {
      // ws returns Buffer | ArrayBuffer | Buffer[] depending on binaryType.
      // Normalize to Buffer | string for the transport interface.
      if (typeof data === "string" || Buffer.isBuffer(data)) {
        this.emit("message", data);
      } else if (Array.isArray(data)) {
        this.emit("message", Buffer.concat(data));
      } else {
        this.emit("message", Buffer.from(data));
      }
    });

    ws.on("close", (code, reason) => this.emit("close", code, reason));
    ws.on("error", (err) => this.emit("error", err));
    ws.on("open", () => this.emit("open"));
    ws.on("ping", () => this.emit("ping"));
    ws.on("pong", () => this.emit("pong"));
    ws.on("unexpected-response", (req, res) =>
      this.emit("unexpected-response", req, res),
    );
  }

  get readyState() {
    return this.ws.readyState as 0 | 1 | 2 | 3;
  }

  get bufferedAmount() {
    return this.ws.bufferedAmount;
  }

  get protocol() {
    return this.ws.protocol;
  }

  get upgradeResponse(): IncomingMessage | undefined {
    return (this.ws as any)._req?.res;
  }

  send(data: string | Buffer, cb?: (err?: Error) => void): void {
    this.ws.send(data, cb);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  terminate(): void {
    this.ws.terminate();
  }

  ping(data?: Buffer): void {
    this.ws.ping(data);
  }
}

// ─── WsTransportServer ────────────────────────────────────────────

/**
 * Default TransportServer wrapping `ws.WebSocketServer`.
 * Tracks connected sockets as `TransportSocket` instances.
 */
export class WsTransportServer implements TransportServer {
  /** Exposed for backward-compatible test access (e.g. phase-i.test.ts) */
  readonly _wss: WebSocketServer;

  private _clientMap = new Map<WebSocket, WsTransportSocket>();
  private _transportClients = new Set<TransportSocket>();

  constructor(options: import("ws").ServerOptions) {
    this._wss = new WebSocketServer(options);
  }

  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (socket: TransportSocket) => void,
  ): void {
    this._wss.handleUpgrade(req, socket, head, (ws) => {
      const transportSocket = new WsTransportSocket(ws);
      this._clientMap.set(ws, transportSocket);
      this._transportClients.add(transportSocket);

      // Cleanup when socket closes
      ws.on("close", () => {
        this._clientMap.delete(ws);
        this._transportClients.delete(transportSocket);
      });

      callback(transportSocket);
    });
  }

  get clients(): Set<TransportSocket> {
    return this._transportClients;
  }

  close(cb?: () => void): void {
    this._wss.close(cb);
    this._clientMap.clear();
    this._transportClients.clear();
  }
}

// ─── WsTransportConnector ─────────────────────────────────────────

/**
 * Default TransportConnector wrapping `new ws.WebSocket()`.
 */
export class WsTransportConnector implements TransportConnector {
  connect(
    url: string,
    protocols: string[],
    options: Record<string, unknown>,
  ): TransportSocket {
    const ws = new WebSocket(url, protocols, options);
    return new WsTransportSocket(ws);
  }
}
