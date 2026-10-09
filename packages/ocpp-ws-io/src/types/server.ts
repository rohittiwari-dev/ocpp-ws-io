/** Server, route, rate-limit, health and listen options. */
import type { Validator } from "../core/validation/validator.js";
import type { DuplicateConnectionPolicy, IdentityLookup } from "./handshake.js";
import type { LoggingConfig } from "./logger.js";
import type {
  AnyOCPPProtocol,
  Configured,
  MessageIdGenerator,
  MessageIdValidator,
  SecurityProfile,
  StrictModeMethod,
} from "./protocol.js";
import type {
  CompressionOptions,
  TLSOptions,
  WsServerOptions,
} from "./transport.js";

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
        client: import("../server/server-client.js").OCPPServerClient,
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
   * Applies only when `adaptive` is true. (default: 70)
   */
  cpuThresholdPercent?: number;
  /**
   * Memory usage percent threshold to begin throttling. This is process-wide
   * memory against the applicable limit — the cgroup limit when one is set,
   * otherwise host memory — not V8 heap.
   * Applies only when `adaptive` is true. (default: 85)
   */
  memThresholdPercent?: number;
  /**
   * Time (ms) both CPU and memory must stay below their thresholds
   * before restoring the original rate. (default: 10000)
   */
  cooldownMs?: number;
  /**
   * How often (ms) to sample CPU and memory.
   * Applies only when `adaptive` is true. (default: 2000)
   */
  sampleIntervalMs?: number;
}
// ─── Router Options ──────────────────────────────────────────────

export interface RouterConfig<P extends AnyOCPPProtocol = AnyOCPPProtocol> {
  /** Accepted OCPP subprotocols (e.g. ["ocpp1.6"]) */
  protocols?: readonly P[];
  /** Call timeout in ms — overrides server default */
  callTimeoutMs?: number;
  /** Ping interval in ms — overrides server default */
  pingIntervalMs?: number;
  /** Defer pings if activity detected — overrides server default */
  deferPingsOnActivity?: boolean;
  /** Max concurrent outbound calls — overrides server default */
  callConcurrency?: number;
  /** Enable strict mode validation — overrides server default */
  strictMode?: boolean | readonly Configured<P>[];
  /**
   * If defined, restricts strict mode validation ONLY to these methods:
   * `config()` takes the route's protocols' ({@link StrictModeMethodsFor})
   */
  strictModeMethods?: readonly StrictModeMethod[];
  /**
   * Rate Limiting configuration — overrides server default.
   *
   * Note: only the per-connection knobs apply here. `adaptive` (and the
   * `cpuThresholdPercent` / `memThresholdPercent` / `cooldownMs` values that
   * configure it) are process-wide — the adaptive limiter samples host CPU and
   * memory, so it cannot be scoped to one route. Set those in
   * `ServerOptions.rateLimit`; setting them here logs a warning and is ignored.
   */
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
   * Trust a reverse proxy's forwarding headers. (default: false)
   *
   * Two effects: `X-Forwarded-Proto` is honoured when evaluating
   * `allowedSchemes`, and `X-Forwarded-For` becomes the client IP for
   * `allowedIPs` and `connectionRateLimit`.
   *
   * Leave false unless the server is only reachable through a trusted proxy —
   * otherwise clients can spoof either header, bypassing wss-only rules or
   * getting themselves a private rate-limit bucket.
   *
   * `connectionRateLimit.trustProxy` overrides this for IP resolution, so
   * rate limiting can trust a proxy without enabling CORS.
   */
  trustProxy?: boolean;
}
// ─── Server Options ──────────────────────────────────────────────

