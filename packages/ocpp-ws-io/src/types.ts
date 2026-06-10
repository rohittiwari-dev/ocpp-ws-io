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

export interface RouterHandlerContext<T = unknown> extends HandlerContext<T> {
  /** The specific server client that issued the message. */
  client: import("./server-client.js").OCPPServerClient;
}

export type RouterWildcardHandler = (
  method: string,
  context: RouterHandlerContext,
) => unknown | Promise<unknown>;

// ─── Call Options ────────────────────────────────────────────────

export interface CallOptions {
  /** Timeout in milliseconds for this specific call */
  timeoutMs?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /**
   * Max retry attempts on TimeoutError (default: 0 = no retry).
   * Uses Full Jitter exponential backoff between retries.
   */
  retries?: number;
  /** Base delay in ms for exponential backoff between retries (default: 1000) */
  retryDelayMs?: number;
  /** Max delay cap in ms to prevent unbounded backoff (default: 30000) */
  retryMaxDelayMs?: number;
  /**
   * Idempotency key for deduplication. If provided, this value is used
   * as the OCPP messageId instead of generating a new random one.
   * Consumers can use the same key to guarantee exactly-once semantics
   * when retrying calls across reconnections.
   */
  idempotencyKey?: string;
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
  strictMode?: boolean | OCPPProtocol[];
  /** If defined, restricts strict mode validation ONLY to these methods */
  strictModeMethods?: Array<AllMethodNames<OCPPProtocol>>;
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
  /** Rate Limiting configuration (Token Bucket) */
  rateLimit?: RateLimitOptions;
  /**
   * If true, calls made while disconnected are queued in-memory
   * and flushed automatically on reconnect. (default: false)
   */
  offlineQueue?: boolean;
  /**
   * Maximum number of messages to queue while offline.
   * Oldest messages are dropped when exceeded. (default: 100)
   */
  offlineQueueMaxSize?: number;
  /**
   * Enable WebSocket `permessage-deflate` compression.
   * Reduces bandwidth by ~80% for JSON payloads at the cost of ~0.2ms CPU per message.
   * - `true` → sensible defaults (threshold: 1024, level: 6)
   * - `object` → fine-tuned configuration
   * (default: false)
   */
  compression?: boolean | CompressionOptions;
}

// ─── Compression Options ─────────────────────────────────────────

export interface CompressionOptions {
  /** Minimum payload size in bytes to compress (default: 1024) */
  threshold?: number;
  /** zlib compression level 1 (fastest) to 9 (smallest) (default: 6) */
  level?: number;
  /** zlib memory level 1–9 (default: 8) */
  memLevel?: number;
  /** Server does not retain deflate context between messages (default: true — saves ~120KB/conn) */
  serverNoContextTakeover?: boolean;
  /** Client does not retain deflate context between messages (default: true) */
  clientNoContextTakeover?: boolean;
}

// ─── Rate Limit Options ──────────────────────────────────────────

export interface RateLimitOptions {
  /** Maximum number of messages allowed within the window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
  /**
   * Action to take when rate limit is exceeded.
   * - 'disconnect': Terminate the socket immediately (hard enforce).
   * - 'ignore': Drop the message entirely, letting the client back-off and retry.
   * - Custom callback: Perform custom logging or logic when exceeded.
   * (default: 'ignore')
   */
  onLimitExceeded?:
    | "disconnect"
    | "ignore"
    | ((
        client: import("./server-client.js").OCPPServerClient,
        rawData: unknown,
      ) => void | Promise<void>);
  /**
   * Specific limits applied purely to individual methods (e.g. Heartbeat, BootNotification).
   * Note: The method must be parsed from the raw JSON payload to apply this.
   */
  methods?: Record<string, { limit: number; windowMs: number }>;

  // ─── Adaptive Rate Limiting ──────────────────────────────────────

  /**
   * Enable adaptive rate limiting based on CPU/memory pressure.
   * When enabled, the token refill rate is automatically reduced under
   * high load and restored after a cooldown period. (default: false)
   */
  adaptive?: boolean;
  /**
   * CPU usage percent threshold to begin throttling.
   * Applies only when `adaptive` is true. (default: 80)
   */
  cpuThresholdPercent?: number;
  /**
   * Heap usage percent threshold to begin throttling.
   * Applies only when `adaptive` is true. (default: 85)
   */
  memThresholdPercent?: number;
  /**
   * Time (ms) both CPU and memory must stay below their thresholds
   * before restoring the original rate. (default: 5000)
   */
  cooldownMs?: number;
}

