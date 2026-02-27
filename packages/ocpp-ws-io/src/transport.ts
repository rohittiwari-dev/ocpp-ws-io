import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

// ─── Transport State Constants ────────────────────────────────────

export const TransportState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type TransportStateValue =
  (typeof TransportState)[keyof typeof TransportState];

// ─── TransportSocket ──────────────────────────────────────────────

/**
 * Transport-agnostic socket connection.
 * Wraps any bidirectional message stream (ws, µWS, HTTP/2).
 */
export interface TransportSocket {
  /** Connection state: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED */
  readonly readyState: TransportStateValue;
  /** Bytes queued for sending but not yet flushed to the network */
  readonly bufferedAmount: number;
  /** Negotiated subprotocol (e.g. "ocpp1.6") */
  readonly protocol: string;
  /**
   * The HTTP upgrade response (available after connection opens).
   * Used internally for extracting IP and TLS data on the client side.
   */
  readonly upgradeResponse?: IncomingMessage;

  /** Send a string or binary message */
  send(data: string | Buffer, cb?: (err?: Error) => void): void;
  /** Initiate graceful close with code + reason */
  close(code?: number, reason?: string): void;
  /** Force-kill the connection immediately (RST) */
  terminate(): void;
  /** Send a PING frame. No-op if transport doesn't support it. */
  ping(data?: Buffer): void;

  // ── Typed event listeners ──

  on(event: "message", handler: (data: Buffer | string) => void): this;
  on(event: "close", handler: (code: number, reason: Buffer) => void): this;
  on(event: "error", handler: (err: Error) => void): this;
  on(event: "open", handler: () => void): this;
  on(event: "ping", handler: () => void): this;
  on(event: "pong", handler: () => void): this;
  on(event: "unexpected-response", handler: (...args: any[]) => void): this;

  removeListener(event: string, handler: (...args: any[]) => void): this;
  removeAllListeners(event?: string): this;
}

// ─── TransportServer ──────────────────────────────────────────────

/**
 * Server-side transport that accepts incoming connections.
 */
export interface TransportServer {
  /** Upgrade an HTTP request to a transport connection */
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (socket: TransportSocket) => void,
  ): void;

  /** Set of currently connected sockets (for stats/drain) */
  readonly clients: Set<TransportSocket>;

  /** Close the transport server */
  close(cb?: () => void): void;
}

// ─── TransportConnector ───────────────────────────────────────────

/**
 * Client-side transport factory. Creates outbound connections.
 */
export interface TransportConnector {
  /**
   * Initiate a connection to a remote server.
   * Returns a TransportSocket that will emit 'open' when connected.
   */
  connect(
    url: string,
    protocols: string[],
    options: Record<string, unknown>,
  ): TransportSocket;
}
