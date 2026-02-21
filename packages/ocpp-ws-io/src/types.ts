import type { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import type { LogEntry } from "voltlog-io";
import type {
  AllMethodNames,
  OCPPMethodMap,
  OCPPProtocolKey,
  OCPPRequestType,
  OCPPResponseType,
} from "./generated/index.js";
import type { Validator } from "./validator.js";

export type {
  AllMethodNames,
  OCPPMethodMap,
  OCPPProtocolKey,
  OCPPRequestType,
  OCPPResponseType,
};

// ─── Typed EventEmitter ──────────────────────────────────────────

/**
 * Utility type that overlays typed `.on()`, `.off()`, `.emit()` etc.
 * on top of Node.js EventEmitter. This is the foundation for type-safe
 * event handling throughout the library.
 */
export type TypedEventEmitter<
  TEvents extends Record<keyof TEvents, unknown[]>,
> = Omit<
  EventEmitter,
  | "on"
  | "once"
  | "off"
  | "emit"
  | "removeListener"
  | "addListener"
  | "removeAllListeners"
> & {
  on<K extends keyof TEvents | (string & {})>(
    event: K,
    listener: K extends keyof TEvents
      ? (...args: TEvents[K]) => void
      : (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  once<K extends keyof TEvents | (string & {})>(
    event: K,
    listener: K extends keyof TEvents
      ? (...args: TEvents[K]) => void
      : (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  off<K extends keyof TEvents | (string & {})>(
    event: K,
    listener: K extends keyof TEvents
      ? (...args: TEvents[K]) => void
      : (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  emit<K extends keyof TEvents | (string & {})>(
    event: K,
    ...args: K extends keyof TEvents ? TEvents[K] : unknown[]
  ): boolean;
  addListener<K extends keyof TEvents | (string & {})>(
    event: K,
    listener: K extends keyof TEvents
      ? (...args: TEvents[K]) => void
      : (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  removeListener<K extends keyof TEvents | (string & {})>(
    event: K,
    listener: K extends keyof TEvents
      ? (...args: TEvents[K]) => void
      : (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  removeAllListeners<K extends keyof TEvents | (string & {})>(
    event?: K,
  ): TypedEventEmitter<TEvents>;
};

// ─── OCPP Protocol ───────────────────────────────────────────────

export type OCPPProtocol = OCPPProtocolKey;
export type AnyOCPPProtocol = OCPPProtocol | (string & {});

// ─── Connection State ────────────────────────────────────────────

export const ConnectionState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type ConnectionState =
  (typeof ConnectionState)[keyof typeof ConnectionState];

// ─── Security Profiles (OCPP Spec) ──────────────────────────────

export enum SecurityProfile {
  /** No security — plain WS, no auth (dev/testing only) */
  NONE = 0,
  /** Profile 1: Basic Auth over unsecured WS (ws://) — password-based */
  BASIC_AUTH = 1,
  /** Profile 2: TLS + Basic Auth (wss://) — server cert + password */
  TLS_BASIC_AUTH = 2,
  /** Profile 3: Mutual TLS (wss://) — client + server certificates */
  TLS_CLIENT_CERT = 3,
}

// ─── Message Types ───────────────────────────────────────────────

export const MessageType = {
  CALL: 2,
  CALLRESULT: 3,
  CALLERROR: 4,
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// ─── OCPP Message Tuples ─────────────────────────────────────────

export type OCPPCall<T = unknown> = [2, string, string, T];
export type OCPPCallResult<T = unknown> = [3, string, T];
export type OCPPCallError = [
  4,
  string,
  string,
  string,
  Record<string, unknown>,
];
export type OCPPMessage<T = unknown> =
  | OCPPCall<T>
  | OCPPCallResult<T>
  | OCPPCallError;

// ─── TLS Options ─────────────────────────────────────────────────

export interface TLSOptions {
  /** Server/client certificate (PEM) */
  cert?: string | Buffer;
  /** Private key (PEM) */
  key?: string | Buffer;
  /** CA certificate(s) for verification */
  ca?: string | Buffer | Array<string | Buffer>;
  /** Reject unauthorized certs (default: true) */
  rejectUnauthorized?: boolean;
  /** Passphrase for encrypted private key */
  passphrase?: string;
}

// ─── Handler Types ───────────────────────────────────────────────

export interface HandlerContext<T = unknown> {
  /** Unique message ID */
  messageId: string;
  /** OCPP method name (e.g. "BootNotification") */
  method: string;
  /** Active OCPP protocol version (e.g. "ocpp1.6") */
  protocol: string | undefined;
  /** Request parameters */
  params: T;
  /** Abort signal */
  signal: AbortSignal;
}

export type CallHandler<TParams = unknown, TResult = unknown> = (
  context: HandlerContext<TParams>,
) => TResult | Promise<TResult>;

export type WildcardHandler = (
  method: string,
  context: HandlerContext,
) => unknown | Promise<unknown>;

// ─── Call Options ────────────────────────────────────────────────

export interface CallOptions {
  /** Timeout in milliseconds for this specific call */
  timeoutMs?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Suppress sending a response (server-side, NOREPLY) */
  noReply?: boolean;
}

// ─── Close Options ───────────────────────────────────────────────

export interface CloseOptions {
  /** WebSocket close code (default: 1000) */
  code?: number;
  /** Close reason string */
  reason?: string;
  /** Wait for pending calls to complete before closing */
  awaitPending?: boolean;
  /** Force-close without waiting */
  force?: boolean;
}

// ─── Handshake Info ──────────────────────────────────────────────

export interface HandshakeInfo {
  /** Charging station identity (from URL path) */
  identity: string;
  /** Remote IP address */
  remoteAddress: string;
  /** Request headers */
  headers: Record<string, string | string[] | undefined>;
  /** Negotiated subprotocols */
  protocols: Set<string>;
  /** Full URL pathname including params */
  pathname: string;
  /** Extracted dynamic route parameters */
  params: Record<string, string>;
  /** URL query parameters */
  query: URLSearchParams;
  /** Original HTTP request */
  request: IncomingMessage;
  /** Password from Basic Auth (Profile 1 & 2) */
  password?: Buffer;
  /** Client certificate (Profile 3 — mTLS) */
  clientCertificate?: ReturnType<TLSSocket["getPeerCertificate"]>;
  /** Active security profile */
  securityProfile: SecurityProfile;
}

// ─── Session Data ────────────────────────────────────────────────

export type SessionData<T = Record<string, any>> = T;

// ─── Logger Interface ────────────────────────────────────────────

/**
 * Minimal logger contract — compatible with `console`, `pino`, `voltlog-io`,
 * or any custom object with these methods.
 *
 * All methods are optional so `console` works as-is.
 */
export interface LoggerLike {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
  child?(context: Record<string, unknown>): LoggerLike;
}

/**
 * Minimal logger contract — compatible with `console`, `pino`, `voltlog-io`,
 * or any custom object with these methods.
 *
 * All methods are optional so `console` works as-is.
 * this is only not optional for the logger used by the library
 */
export interface LoggerLikeNotOptional {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): LoggerLike;
}

/**
 * Logging configuration for OCPPClient and OCPPServer.
 *
 * @example Default (auto console logging)
 * ```ts
 * const client = new OCPPClient({ identity: 'CP-101', endpoint: '...' });
 * // → Logs to console via voltlog-io by default
 * ```
 *
 * @example Disable logging
 * ```ts
 * new OCPPClient({ identity: 'CP-101', endpoint: '...', logging: false });
 * ```
 *
 * @example Custom logger
 * ```ts
 * new OCPPClient({ identity: 'CP-101', endpoint: '...', logging: { handler: pino() } });
 * ```
 */
export interface LoggingConfig {
  /** Enable/disable logging (default: true) */
  enabled?: boolean;
  /**
   * Enable OCPP exchange logging (default: false).
   * Adds `direction: 'IN' | 'OUT'` to OCPP message logs.
   * When combined with `prettify`, renders styled exchange lines:
   * `⚡ CP-101  →  BootNotification  [IN]`
   */
  exchangeLog?: boolean;
  /**
   * Enable pretty-printed colored output (default: false).
   * Uses voltlog-io's prettyTransport with icons, colors, and timestamps.
   * Without this, logs are structured JSON.
   */
  prettify?: boolean;
  /** Log level for the default voltlog-io logger (default: 'INFO') */
  level?: string;
  /** Custom logger — replaces the default voltlog-io entirely */
  logger?: LoggerLike;
  /** Custom VoltLog transport function — receives formatted logs */
  handler?: (entry: LogEntry) => void | Promise<void>;

  // ─── Display Options (only apply to default voltlog-io logger) ──

  /**
   * Show trailing metadata object in log output (default: true).
   * `INFO Server listening {"port":5000,"host":"0.0.0.0"}`
   *                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ← hidden when false
   */
  showMetadata?: boolean;
  /**
   * Show source context object in log output (default: true).
   * `INFO Server listening {"component":"OCPPServer"} {"port":5000}`
   *                         ^^^^^^^^^^^^^^^^^^^^^^^^ ← hidden when false
   */
  showSourceMeta?: boolean;
  /**
   * Prettify source context into a compact tag (default: false).
   * `{"component":"OCPPServer","identity":"CP-1"}` → `[OCPPServer/CP-1]`
   */
  prettifySource?: boolean;
  /**
   * Prettify trailing metadata into readable key=value pairs (default: false).
   * `{"port":5000,"host":"0.0.0.0"}` → `port=5000 host=0.0.0.0`
   */
  prettifyMetadata?: boolean;
}

// ─── Client Options ──────────────────────────────────────────────

export interface ClientOptions {
  /** Unique identity for this client (charging station ID) */
  identity: string;
  /** WebSocket endpoint URL (ws:// or wss://) */
  endpoint: string;
  /** OCPP Security Profile (default: NONE) */
  securityProfile?: SecurityProfile;
  /** Password for Basic Auth (Profile 1 & 2) */
  password?: string | Buffer;
  /** TLS options (Profile 2 & 3) */
  tls?: TLSOptions;
  /** OCPP subprotocols to negotiate */
  protocols?: AnyOCPPProtocol[];
  /** Additional WebSocket headers */
  headers?: Record<string, string>;
  /** Additional query parameters */
  query?: Record<string, string>;
  /** Enable automatic reconnection (default: true) */
  reconnect?: boolean;
  /** Maximum reconnection attempts (default: Infinity) */
  maxReconnects?: number;
  /** Back-off base delay in ms (default: 1000) */
  backoffMin?: number;
  /** Back-off max delay in ms (default: 30000) */
  backoffMax?: number;
  /** Call timeout in ms (default: 30000) */
  callTimeoutMs?: number;
  /** Ping interval in ms (default: 30000, 0 to disable) */
  pingIntervalMs?: number;
  /** Defer pings if activity detected (default: false) */
  deferPingsOnActivity?: boolean;
  /**
   * Pong response timeout in ms. If no pong is received within this
   * window after a ping, the connection is considered dead and terminated.
   * (default: pingIntervalMs + 5000, 0 to disable)
   */
  pongTimeoutMs?: number;
  /** Maximum concurrent outbound calls (default: 1) */
  callConcurrency?: number;
  /** Enable strict mode validation (default: false) */
  strictMode?: boolean | string[];
  /** Custom validators for strict mode */
  strictModeValidators?: Validator[];
  /** Max number of bad messages before closing (default: Infinity) */
  maxBadMessages?: number;
  /** Include error details in responses (default: false) */
  respondWithDetailedErrors?: boolean;
  /**
   * Logging configuration.
   * - `undefined` / not set → default voltlog-io with console (logging enabled)
   * - `false` → logging disabled entirely
   * - `LoggingConfig` → custom configuration
   */
  logging?: LoggingConfig | false;
}

// ─── Server Options ──────────────────────────────────────────────

export interface ServerOptions {
  /** OCPP Security Profile (default: NONE) */
  securityProfile?: SecurityProfile;
  /** TLS options for HTTPS server (Profile 2 & 3) */
  tls?: TLSOptions;
  /** Accepted OCPP subprotocols */
  protocols?: AnyOCPPProtocol[];
  /** Call timeout in ms — inherited by server clients (default: 30000) */
  callTimeoutMs?: number;
  /** Ping interval in ms — inherited by server clients (default: 30000) */
  pingIntervalMs?: number;
  /** Defer pings if activity detected — inherited (default: false) */
  deferPingsOnActivity?: boolean;
  /** Max concurrent outbound calls — inherited (default: 1) */
  callConcurrency?: number;
  /** Enable strict mode — inherited (default: false) */
  strictMode?: boolean | string[];
  /** Custom validators — inherited */
  strictModeValidators?: Validator[];
  /** Max bad messages — inherited (default: Infinity) */
  maxBadMessages?: number;
  /** Include error details in responses — inherited (default: false) */
  respondWithDetailedErrors?: boolean;
  /**
   * Maximum time (ms) to wait for the auth callback to resolve during
   * a WebSocket upgrade handshake. If the callback does not settle within
   * this window, the socket is destroyed and an `upgradeAborted` event
   * is emitted. Set to `0` to disable. (default: 30000)
   */
  handshakeTimeoutMs?: number;
  /**
   * Logging configuration — inherited by server clients.
   * - `undefined` / not set → default voltlog-io with console
   * - `false` → logging disabled
   * - `LoggingConfig` → custom configuration
   */
  logging?: LoggingConfig | false;
}

// ─── Listen Options ──────────────────────────────────────────────

export interface ListenOptions {
  /** Existing HTTP/HTTPS server to attach to */
  server?: import("node:http").Server | import("node:https").Server;
  /** Hostname to bind to */
  host?: string;
  /** Signal to abort the listen */
  signal?: AbortSignal;
}

// ─── Auth Callback ───────────────────────────────────────────────

export interface AuthAccept<TSession = Record<string, unknown>> {
  /** Subprotocol to use for this client */
  protocol?: string;
  /** Session data attached to the client */
  session?: TSession;
}

export type AuthCallback<TSession = Record<string, unknown>> = (
  ctx: AuthContext<TSession>,
) => void | Promise<void>;

export type RoutePattern = string | RegExp;

export interface AuthRoute {
  pattern: RoutePattern | null; // null represents the default fallback route
  handler: AuthCallback<any>;
}

// ─── Event Types ─────────────────────────────────────────────────

export interface ClientEvents {
  open: [{ response: IncomingMessage }];
  close: [{ code: number; reason: string }];
  disconnect: [{ code: number; reason: string }];
  error: [Error];
  connecting: [{ url: string }];
  reconnect: [{ attempt: number; delay: number }];
  message: [OCPPMessage];
  call: [OCPPCall];
  callResult: [OCPPCallResult];
  callError: [OCPPCallError];
  badMessage: [{ message: string; error: Error }];
  ping: [];
  pong: [];
  strictValidationFailure: [{ message: unknown; error: Error }];
}

import type { OCPPServerClient } from "./server-client.js";

export interface ServerEvents {
  client: [OCPPServerClient];
  error: [Error];
  upgradeError: [{ error: Error; socket: Duplex }];
  upgradeAborted: [
    {
      identity: string;
      reason: string;
      socket: Duplex;
      request: IncomingMessage;
    },
  ];
  closing: [];
  close: [];
  // Native WebSocketServer events
  connection: [
    socket: import("ws").WebSocket,
    request: import("node:http").IncomingMessage,
  ];
  listening: [];
  headers: [headers: string[], request: import("node:http").IncomingMessage];
}

// ─── Event Adapter Interface ─────────────────────────────────────

export interface EventAdapterInterface {
  publish(channel: string, data: unknown): Promise<void>;
  subscribe(channel: string, handler: (data: unknown) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  disconnect(): Promise<void>;

  // Presence Registry (Optional)
  setPresence?(identity: string, nodeId: string, ttl: number): Promise<void>;
  getPresence?(identity: string): Promise<string | null>;
  removePresence?(identity: string): Promise<void>;
}

// ─── Symbols ─────────────────────────────────────────────────────

export const NOREPLY: unique symbol = Symbol("NOREPLY");
// ─── Middleware ──────────────────────────────────────────────────

export type MiddlewareContext =
  | {
      type: "incoming_call";
      messageId: string;
      method: string;
      params: unknown;
      protocol?: string;
    }
  | {
      type: "outgoing_call";
      messageId: string;
      method: string;
      params: unknown;
      options: CallOptions;
    }
  | {
      type: "incoming_result";
      messageId: string;
      payload: unknown;
      method: string; // Correlated method name
    }
  | {
      type: "incoming_error";
      messageId: string;
      error: OCPPCallError;
      method: string; // Correlated method name
    };

export type { MiddlewareFunction, MiddlewareNext } from "./middleware.js";

// ─── Router Component Types ──────────────────────────────────────────

export interface BaseConnectionContext {
  /** The handshake info from the upgrading WebSocket request */
  handshake: HandshakeInfo;
  /** Modifiable record object suitable for passing data between middlewares (e.g. auth tokens) */
  state: Record<string, unknown>;
  /** Safely reject the WebSocket connection explicitly with an HTTP code and reason */
  reject: (code?: number, message?: string) => never;
}

export interface ConnectionContext extends BaseConnectionContext {
  /** Triggers the next middleware in the execution chain, optionally merging a payload into ctx.state */
  next: (payload?: Record<string, unknown>) => Promise<void>;
}

export interface AuthContext<TSession = Record<string, unknown>>
  extends BaseConnectionContext {
  /** The AbortSignal representing if the client abruptly closed the underlying socket */
  signal: AbortSignal;
  /** Grants the connection and optionally sets the negotiated protocol or session metadata */
  accept: (options?: AuthAccept<TSession>) => void;
}

export type ConnectionMiddleware = (
  ctx: ConnectionContext,
) => Promise<void> | void;