// ─── Router Options ──────────────────────────────────────────────

export interface RouterConfig {
  /** Accepted OCPP subprotocols (e.g. ["ocpp1.6"]) */
  protocols?: AnyOCPPProtocol[];
  /** Call timeout in ms — overrides server default */
  callTimeoutMs?: number;
  /** Ping interval in ms — overrides server default */
  pingIntervalMs?: number;
  /** Defer pings if activity detected — overrides server default */
  deferPingsOnActivity?: boolean;
  /** Max concurrent outbound calls — overrides server default */
  callConcurrency?: number;
  /** Enable strict mode validation — overrides server default */
  strictMode?: boolean | OCPPProtocol[];
  /** If defined, restricts strict mode validation ONLY to these methods */
  strictModeMethods?: Array<AllMethodNames<OCPPProtocol>>;
  /** Rate Limiting configuration — overrides server default */
  rateLimit?: RateLimitOptions;
}

export interface CORSOptions {
  /**
   * Allowed exact IPv4/IPv6 addresses or CIDR ranges
   * (e.g. "10.0.0.0/8", "2001:db8::/32").
   */
  allowedIPs?: string[];
  /**
   * Allowed `Origin` header values (e.g. "https://dashboard.example.com").
   *
   * **Note:** this is a *browser-side* defense only. Requests with **no**
   * `Origin` header pass through (physical charging stations don't send one),
   * so a non-browser client can bypass this by simply omitting the header.
   * Do not rely on `allowedOrigins` for authentication — use `auth()` / Basic
   * Auth / mTLS for that.
   */
  allowedOrigins?: string[];
  /** Allowed WebSocket protocol schemes */
  allowedSchemes?: ("ws" | "wss")[];
  /**
   * Honor `X-Forwarded-Proto` from a reverse proxy when evaluating
   * `allowedSchemes`. Leave false (default) unless the server is only
   * reachable through a trusted proxy — otherwise clients can spoof the
   * header to bypass wss-only rules.
   */
  trustProxy?: boolean;
}

// ─── Server Options ──────────────────────────────────────────────

interface ServerOptionsBase {
  /** OCPP Security Profile (default: NONE) */
  securityProfile?: SecurityProfile;
  /** TLS options for HTTPS server (Profile 2 & 3) */
  tls?: TLSOptions;
  /** Call timeout in ms — inherited by server clients (default: 30000) */
  callTimeoutMs?: number;
  /** Ping interval in ms — inherited by server clients (default: 30000) */
  pingIntervalMs?: number;
  /** Defer pings if activity detected — inherited (default: false) */
  deferPingsOnActivity?: boolean;
  /** Max concurrent outbound calls — inherited (default: 1) */
  callConcurrency?: number;
  /** If defined, restricts strict mode validation ONLY to these methods */
  strictModeMethods?: Array<AllMethodNames<OCPPProtocol>>;
  /** Custom validators — inherited */
  strictModeValidators?: Validator[];
  /** Rate Limiting configuration — inherited */
  rateLimit?: RateLimitOptions;
  /** Max bad messages — inherited (default: Infinity) */
  maxBadMessages?: number;
  /** Include error details in responses — inherited (default: false) */
  respondWithDetailedErrors?: boolean;
  /**
   * Session inactivity timeout in milliseconds before garbage collection.
   * (default: 7200000 / 2 hours)
   */
  sessionTtlMs?: number;
  /**
   * TTL (seconds) for cluster presence registry entries, and the basis for
   * the automatic presence heartbeat (refreshed every ttl/2 while clients
   * are connected). Default: 300.
   */
  presenceTtlSeconds?: number;
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
  /**
   * Connection-level rate limiting (per-IP) applied at the HTTP upgrade boundary,
   * before any auth, TLS or JSON parsing occurs — blocks DDoS connection floods in ~1µs.
   * - `limit`: Max upgrade requests per IP within `windowMs` (default: 20)
   * - `windowMs`: Sliding window in ms (default: 10000)
   */
  connectionRateLimit?: {
    limit: number;
    windowMs: number;
  };
  /**
   * Maximum number of inactive sessions to retain in the bounded LRU cache.
   * Prevents OOM under DDoS or reconnection storms with transient identities.
   * (default: 50000)
   */
  maxSessions?: number;
  /**
   * Hard cap on concurrent client connections, enforced before the TLS/auth
   * handshake work is done (the connection-guard plugin only closes after
   * the fact). Excess upgrades are rejected with HTTP 503.
   */
  maxConnections?: number;
  /**
   * Enable the built-in HTTP health/metrics endpoint.
   * When enabled, non-upgrade HTTP requests to `/health` return a JSON health check,
   * and requests to `/metrics` return Prometheus-compatible text metrics.
   * When attaching to a user-provided server (listen(..., { server })),
   * only /health and /metrics are handled; all other routes are left to
   * the application, and close() will not close the external server.
   * Ensure your app does not also write responses for /health or /metrics.
   * (default: false)
   */
  healthEndpoint?: boolean;
  /**
   * Maximum WebSocket payload size in bytes. Messages exceeding this limit
   * are rejected at the transport layer before JSON parsing, preventing OOM
   * from oversized or malicious payloads.
   * (default: 65536 / 64KB — sufficient for any standard OCPP message)
   */
  maxPayloadBytes?: number;
  /**
   * Enable worker thread pool for JSON parsing (+ optional AJV validation).
   * Offloads CPU-heavy work to worker threads, keeping the main event loop free.
   * Recommended for 10k+ concurrent connections. (default: false)
   *
   * - `true` → uses default pool size: `Math.max(2, os.cpus() - 2)`
   * - `{ poolSize, maxQueueSize }` → fine-tuned pool configuration
   */
  workerThreads?: boolean | { poolSize?: number; maxQueueSize?: number };
  /**
   * Enable WebSocket `permessage-deflate` compression.
   * Reduces bandwidth by ~80% for JSON payloads at the cost of ~0.2ms CPU per message.
   * - `true` → sensible defaults (threshold: 1024, level: 6)
   * - `object` → fine-tuned configuration
   * (default: false)
   */
  compression?: boolean | CompressionOptions;

