/** Plugins and their hooks. */
import type { MessageEventPayload, SecurityEvent } from "./events.js";
import type { HandshakeInfo } from "./handshake.js";
import type { AnyOCPPProtocol, OCPPMessage } from "./protocol.js";
import type { OCPPServerStats, ServerOptions } from "./server.js";
import type { TLSOptions } from "./transport.js";

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
 *
 * A plugin is typed for every protocol, so it can be added to any server and
 * its hooks see each connection typed for every version, as in 2.x. Type an
 * app's own plugin for its server's protocols with `createPlugin<"ocpp1.6">()`.
 */
/** What a plugin's lifecycle and event hooks return. @internal */
export type PluginHookResult = ReturnType<
  NonNullable<OCPPPlugin["onConnection"]>
>;
export interface OCPPPlugin<P extends AnyOCPPProtocol = AnyOCPPProtocol> {
  /**
   * Plugin name, used for logging and diagnostics.
   *
   * This is NOT a deduplication key: two instances of the same plugin with
   * different options (e.g. two webhook plugins posting to different URLs)
   * legitimately share a name. Registering the *same plugin object* twice is
   * rejected with a warning, since that only ever doubles its hooks.
   */
  name: string;

  // ─── Existing Lifecycle Hooks ───────────────────────────────────

  /**
   * Called when the plugin is registered via `server.plugin(plugin)` — not
   * when the server starts listening.
   *
   * Called a second time by `listen()` when a closed server is restarted,
   * because `close()` has already sent this plugin `onClosing` and `onClose`.
   * Treat it as "set up now", and expect it to be paired with an `onClose`
   * that may itself be followed by another `onInit`.
   */
  onInit?(
    server: import("../server/server.js").OCPPServer<P>,
  ): void | Promise<void>;
  /**
   * Called for each new client connection after auth succeeds.
   *
   * Also called once per already-connected client when the plugin is
   * registered on a running server, so per-connection state is not left
   * missing connections the plugin never saw open.
   *
   * On a duplicate-identity eviction the replacement's `onConnection` fires
   * **before** the evicted socket's `onDisconnect`. Key per-connection state
   * by this client object rather than by `client.identity`, or the evicted
   * socket's late disconnect will delete the replacement's entry.
   */
  onConnection?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
  ): void | Promise<void>;
  /** Called when a client disconnects */
  onDisconnect?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
    code: number,
    reason: string,
  ): void;
  /** Called during server.close() for plugin cleanup */
  onClose?(): void | Promise<void>;

  // ─── Message Observation ───────────────────────────────────────

  /**
   * Called for every OCPP message (IN + OUT, CALL + CALLRESULT + CALLERROR).
   * Provides unified observability over all message traffic.
   *
   * Inbound messages are processed through a per-connection chain, so a few
   * can still arrive here after that client's `onDisconnect` — anything read
   * from per-connection state should tolerate the entry already being gone.
   * Draining the chain first would hold the disconnect behind up to a hundred
   * queued frames, which costs more than the trailing observations are worth.
   */
  onMessage?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
    payload: MessageEventPayload,
  ): void | Promise<void>;

  // ─── Interception (return false to block) ──────────────────────

  /**
   * Called before a received message is parsed/routed.
   * Return `false` to silently drop the message.
   */
  onBeforeReceive?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
    rawData: unknown,
  ): undefined | boolean | Promise<undefined | boolean>;
  /**
   * Called before a message is transmitted on the wire.
   * Return `false` to suppress the send.
   */
  onBeforeSend?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
    message: OCPPMessage,
  ): undefined | boolean | Promise<undefined | boolean>;

  // ─── Error & Anomaly Observation ───────────────────────────────

  /** WebSocket-level or protocol-level error */
  onError?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
    error: Error,
  ): void | Promise<void>;
  /** Malformed / unparseable message received */
  onBadMessage?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
    rawMessage: string,
    error: Error,
  ): void | Promise<void>;
  /** Schema validation failure (strictMode) */
  onValidationFailure?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
    message: unknown,
    error: Error,
  ): void | Promise<void>;
  /** Message dropped or client disconnected due to rate limiting */
  onRateLimitExceeded?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
    rawData: unknown,
  ): void | Promise<void>;
  /** User handler threw an error during CALL processing */
  onHandlerError?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
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
    evictedClient: import("../server/server-client.js").OCPPServerClient<P>,
    newClient: import("../server/server-client.js").OCPPServerClient<P>,
  ): void | Promise<void>;
  /** Send buffer exceeded backpressure threshold (512KB — slow client) */
  onBackpressure?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
    bufferedAmount: number,
  ): void | Promise<void>;
  /** Pong not received within timeout — dead peer detected */
  onPongTimeout?(
    client: import("../server/server-client.js").OCPPServerClient<P>,
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
