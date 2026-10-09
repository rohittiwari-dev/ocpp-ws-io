/** Client options. */
import type { Validator } from "../core/validation/validator.js";
import type { LoggingConfig } from "./logger.js";
import type {
  AnyOCPPProtocol,
  Configured,
  MessageIdGenerator,
  MessageIdValidator,
  SecurityProfile,
  StrictModeMethod,
} from "./protocol.js";
import type { RateLimitOptions } from "./server.js";
import type {
  CompressionOptions,
  TLSOptions,
  WsClientOptions,
} from "./transport.js";

// ─── Client Options ──────────────────────────────────────────────

/**
 * Client options. P is the protocols the client may negotiate, inferred from
 * `protocols`; the bare type takes any protocol name, as before.
 */
export interface ClientOptions<P extends AnyOCPPProtocol = AnyOCPPProtocol> {
  /**
   * How long (ms) an inbound CALL waits for its handler during startup.
   *
   * The socket starts dispatching the moment it opens, so a CSMS that sends
   * `Reset` immediately can arrive before the application has registered its
   * handlers. Answering `NotImplemented` there tells the peer the charger does
   * not support an action it does support — a false statement on the wire, and
   * one that only happens sometimes, which makes it very hard to diagnose.
   *
   * Within this window after the socket opens, a CALL with no matching handler
   * waits for one to be registered instead of being rejected. It is answered
   * the moment the handler appears, or rejected with `NotImplemented` when the
   * window closes. Outside the window, an unknown action is rejected
   * immediately as before, so genuinely unsupported actions are never delayed.
   *
   * Set `0` to disable and reject immediately. (default: 1000)
   */
  handlerGraceMs?: number;

  /**
   * Retry in the background when the *first* `connect()` fails.
   *
   * `reconnect` only governs an already-established connection dropping, so a
   * charge point that boots while the CSMS is unreachable throws once and never
   * retries — the exact outage the option exists for. Enable this and a failed
   * initial connect schedules the normal backoff sequence; `connect()` still
   * rejects, so the caller learns about the failure either way.
   *
   * Off by default: without it, `connect()` failing leaves no timers behind,
   * which is what callers that handle their own retry expect. (default: false)
   */
  retryInitialConnect?: boolean;

  /**
   * Maximum time (ms) to wait for the WebSocket upgrade to complete.
   *
   * Without this a peer that accepts the TCP connection but never finishes the
   * handshake — a black-holed load balancer, a half-dead CSMS — parks
   * `connect()` in CONNECTING forever, and with `reconnect` enabled no retry is
   * ever scheduled because the attempt never fails. Set `0` to disable.
   * (default: 30000)
   */
  connectTimeoutMs?: number;

  /** Unique identity for this client (charging station ID) */
  identity: string;
  /** WebSocket endpoint URL (ws:// or wss://) */
  endpoint: string;
  /** OCPP Security Profile (default: NONE) */
  securityProfile?: SecurityProfile;
  /** Password for Basic Auth (Profile 1 & 2) */
  password?: string | Buffer;
  /**
   * TLS settings for a `wss://` endpoint, used on every security profile:
   * `ca` to trust a CSMS on a private CA, for example, even on profile 0.
   * Profile 3 needs `cert` and `key`, the certificate that identifies the
   * charging station.
   */
  tls?: TLSOptions;
  /** OCPP subprotocols to negotiate */
  protocols?: readonly P[];
  /** Additional WebSocket headers */
  headers?: Record<string, string>;
  /**
   * Raw `ws` client options, passed to `new WebSocket()`
   * `wsOpts` are: for example `agent` (an HTTP proxy), `localAddress`,
   * `family`, `origin`, `maxPayload` or `followRedirects`. Options the client
   * sets itself are not offered here (see {@link ManagedWsClientOption}):
   * use `connectTimeoutMs`, `compression`, `headers` and `tls` for those.
   * Node client only.
   */
  wsOpts?: WsClientOptions;
  /**
   * Query parameters for the connection URL, as an object or a query string
   * (`"a=1&b=2"`, a leading `?` is optional). Added after any query the
   * endpoint already has; the identity stays the last path segment.
   */
  query?: Record<string, string> | string;
  /** Enable automatic reconnection (default: true) */
  reconnect?: boolean;
  /** Maximum reconnection attempts (default: Infinity) */
  maxReconnects?: number;
  /**
   * Reconnect back-off before the first attempt, in ms (default: 1000). It
   * doubles after every failed attempt, up to `backoffMax`, and every wait
   * gets a new random addition of up to 25%, so it never drops below this.
   */
  backoffMin?: number;
  /**
   * Where the doubling back-off stops growing, in ms (default: 30000). The
   * random addition of up to 25% still applies on top of it.
   */
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
  /**
   * Enable strict mode validation (default: false): `true` for every
   * configured protocol, or a list of them.
   */
  strictMode?: boolean | readonly Configured<P>[];
  /**
   * If defined, restricts strict mode validation ONLY to these methods: the
   * constructor takes the configured protocols' ({@link StrictModeMethodsFor})
   */
  strictModeMethods?: readonly StrictModeMethod[];
  /** Custom validators for strict mode, for configured protocols */
  strictModeValidators?: readonly Configured<Validator<P>>[];
  /**
   * Creates the message ID of each outgoing CALL and SEND. A per-call
   * `idempotencyKey` still wins; without this, a random UUID is used.
   */
  idGenerator?: MessageIdGenerator;
  /**
   * Checks the message ID of each incoming CALL and SEND, with or without
   * `strictMode`, in place of the built-in check. Without it, strict mode
   * rejects IDs over 36 characters (OCPP-J §4.1.4) and other modes accept
   * any string.
   */
  idValidator?: MessageIdValidator;
  /**
   * Number of bad messages **in a row** at which the connection is closed
   * (code 1002). Every valid message resets the count, and empty frames are
   * ignored, so only a broken or hostile peer reaches the limit.
   *
   * - `0` or `1` — close on the first bad message.
   * - `50` (default) — close on the 50th consecutive bad message.
   * - `Infinity` — never disconnect on bad messages (development only).
   */
  maxBadMessages?: number;
  /**
   * Counting window in milliseconds for bad messages.
   *
   * A valid message always resets the count. The window additionally forgets
   * a run of bad messages that is spread out in time: it opens at the first
   * bad message, and once this many milliseconds have passed, the next bad
   * message resets the count and opens a new window.
   *
   * - `undefined` (default) — no time limit; only a valid message resets.
   * - `60_000` — also reset a run once it is older than a minute.
   *
   * Has no effect when `maxBadMessages` is `Infinity`.
   */
  badMessageWindowMs?: number;
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
   * Offer WebSocket `permessage-deflate` compression (RFC 7692) to the CSMS.
   * Off by default — nothing is offered — because it costs memory and CPU.
   * OCPP 2.0.1 / 2.1 RECOMMEND it for a charging station on mobile data; it
   * is used only when the CSMS agrees, otherwise frames go uncompressed.
   * - `true` → defaults (level: 6, no context takeover)
   * - `object` → fine-tuned configuration
   * (default: false)
   */
  compression?: boolean | CompressionOptions;
}
