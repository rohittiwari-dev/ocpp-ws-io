import type { IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import type { Duplex } from "node:stream";
import type { EventEmitter } from "node:events";
import type { Validator } from "./validator.js";
import type {
  AllMethodNames,
  OCPPMethodMap,
  OCPPProtocolKey,
  OCPPRequestType,
  OCPPResponseType,
} from "./generated/index.js";

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
export type TypedEventEmitter<TEvents extends Record<string, unknown[]>> = Omit<
  EventEmitter,
  | "on"
  | "once"
  | "off"
  | "emit"
  | "removeListener"
  | "addListener"
  | "removeAllListeners"
> & {
  on<K extends keyof TEvents & string>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): TypedEventEmitter<TEvents>;
  on(
    event: string,
    listener: (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  once<K extends keyof TEvents & string>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): TypedEventEmitter<TEvents>;
  once(
    event: string,
    listener: (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  off<K extends keyof TEvents & string>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): TypedEventEmitter<TEvents>;
  off(
    event: string,
    listener: (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  emit<K extends keyof TEvents & string>(
    event: K,
    ...args: TEvents[K]
  ): boolean;
  emit(event: string, ...args: unknown[]): boolean;
  addListener<K extends keyof TEvents & string>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): TypedEventEmitter<TEvents>;
  addListener(
    event: string,
    listener: (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  removeListener<K extends keyof TEvents & string>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): TypedEventEmitter<TEvents>;
  removeListener(
    event: string,
    listener: (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  removeAllListeners<K extends keyof TEvents & string>(
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
  /** Request endpoint URL path */
  endpoint: string;
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

export type SessionData<T = Record<string, unknown>> = T;

// ─── Logger Interface ────────────────────────────────────────────

/**
 * Minimal logger contract — compatible with `console`, `pino`, `voltlog`,
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
 * Logging configuration for OCPPClient and OCPPServer.
 *
 * @example Default (auto console logging)
 * ```ts
 * const client = new OCPPClient({ identity: 'CP-101', endpoint: '...' });
 * // → Logs to console via voltlog by default
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
   * Uses voltlog's prettyTransport with icons, colors, and timestamps.
   * Without this, logs are structured JSON.
   */
  prettify?: boolean;
  /** Log level for the default voltlog logger (default: 'INFO') */
  level?: string;
  /** Custom logger — replaces the default voltlog entirely */
  handler?: LoggerLike;
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
   * - `undefined` / not set → default voltlog with console (logging enabled)
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
   * Logging configuration — inherited by server clients.
   * - `undefined` / not set → default voltlog with console
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
  accept: (options?: AuthAccept<TSession>) => void,
  reject: (code?: number, message?: string) => void,
  handshake: HandshakeInfo,
  signal: AbortSignal,
) => void | Promise<void>;

// ─── Event Types ─────────────────────────────────────────────────

export interface ClientEvents {
  open: [{ response: IncomingMessage }];
  close: [{ code: number; reason: string }];
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
  [key: string]: unknown[];
}

export interface ServerEvents<TSession = Record<string, unknown>> {
  client: [ServerClientInstance<TSession>];
  error: [Error];
  upgradeError: [{ error: Error; socket: Duplex }];
  [key: string]: unknown[];
}

// Forward reference for ServerClient (resolved at runtime)
export type ServerClientInstance<
  TSession = Record<string, unknown>,
  P extends OCPPProtocol = OCPPProtocol,
> = {
  readonly identity: string;
  readonly protocol: string | undefined;
  readonly session: TSession;
  readonly handshake: HandshakeInfo;
  readonly state: ConnectionState;
  close(options?: CloseOptions): Promise<{ code: number; reason: string }>;
  handle<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    version: V,
    method: M,
    handler: (
      context: HandlerContext<OCPPRequestType<V, M>>,
    ) => OCPPResponseType<V, M> | Promise<OCPPResponseType<V, M>>,
  ): void;
  handle<M extends AllMethodNames<P>>(
    method: M,
    handler: (
      context: HandlerContext<OCPPRequestType<P, M>>,
    ) => OCPPResponseType<P, M> | Promise<OCPPResponseType<P, M>>,
  ): void;
  handle(handler: WildcardHandler): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(
    method: string,
    handler: (context: HandlerContext<Record<string, any>>) => any,
  ): void;
  call<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    version: V,
    method: M,
    params: OCPPRequestType<V, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M>>;
  call<M extends AllMethodNames<P>>(
    method: M,
    params: OCPPRequestType<P, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<P, M>>;
  call<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<TResult>;
  removeHandler(method?: string): void;
  removeHandler(version: OCPPProtocol, method: string): void;
  removeAllHandlers(): void;
  reconfigure(options: Partial<ClientOptions>): void;
  on<K extends keyof ClientEvents>(
    event: K,
    listener: (...args: ClientEvents[K]) => void,
  ): void;
  once<K extends keyof ClientEvents>(
    event: K,
    listener: (...args: ClientEvents[K]) => void,
  ): void;
  off<K extends keyof ClientEvents>(
    event: K,
    listener: (...args: ClientEvents[K]) => void,
  ): void;
};

// ─── Event Adapter Interface ─────────────────────────────────────

export interface EventAdapterInterface {
  publish(channel: string, data: unknown): Promise<void>;
  subscribe(channel: string, handler: (data: unknown) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  disconnect(): Promise<void>;
}

// ─── Symbols ─────────────────────────────────────────────────────

export const NOREPLY: unique symbol = Symbol("NOREPLY");