  /**
   * Telemetry configuration for plugin stats push.
   * When configured and plugins implement `onTelemetry`, the server will
   * push `OCPPServerStats` at the configured interval.
   * - `{ pushIntervalMs: 10000 }` → push stats every 10s
   * - `{ pushIntervalMs: 0 }` → disable periodic push
   * (default: disabled)
   */
  telemetry?: TelemetryConfig;
}

/** When strictMode is enabled, protocols MUST be specified */
interface StrictServerOptions extends ServerOptionsBase {
  strictMode: true | OCPPProtocol[];
  protocols: AnyOCPPProtocol[];
}

/** When strictMode is disabled or omitted, protocols are optional */
interface RelaxedServerOptions extends ServerOptionsBase {
  strictMode?: false;
  protocols?: AnyOCPPProtocol[];
}

export type ServerOptions = StrictServerOptions | RelaxedServerOptions;

// ─── Telemetry Config ────────────────────────────────────────────

export interface TelemetryConfig {
  /**
   * Interval in ms to push server stats to plugins via `onTelemetry`.
   * Set to 0 to disable. (default: 0 — disabled)
   */
  pushIntervalMs?: number;
}

// ─── Observability ─────────────────────────────────────────────────

export interface OCPPServerStats {
  /** Number of currently connected WebSockets */
  connectedClients: number;
  /** Number of active memory sessions */
  activeSessions: number;
  /** Process uptime in seconds */
  uptimeSeconds: number;
  /** Process Memory Usage (bytes) */
  memoryUsage: NodeJS.MemoryUsage;
  /** Process CPU Time (microseconds) */
  cpuUsage: NodeJS.CpuUsage;
  /** Process ID */
  pid: number;
  /** Low-level WebSocket Server metrics */
  webSockets?: {
    /** Total active clients managed by the underlying ws server */
    total: number;
    /** Current messages waiting to be flushed to network (bytes) */
    bufferedAmount: number;
  };
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

// ─── Message Direction & Payload Types ──────────────────────────

/** Indicates whether a message is incoming (from peer) or outgoing (to peer) */
export type MessageDirection = "IN" | "OUT";

/**
 * Enriched context for message events, combining metadata from middleware
 * and message flow tracking. Uses type intersection since MiddlewareContext is a union.
 */
export type MessageEventContext = MiddlewareContext & {
  /** Message timestamp (ISO 8601) */
  timestamp: string;
  /** Latency in milliseconds (only for responses/results) */
  latencyMs?: number;
};

/**
 * Enriched message event payload with direction and context.
 * Replaces the simple OCPPMessage tuple for better observability.
 */
export interface MessageEventPayload {
  /** The raw OCPP message */
  message: OCPPMessage;
  /** Direction of the message: IN (from peer) or OUT (to peer) */
  direction: MessageDirection;
  /** Enriched context with metadata */
  ctx: MessageEventContext;
}

// ─── Event Types ─────────────────────────────────────────────────

export interface ClientEvents {
  open: [{ response: IncomingMessage }];
  close: [{ code: number; reason: string }];
  disconnect: [{ code: number; reason: string }];
  error: [Error];
  connecting: [{ url: string }];
  reconnect: [{ attempt: number; delay: number }];
  message: [MessageEventPayload];
  call: [OCPPCall];
  callResult: [OCPPCallResult];
  callError: [OCPPCallError];
  badMessage: [{ message: string; error: Error }];
  handlerError: [{ method: string; error: Error }];
  pongTimeout: [{ identity: string }];
  backpressure: [{ identity: string; bufferedAmount: number }];
  rateLimitExceeded: [{ rawData: unknown }];
  ping: [];
  pong: [];
  strictValidationFailure: [{ message: unknown; error: Error }];
}

import type { OCPPServerClient } from "./server-client.js";

/**
 * I3: Structured security event for SIEM integration.
 * Emitted by the server for audit-relevant actions.
 */
export interface SecurityEvent {
  /** Event type identifier */
  type:
    | "AUTH_FAILED"
    | "RATE_LIMIT_EXCEEDED"
    | "UPGRADE_ABORTED"
    | "CONNECTION_RATE_LIMIT"
    | "CONNECTION_LIMIT"
    | "INVALID_PAYLOAD"
    | "ANOMALY_RAPID_RECONNECT"
    | "ANOMALY_AUTH_BRUTE_FORCE"
    | "ANOMALY_MESSAGE_FUZZING"
    | "ANOMALY_IDENTITY_COLLISION";
  /** Station identity (if known) */
  identity?: string;
  /** Remote IP address */
  ip?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Event-specific details */
  details?: Record<string, unknown>;
}

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
  /** I3: Structured security event for SIEM/audit pipelines */
  securityEvent: [SecurityEvent];
  /** Enriched message event with direction and context */
  message: [MessageEventPayload];
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
  publishBatch?(messages: { channel: string; data: unknown }[]): Promise<void>;
  subscribe(channel: string, handler: (data: unknown) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  disconnect(): Promise<void>;

  // Presence Registry (Optional)
  setPresence?(identity: string, nodeId: string, ttl: number): Promise<void>;
  getPresence?(identity: string): Promise<string | null>;
  getPresenceBatch?(identities: string[]): Promise<(string | null)[]>;
  removePresence?(identity: string): Promise<void>;
  /**
   * Batch set multiple presence entries in a single pipeline.
   * Reduces N network round-trips to 1 for bulk presence updates.
   */
  setPresenceBatch?(
    entries: { identity: string; nodeId: string; ttl?: number }[],
  ): Promise<void>;

  // Observability Pipeline (Optional)
  metrics?(): Promise<Record<string, unknown>>;
}

// ─── Plugin System ───────────────────────────────────────────────

/**
 * Plugin interface for extending OCPPServer functionality.
 *
 * Plugins provide a unified way to hook into server lifecycle events
 * without modifying core internals. Useful for:
 * - Observability (OpenTelemetry, Prometheus)
 * - Custom adapters and integrations
 * - Auditing and compliance
 *
 * @example
 * ```ts
 * const myPlugin: OCPPPlugin = {
 *   name: 'my-plugin',
 *   onInit(server) { console.log('Plugin initialized'); },
 *   onConnection(client) { console.log(`${client.identity} connected`); },
 *   onDisconnect(client) { console.log(`${client.identity} disconnected`); },
 *   onClose() { console.log('Server shutting down'); },
 * };
 * server.plugin(myPlugin);
 * ```
 */
export interface OCPPPlugin {
  /** Unique plugin name (used for logging and deduplication) */
  name: string;