interface ServerOptionsBase<P extends AnyOCPPProtocol> {
  /** OCPP Security Profile (default: NONE) */
  securityProfile?: SecurityProfile;
  /**
   * Under security profile 1 or 2, answer HTTP 401 to a connection that has
   * no Basic Auth username and password, or whose username is not its
   * identity (A00.FR.203/204, A00.FR.302/303). Set `false` to leave that
   * check to the auth callback, which then sees `handshake.password` as
   * `undefined`. Checking the password itself is always the auth callback's
   * job. (default: true)
   */
  requireBasicAuth?: boolean;
  /**
   * Tells whether a charging station identity is known. When it returns
   * `false` the connection is answered with HTTP 404, before middleware and
   * the auth callback run (OCPP-J §3.2: the CSMS SHOULD answer 404 to an
   * identity it does not recognize). A throw is answered with 500. Basic Auth
   * credentials (profile 1/2) are checked before it, so requests without them
   * never reach the lookup. Without it, the auth callback decides; use
   * `ctx.reject(404, "Unknown charging station")` there.
   */
  isKnownIdentity?: IdentityLookup;
  /**
   * What to do when a charging station connects while its identity is already
   * connected to this server; OCPP does not say. `"replace"` closes the old
   * connection, usually a dead link the charger has not noticed yet after a
   * network change. `"reject"` refuses the new one with HTTP 409.
   * (default: "replace")
   */
  duplicateConnection?: DuplicateConnectionPolicy;
  /**
   * Longest charging station identity accepted, in characters. When set it
   * applies to every connection, with or without `strictMode`, and replaces
   * the spec's limit. Without it, `strictMode` applies the spec's rules for
   * the negotiated version (2.0.1 / 2.1: at most 48 characters of
   * identifierString, without ":"; 1.6 has none), and otherwise any identity
   * is accepted. A violation is answered with HTTP 400. Must be a positive
   * integer.
   */
  maxIdentityLength?: number;
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
  /**
   * If defined, restricts strict mode validation ONLY to these methods: the
   * constructor takes the configured protocols' ({@link StrictModeMethodsFor})
   */
  strictModeMethods?: readonly StrictModeMethod[];
  /** Custom validators, for configured protocols — inherited */
  strictModeValidators?: readonly Configured<Validator<P>>[];
  /**
   * Creates the message ID of each CALL sent to a charging station — inherited.
   * A per-call `idempotencyKey` still wins; without this, a random UUID is
   * used.
   */
  idGenerator?: MessageIdGenerator;
  /**
   * Checks the message ID of each incoming CALL and SEND — inherited. Runs
   * with or without `strictMode`, in place of the built-in check. Without it,
   * strict mode rejects IDs over 36 characters (OCPP-J §4.1.4) and other
   * modes accept any string.
   */
  idValidator?: MessageIdValidator;
  /** Rate Limiting configuration — inherited */
  rateLimit?: RateLimitOptions;
  /**
   * Max bad messages — inherited (default: 50).
   * @see {@link ClientOptions.maxBadMessages}
   */
  maxBadMessages?: number;
  /**
   * Counting window for bad messages — inherited.
   * @see {@link ClientOptions.badMessageWindowMs}
   */
  badMessageWindowMs?: number;
  /** Include error details in responses — inherited (default: false) */
  respondWithDetailedErrors?: boolean;
  /**
   * Session inactivity timeout in milliseconds before garbage collection.
   * (default: 7200000 / 2 hours)
   */
  sessionTtlMs?: number;
  /**
   * How long `close()` waits for any one plugin's `onClosing` or `onClose`
   * before moving on. (default: 5000)
   *
   * Both hooks are awaited during shutdown. Unbounded, a single plugin whose
   * promise never settles — a broker call with no timeout of its own is enough
   * — hangs the shutdown indefinitely, and a supervisor eventually sends
   * SIGKILL, which is a worse ending than the one the plugin was delaying.
   *
   * A hook that overruns is abandoned and logged, and shutdown continues. Set
   * `0` to wait indefinitely instead, if a plugin genuinely must finish and
   * you are willing to stake the shutdown on it.
   */
  pluginShutdownTimeoutMs?: number;
  /**
   * TTL (seconds) for cluster presence registry entries, and the basis for
   * the automatic presence heartbeat (refreshed every ttl/2 while clients
   * are connected). Default: 300.
   */
  presenceTtlSeconds?: number;
  /**
   * Extra time (ms) added to `callTimeoutMs` when waiting for a cross-node
   * call result, to cover adapter transport latency.
   *
   * A cross-node call crosses the adapter TWICE — once carrying the request to
   * the owning node, once carrying the result back — so the grace must cover a
   * round trip, not a single hop. The shipped Redis adapter reads streams with
   * `BLOCK 1000` (or a non-blocking poll plus a 1s sleep when no dedicated
   * blocking client is configured), so worst-case transport latency is ~2s.
   * A smaller grace makes the origin give up while a perfectly good response
   * is still in flight, surfacing spurious TimeoutErrors on calls that
   * succeeded. Lower it only if your adapter delivers faster than this.
   * (default: 2000)
   */
  remoteCallGraceMs?: number;
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
   * - `trustProxy`: resolve the client IP from `X-Forwarded-For`
   *
   * **Behind a proxy, set `trustProxy`.** The client IP comes from the socket
   * unless a proxy is trusted, so behind a load balancer or ingress every
   * charger resolves to the proxy's address and shares one bucket — the per-IP
   * limit silently becomes a fleet-wide cap. The server warns once if it sees
   * an `X-Forwarded-For` header while no proxy is trusted.
   *
   * Only enable it when the server is reachable *only* through a trusted
   * proxy; otherwise a client can spoof the header to get its own bucket.
   * Falls back to `cors({ trustProxy })` when not set here.
   */
  connectionRateLimit?: {
    limit: number;
    windowMs: number;
    trustProxy?: boolean;
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
   *
   * - `true` — endpoints enabled, no access control
   * - `{ auth }` — endpoints enabled with access control
   *
   * (default: false)
   *
   * @example
   * ```ts
   * // No auth — open to anyone (dev / internal network)
   * const server = new OCPPServer({ healthEndpoint: true });
   *
   * // Bearer token — Prometheus sends `Authorization: Bearer <token>`
   * const server = new OCPPServer({
   *   healthEndpoint: { auth: { bearer: process.env.METRICS_TOKEN! } },
   * });
   *
   * // Basic auth — `Authorization: Basic base64(user:pass)`
   * const server = new OCPPServer({
   *   healthEndpoint: { auth: { username: "admin", password: "s3cret" } },
   * });
   * ```
   */
  healthEndpoint?: boolean | HealthEndpointOptions;
  /**
   * Maximum WebSocket payload size in bytes. Messages exceeding this limit
   * are rejected at the transport layer before JSON parsing, preventing OOM
   * from oversized or malicious payloads.
   * (default: 65536 / 64KB — sufficient for any standard OCPP message)
   */
  maxPayloadBytes?: number;
  /**
   * Raw `ws` server options, passed to `new WebSocketServer()`: for example
   * `maxFragments` and `maxBufferedChunks` (limits against fragment floods),
   * `allowSynchronousEvents`, `skipUTF8Validation` (faster, but invalid UTF-8
   * then reaches the parser instead of closing the connection with 1007 as
   * RFC 6455 requires), a `WebSocket` subclass, or `closeTimeout`. Options
   * the server sets itself are not offered here (see
   * {@link ManagedWsServerOption}). Changes through `reconfigure()` apply to
   * new connections.
   */
  wssOptions?: WsServerOptions;
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
   * Accept WebSocket `permessage-deflate` compression (RFC 7692) from
   * charging stations that offer it.
   *
   * Off by default because it costs memory and CPU on every connection, and
   * Node's zlib can fragment memory under high concurrency. OCPP 2.0.1 / 2.1
   * require a CSMS to support it (§3.3 / §3.4), so set it for full 2.x
   * compliance. It applies only to chargers that ask; the rest stay
   * uncompressed.
   * - `true` → defaults (threshold: 1024, level: 6, no context takeover)
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

  /**
   * Maximum time (ms) the HTTP server waits for a client to finish sending
   * request headers before destroying the socket. Applied only to servers
   * created by `listen()` — user-provided servers (`options.server`) are
   * left untouched.
   *
   * Protects against HTTP slowloris attacks that hold connections open by
   * drip-feeding headers. Node.js defaults to 60 000 ms here (and 300 000 ms
   * for `requestTimeout`), which is generous for an OCPP upgrade endpoint.
   *
   * Keep it at or below {@link requestTimeout}: the request timeout covers the
   * headers too, so a longer header timeout has no effect. Node checks both
   * every 30 s, so a limit takes effect 0–30 s after it expires.
   *
   * Set `0` to disable the timeout entirely.
   *
   * @default 30000
   * @example
   * ```ts
   * // Tight timeouts for production behind a load balancer
   * const server = new OCPPServer({
   *   headersTimeout: 10_000,
   *   requestTimeout: 10_000,
   * });
   * ```
   */
  headersTimeout?: number;

  /**
   * Maximum time (ms) the HTTP server waits for the complete request
   * (headers + body) before destroying the socket. Applied only to servers
   * created by `listen()` — user-provided servers are left untouched.
   *
   * Works alongside {@link headersTimeout} to harden the HTTP layer
   * against slow-request denial-of-service attacks.
   *
   * Set `0` to disable the timeout entirely.
   *
   * @default 30000
   * @example
   * ```ts
   * // Match headersTimeout for symmetry
   * const server = new OCPPServer({
   *   headersTimeout: 15_000,
   *   requestTimeout: 15_000,
   * });
   * ```
   */
  requestTimeout?: number;
}
/**
 * Server options with schema validation switched on.
 *
 * Selected by setting `strictMode`. `protocols` becomes required, because a
 * validator is built per subprotocol and the server has to know which ones to
 * prepare — the compiler enforces it here and the constructor throws as a
 * backstop for JavaScript callers.
 */
interface StrictServerOptions<P extends AnyOCPPProtocol = AnyOCPPProtocol>
  extends ServerOptionsBase<P> {
  /**
   * Validate every message against the official OCPP JSON schemas.
   *
   * Inbound requests, outbound requests, handler responses and inbound
   * responses are all checked. A failure throws an `RPCError` carrying the
   * matching OCPP-J code — `TypeConstraintViolation`,
   * `OccurrenceConstraintViolation`, `PropertyConstraintViolation`,
   * `FormatViolation` (`FormationViolation` on 1.6) — and emits
   * `strictValidationFailure`.
   *
   * Pass an array to validate only some of the negotiated protocols:
   * `strictMode: ["ocpp2.0.1"]` leaves an `ocpp1.6` connection unchecked.
   *
   * Validators for these protocols are built when the server is constructed,
   * so the ~27 ms cost does not land on the first message a charger sends.
   *
   * @example
   * new OCPPServer({ protocols: ["ocpp1.6"], strictMode: true })
   */
  strictMode: true | readonly Configured<P>[];

  /**
   * Subprotocols this server accepts, most preferred first, offered during the
   * WebSocket handshake. Required here because `strictMode` is set.
   *
   * A route may narrow this with its own `protocols`; the connection uses the
   * route's list when it has one and this list otherwise.
   */
  protocols: readonly P[];
}
/**
 * Server options with schema validation off — the default.
 *
 * Nothing checks message shape, so a malformed payload reaches your handler
 * as-is. Set `strictMode` to switch to {@link StrictServerOptions}.
 */
interface RelaxedServerOptions<P extends AnyOCPPProtocol = AnyOCPPProtocol>
  extends ServerOptionsBase<P> {
  /**
   * Schema validation. **Off by default** — omit it, or set `false`, and no
   * message is validated in either direction.
   *
   * To enable it, set `true` (or a list of protocols), which also makes
   * `protocols` required. See {@link StrictServerOptions.strictMode}.
   */
  strictMode?: false;

  /**
   * Subprotocols this server accepts, most preferred first, offered during the
   * WebSocket handshake.
   *
   * Optional here. Left unset, the server accepts the client's choice without
   * constraining it — fine for a plain WebSocket service, but a CSMS normally
   * names the versions it speaks.
   */
  protocols?: readonly P[];
}
/**
 * Options for {@link OCPPServer}.
 *
 * A union of two shapes: setting `strictMode` selects
 * {@link StrictServerOptions}, which also requires `protocols`. Omitting it
 * selects {@link RelaxedServerOptions}, where validation is off and
 * `protocols` is optional.
 */
export type ServerOptions<P extends AnyOCPPProtocol = AnyOCPPProtocol> =
  | StrictServerOptions<P>
  | RelaxedServerOptions<P>;
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
// ─── Health Endpoint Options ─────────────────────────────────────

/** Bearer-token auth for health/metrics endpoints. */
export interface HealthEndpointBearerAuth {
  /** Token the client sends as `Authorization: Bearer <token>`. */
  bearer: string;
}
/** Basic auth for health/metrics endpoints. */
export interface HealthEndpointBasicAuth {
  /** Username for HTTP Basic auth. */
  username: string;
  /** Password for HTTP Basic auth. */
  password: string;
}
/** Auth configuration — one of bearer token or basic credentials. */
export type HealthEndpointAuth =
  | HealthEndpointBearerAuth
  | HealthEndpointBasicAuth;
/** Configuration for the built-in `/health` and `/metrics` endpoints. */
export interface HealthEndpointOptions {
  /**
   * Access control for the endpoints. When set, requests without valid
   * credentials receive a `401 Unauthorized` response. Credentials are
   * compared in constant time to prevent timing attacks. Missing or empty
   * values throw when the server is created.
   *
   * Omit to leave the endpoints open (equivalent to `healthEndpoint: true`).
   */
  auth?: HealthEndpointAuth;
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