  // ─── Existing Lifecycle Hooks ───────────────────────────────────

  /** Called when the plugin is registered via server.plugin(plugin) */
  onInit?(server: import("./server.js").OCPPServer): void | Promise<void>;
  /** Called for each new client connection after auth succeeds */
  onConnection?(
    client: import("./server-client.js").OCPPServerClient,
  ): void | Promise<void>;
  /** Called when a client disconnects */
  onDisconnect?(
    client: import("./server-client.js").OCPPServerClient,
    code: number,
    reason: string,
  ): void;
  /** Called during server.close() for plugin cleanup */
  onClose?(): void | Promise<void>;

  // ─── Message Observation ───────────────────────────────────────

  /**
   * Called for every OCPP message (IN + OUT, CALL + CALLRESULT + CALLERROR).
   * Provides unified observability over all message traffic.
   */
  onMessage?(
    client: import("./server-client.js").OCPPServerClient,
    payload: MessageEventPayload,
  ): void | Promise<void>;

  // ─── Interception (return false to block) ──────────────────────

  /**
   * Called before a received message is parsed/routed.
   * Return `false` to silently drop the message.
   */
  onBeforeReceive?(
    client: import("./server-client.js").OCPPServerClient,
    rawData: unknown,
  ): undefined | boolean | Promise<undefined | boolean>;
  /**
   * Called before a message is transmitted on the wire.
   * Return `false` to suppress the send.
   */
  onBeforeSend?(
    client: import("./server-client.js").OCPPServerClient,
    message: OCPPMessage,
  ): undefined | boolean | Promise<undefined | boolean>;

  // ─── Error & Anomaly Observation ───────────────────────────────

  /** WebSocket-level or protocol-level error */
  onError?(
    client: import("./server-client.js").OCPPServerClient,
    error: Error,
  ): void | Promise<void>;
  /** Malformed / unparseable message received */
  onBadMessage?(
    client: import("./server-client.js").OCPPServerClient,
    rawMessage: string,
    error: Error,
  ): void | Promise<void>;
  /** Schema validation failure (strictMode) */
  onValidationFailure?(
    client: import("./server-client.js").OCPPServerClient,
    message: unknown,
    error: Error,
  ): void | Promise<void>;
  /** Message dropped or client disconnected due to rate limiting */
  onRateLimitExceeded?(
    client: import("./server-client.js").OCPPServerClient,
    rawData: unknown,
  ): void | Promise<void>;
  /** User handler threw an error during CALL processing */
  onHandlerError?(
    client: import("./server-client.js").OCPPServerClient,
    method: string,
    error: Error,
  ): void | Promise<void>;

  // ─── Security & Auth ───────────────────────────────────────────

  /** Structured security events (AUTH_FAILED, UPGRADE_ABORTED, etc.) */
  onSecurityEvent?(event: SecurityEvent): void | Promise<void>;
  /** Auth attempt failed — visible even when onConnection never fires */
  onAuthFailed?(
    handshake: HandshakeInfo,
    code: number,
    reason: string,
  ): void | Promise<void>;

  // ─── Connection Lifecycle ──────────────────────────────────────

  /** Existing client with same identity was evicted by a new connection */
  onEviction?(
    evictedClient: import("./server-client.js").OCPPServerClient,
    newClient: import("./server-client.js").OCPPServerClient,
  ): void | Promise<void>;
  /** Send buffer exceeded backpressure threshold (512KB — slow client) */
  onBackpressure?(
    client: import("./server-client.js").OCPPServerClient,
    bufferedAmount: number,
  ): void | Promise<void>;
  /** Pong not received within timeout — dead peer detected */
  onPongTimeout?(
    client: import("./server-client.js").OCPPServerClient,
  ): void | Promise<void>;

  // ─── Telemetry & Metrics ───────────────────────────────────────

  /** Periodic server stats snapshot (opt-in via `telemetry.pushIntervalMs`) */
  onTelemetry?(
    stats: OCPPServerStats,
    adapterMetrics?: Record<string, unknown>,
  ): void | Promise<void>;
  /**
   * Plugin contributes custom Prometheus metric lines to the /metrics endpoint.
   * Return an array of Prometheus exposition format strings.
   */
  getCustomMetrics?(): string[] | Promise<string[]>;

  // ─── Configuration & Server Control ────────────────────────────

  /** Server options changed via server.reconfigure() */
  onReconfigure?(
    newOptions: Partial<ServerOptions>,
    oldOptions: ServerOptions,
  ): void | Promise<void>;
  /** TLS certificates hot-reloaded via server.updateTLS() */
  onTLSUpdate?(tlsOpts: TLSOptions): void | Promise<void>;
  /** Server entering CLOSING state — pre-shutdown hook (before clients are drained) */
  onClosing?(): void | Promise<void>;
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
    }
  | {
      type: "outgoing_result";
      messageId: string;
      method: string;
      payload: unknown;
    }
  | {
      type: "outgoing_error";
      messageId: string;
      method: string;
      errorCode: string;
      errorDescription: string;
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
  /** Triggers the next middleware in the execution chain, optionally merging a payload into ctx.state and then client.session in the chain*/
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
