import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
} from "node:http";
import {
  createServer as createHttpsServer,
  type ServerOptions as HttpsServerOptions,
} from "node:https";
import type { Duplex } from "node:stream";
import type { SecureContextOptions, Server as TlsServer } from "node:tls";
import type { WebSocketServer } from "ws";
import { initLogger } from "../core/init-logger.js";
import { LRUMap } from "../core/lru-map.js";
import { assertUniqueProtocols } from "../core/protocol-list.js";
import { createId, NOOP_LOGGER } from "../core/util.js";
import {
  assertStrictValidators,
  getStandardValidator,
} from "../core/validation/standard-validators.js";
import { abortHandshake, parseSubprotocols } from "../core/ws-util.js";
import type { AllMethodNames, OCPPResponseType } from "../generated/index.js";
import type { EventAdapterInterface } from "../types/adapter.js";
import type {
  AuthAccept,
  AuthCallback,
  ConnectionMiddleware,
} from "../types/auth.js";
import type { CallOptions, CloseOptions } from "../types/calls.js";
import type {
  SecurityEvent,
  ServerEvents,
  TypedEventEmitter,
} from "../types/events.js";
import type {
  BatchCall,
  BatchExactKeys,
  BatchResult,
  CheckedAction,
} from "../types/exact-keys.js";
import type { SendToClientArgs } from "../types/handlers.js";
import type { HandshakeInfo } from "../types/handshake.js";
import type { JsonObject } from "../types/json.js";
import type { LoggerLike, LoggerLikeNotOptional } from "../types/logger.js";
import type { OCPPPlugin } from "../types/plugins.js";
import {
  type AnyOCPPProtocol,
  type KnownProtocol,
  type RequestOf,
  SecurityProfile,
  type StrictModeMethodsFor,
  type UncheckedAction,
  type WithUniqueProtocols,
} from "../types/protocol.js";
import type {
  CORSOptions,
  HealthEndpointOptions,
  ListenOptions,
  ServerOptions,
} from "../types/server.js";
import type { PersistedSession, SessionData } from "../types/session.js";
import { AdaptiveLimiter } from "./adaptive-limiter.js";
import { checkCORS } from "./cors.js";
import { EventEmitterBase } from "./emitter-base.js";
import { assertHealthEndpointAuth, checkHealthAuth } from "./health-auth.js";
import { assertMaxIdentityLength, identityRefusal } from "./identity.js";
import {
  broadcastToAll,
  broadcastToIdentities,
  handleBroadcastMessage,
  handleUnicastMessage,
  type MessagingContext,
  type PendingRemoteCall,
  routeCall,
  safeRouteCall,
  sendBatchToClient,
} from "./messaging.js";
import {
  awaitShutdownHook,
  guardPluginHook,
  METRICS_PLUGIN_TIMEOUT_MS,
  reportPluginError,
  withTimeout,
} from "./plugin-hooks.js";
import {
  canRoutePresence,
  isNodeAlive,
  lookupPresence,
  nodeKey,
  type PresenceContext,
  refreshPresence,
  startPresenceRefresh,
  stopPresenceRefresh,
  sweepNodeLiveness,
} from "./presence.js";
import { RadixTrie } from "./radix-trie.js";
import { type AnyOCPPRouter, OCPPRouter } from "./router.js";
import type { OCPPServerClient } from "./server-client.js";
import {
  type SessionCache,
  sweepExpiredSessions,
  sweepPersistMarks,
} from "./sessions.js";
import {
  refuseOverConnectionLimit,
  refuseOverConnectionRate,
  sweepConnectionBuckets,
} from "./upgrade/admission.js";
import { authenticate, BASIC_AUTH_CHALLENGE } from "./upgrade/auth.js";
import type { ConnectionBucket, UpgradeContext } from "./upgrade/context.js";
import { buildHandshakeInfo } from "./upgrade/handshake.js";
import {
  type RegistrationContext,
  registerClient,
} from "./upgrade/register-client.js";
import {
  identityFromPath,
  matchRoute,
  type RouteTable,
} from "./upgrade/route-match.js";
import { createWorkerPool, type WorkerPool } from "./worker-pool.js";
import { createWss, warnIgnoredWssOptions } from "./wss-options.js";

/** A listening server whose certificate can be replaced in place (HTTPS). */
function canReloadSecureContext(
  srv: Server,
): srv is Server & Pick<TlsServer, "setSecureContext"> {
  return (
    "setSecureContext" in srv && typeof srv.setSecureContext === "function"
  );
}

/**
 * OCPPServer — A typed WebSocket RPC server for OCPP communication.
 *
 * Supports all 3 OCPP Security Profiles:
 * - Profile 1: Basic Auth over unsecured WS
 * - Profile 2: TLS + Basic Auth (HTTPS server)
 * - Profile 3: Mutual TLS (HTTPS server with requestCert)
 */
export class OCPPServer<
  P extends AnyOCPPProtocol = AnyOCPPProtocol,
  // The protocols list as given, so a protocol listed twice is a type error.
  const L extends readonly P[] = readonly P[],
> extends EventEmitterBase {
  // Typed for this server's protocols; a base class expression cannot use P.
  declare on: TypedEventEmitter<ServerEvents<P>>["on"];
  declare once: TypedEventEmitter<ServerEvents<P>>["once"];
  declare off: TypedEventEmitter<ServerEvents<P>>["off"];
  declare emit: TypedEventEmitter<ServerEvents<P>>["emit"];
  declare addListener: TypedEventEmitter<ServerEvents<P>>["addListener"];
  declare removeListener: TypedEventEmitter<ServerEvents<P>>["removeListener"];
  declare removeAllListeners: TypedEventEmitter<
    ServerEvents<P>
  >["removeAllListeners"];

  private _options: ServerOptions<P>;
  /** Radix trie for O(k) route matching (string patterns). */
  private _trie = new RadixTrie();
  /** Global middleware routers (server.use() with no patterns — catch-all). */
  private _globalMiddlewareRouters: AnyOCPPRouter[] = [];

  /** Every router registered on this server, for post-registration validation. */
  private _allRouters: AnyOCPPRouter[] = [];

  /** True once close() detached an adapter, so listen() can warn about it. */
  private _adapterDetachedByClose = false;

  /**
   * Handshakes past the connection-cap gate but not yet registered as clients.
   * Counted against maxConnections so concurrent async auth cannot overshoot.
   */
  private _pendingHandshakes = 0;

  /** In-flight presence deletions, awaited by close() before disconnecting. */
  private _pendingAdapterWrites = new Set<Promise<unknown>>();

  /** Short-lived cache of remote node liveness, so the check is not per-call. */
  private _nodeLiveness = new Map<string, { alive: boolean; at: number }>();
  /** Nodes observed advertising liveness; only these can be judged dead. */
  private _nodeLivenessSeen = new Set<string>();
  /** The presence fields, as server/presence.ts reads and writes them. */
  private readonly _presence: PresenceContext = this._createPresenceContext();
  /** Subprotocol chosen per upgrade, read back by ws's handleProtocols. */
  /** The protocol to answer with; `false` answers with none (OCPP-J §3.2). */
  private _negotiatedProtocols = new WeakMap<IncomingMessage, string | false>();
  /** Routers with RegExp patterns (fallback linear scan). */
  private _regexRouters: AnyOCPPRouter[] = [];
  /** The routers above, in the order server/upgrade/route-match.ts tries them. */
  private readonly _routes: RouteTable = {
    globalRouters: this._globalMiddlewareRouters,
    trie: this._trie,
    regexRouters: this._regexRouters,
  };
  /** The server state the steps in server/upgrade/ read, through getters. */
  private readonly _upgrade: UpgradeContext = this._createUpgradeContext();
  /** The server state client registration reads, through getters. */
  private readonly _registration: RegistrationContext<P> =
    this._createRegistrationContext();
  private _clients = new Set<OCPPServerClient<P>>();
  private _clientsByIdentity = new Map<string, OCPPServerClient<P>>();
  private _httpServers = new Set<Server>();
  /** HTTP servers created by listen() — we own their lifecycle. */
  private _ownedHttpServers = new Set<Server>();
  /** Set once the proxy-header mismatch has been reported. */
  private _warnedUntrustedProxy = false;
  private _warnedNoAuthCallback = false;

  /** Listeners we attached per server, for removal on close(). */
  private _attachedHttpHandlers = new Map<
    Server,
    {
      upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
      request?: (
        req: IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => void;
    }
  >();
  private _wss: WebSocketServer | null = null;
  private _state: "OPEN" | "CLOSING" | "CLOSED" = "OPEN";
  /** The close() in progress, so concurrent callers await the same shutdown. */
  private _closing: Promise<void> | null = null;
  private _adapter: EventAdapterInterface | null = null;
  private _httpServerAbortControllers = new Set<AbortController>();
  private _logger: LoggerLike | null = null;
  private _globalCORS?: CORSOptions;

  // Connection-level rate limiting (per-IP token bucket)
  private _connectionBuckets = new Map<string, ConnectionBucket>();
  private _adaptiveLimiter: AdaptiveLimiter | null = null;
  private _plugins: OCPPPlugin<P>[] = [];
  private _workerPool: WorkerPool | null = null;
  private _telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private _presenceInterval: ReturnType<typeof setTimeout> | null = null;
  /** Guards against overlapping presence refreshes when one runs long. */
  private _presenceRefreshInFlight = false;

  // Robustness & Clustering
  private readonly _nodeId = createId();

  /** Pending cross-node RPC calls awaiting a correlated response. */
  private _pendingRemoteCalls = new Map<string, PendingRemoteCall>();
  /** The routing fields, as server/messaging.ts reads them. */
  private readonly _messaging: MessagingContext<P> =
    this._createMessagingContext();

  private _sessions: LRUMap<
    string,
    { data: PersistedSession; lastActive: number }
  >;
  private _gcInterval: NodeJS.Timeout | null = null;
  private readonly _sessionTimeoutMs: number;

  /**
   * Tracks the last time each identity's session was persisted to the adapter,
   * so activity-only writes can be debounced (at most once per 30 s).
   */
  private _sessionLastPersisted = new Map<string, number>();
  /** `_sessions`, `_sessionLastPersisted`, `_pendingAdapterWrites` and the TTL, as server/sessions.ts reads them. */
  private readonly _sessionCache: SessionCache;

  /** Longest a connecting charger waits for the adapter's stored session. */
  private static readonly _SESSION_FETCH_TIMEOUT_MS = 1000;

  constructor(
    options: WithUniqueProtocols<ServerOptions<P>, P, L> &
      StrictModeMethodsFor<P> = {},
  ) {
    super();
    this.setMaxListeners(0);

    if (options.strictMode) {
      if (!options.protocols?.length) {
        throw new Error(
          "strictMode requires protocols to be specified (e.g. protocols: ['ocpp1.6'])",
        );
      }
    }

    assertMaxIdentityLength(options.maxIdentityLength);
    assertUniqueProtocols(options.protocols);
    assertStrictValidators(
      options.protocols,
      options.strictMode,
      options.strictModeValidators,
    );

    this._options = {
      securityProfile: SecurityProfile.NONE,
      callTimeoutMs: 30000,
      pingIntervalMs: 30000,
      deferPingsOnActivity: false,
      callConcurrency: 1,
      maxBadMessages: 50,
      respondWithDetailedErrors: false,
      handshakeTimeoutMs: 30000,
      sessionTtlMs: 2 * 60 * 60 * 1000,
      ...options,
    };

    assertHealthEndpointAuth(this._options.healthEndpoint);

    this._sessionTimeoutMs = this._options.sessionTtlMs!;

    // Initialize bounded LRU session cache
    const maxSessions = this._options.maxSessions ?? 50_000;
    this._sessions = new LRUMap(maxSessions);
    this._sessionCache = {
      sessions: this._sessions,
      lastPersisted: this._sessionLastPersisted,
      pendingWrites: this._pendingAdapterWrites,
      timeoutMs: this._sessionTimeoutMs,
    };

    // Initialize WebSocketServer immediately (ws best practice: noServer mode)
    // Apply maxPayloadBytes to reject oversized frames at the transport layer
    this._wss = createWss(this._options, this._negotiatedProtocols);

    // Start Session Garbage Collector
    this._startSessionGC();

    // Initialize logger
    this._logger = initLogger(this._options.logging, {
      component: "OCPPServer",
    });

    if (this._options.maxBadMessages === Infinity) {
      this._logger?.warn?.(
        "maxBadMessages is Infinity — every connection can send unlimited malformed messages without disconnection. Set a finite value for production use.",
      );
    }
    if (this._options.respondWithDetailedErrors) this._warnDetailedErrors();
    warnIgnoredWssOptions(this._options.wssOptions, this._logger);

    // Building a protocol's validator costs ~27 ms, against 0.9 µs to run one.
    // Left to the first message that needs it, that lands on a charger's first
    // BootNotification — which after a deploy is every charger at once, on the
    // event loop. Doing it here happens before any socket exists and covers
    // every route a server goes live by: listen(), the handleUpgrade getter,
    // and the Express/Fastify/Hono/NestJS adapters that all call through it.
    this._warmValidators();

    // Initialize adaptive rate limiter if enabled
    const rl = this._options.rateLimit;
    if (rl?.adaptive) {
      this._adaptiveLimiter = new AdaptiveLimiter({
        cpuThresholdPercent: rl.cpuThresholdPercent,
        memThresholdPercent: rl.memThresholdPercent,
        cooldownMs: rl.cooldownMs,
        sampleIntervalMs: rl.sampleIntervalMs,
      });
      this._adaptiveLimiter.on(
        "adapted",
        (event: {
          multiplier: number;
          cpuPercent: number;
          memPercent: number;
        }) => {
          this._logger?.info?.("Adaptive rate limit adjusted", event);
          this.emit("rateLimit:adapted", event);
        },
      );
      this._adaptiveLimiter.start();
    }

    // Initialize worker thread pool if enabled
    const wt = this._options.workerThreads;
    if (wt) {
      const poolOpts = typeof wt === "object" ? wt : {};
      this._workerPool = createWorkerPool(poolOpts);
      if (this._workerPool) {
        this._logger?.info?.("Worker thread pool initialized", {
          poolSize: this._workerPool.size,
        });
      } else {
        this._logger?.warn?.(
          "workerThreads was requested but the worker pool could not be created — falling back to main-thread parsing",
        );
      }
    }
  }

  // ─── Plugin hook dispatch ────────────────────────────────────

  /**
   * Run a plugin's `onInit`.
   *
   * Called when the plugin is registered, and again by `listen()` when the
   * server is being restarted after a `close()`. `close()` sends every plugin
   * `onClosing` and `onClose`, so without the second call a plugin that
   * acquired anything at init stayed torn down for the rest of the process —
   * and a later `close()` sent it a second `onClose` it had never been
   * re-initialised for.
   */
  private _initPlugin(plugin: OCPPPlugin<P>): void {
    if (!plugin.onInit) return;
    try {
      guardPluginHook(this._logger, plugin.onInit(this), plugin.name, "onInit");
    } catch (err) {
      reportPluginError(this._logger, plugin.name, "onInit", err);
    }
  }

  /** The certificate and protocol settings of a TLS context, from TLSOptions. */
  private static _secureContextOptions(
    tlsOpts: import("../types/index.js").TLSOptions,
  ): SecureContextOptions {
    const options: SecureContextOptions = {};
    if (tlsOpts.cert) options.cert = tlsOpts.cert;
    if (tlsOpts.key) options.key = tlsOpts.key;
    if (tlsOpts.ca) options.ca = tlsOpts.ca;
    if (tlsOpts.passphrase) options.passphrase = tlsOpts.passphrase;
    if (tlsOpts.minVersion) options.minVersion = tlsOpts.minVersion;
    if (tlsOpts.maxVersion) options.maxVersion = tlsOpts.maxVersion;
    if (tlsOpts.ciphers) options.ciphers = tlsOpts.ciphers;
    return options;
  }

  /** Emit a security event, and pass it to every plugin's onSecurityEvent. */
  private _emitSecurityEvent(event: SecurityEvent): void {
    this.emit("securityEvent", event);
    for (const plugin of this._plugins) {
      try {
        guardPluginHook(
          this._logger,
          plugin.onSecurityEvent?.(event),
          plugin.name,
          "onSecurityEvent",
        );
      } catch (err) {
        reportPluginError(this._logger, plugin.name, "onSecurityEvent", err);
      }
    }
  }

  /** The fields the upgrade steps read, and the reports they make, by name. */
  private _createUpgradeContext(): UpgradeContext {
    const server = this;
    return {
      get logger() {
        return server._logger;
      },
      get globalCORS() {
        return server._globalCORS;
      },
      get maxConnections() {
        return server._options.maxConnections;
      },
      get connectionRateLimit() {
        return server._options.connectionRateLimit;
      },
      get handshakeTimeoutMs() {
        return server._options.handshakeTimeoutMs;
      },
      get clientCount() {
        return server._clients.size;
      },
      get pendingHandshakes() {
        return server._pendingHandshakes;
      },
      get connectionBuckets() {
        return server._connectionBuckets;
      },
      get warnedUntrustedProxy() {
        return server._warnedUntrustedProxy;
      },
      set warnedUntrustedProxy(warned) {
        server._warnedUntrustedProxy = warned;
      },
      emitSecurityEvent: (event) => server._emitSecurityEvent(event),
      emitUpgradeAborted: (event) => {
        server.emit("upgradeAborted", event);
      },
      reportAuthFailure: (handshake, req, code, message) =>
        server._reportAuthFailure(handshake, req, code, message),
      reportUpgradeError: (handshake, req, error, stack) =>
        server._reportUpgradeError(handshake, req, error, stack),
    };
  }

  /** The fields client registration reads, and the client event, by name. */
  private _createRegistrationContext(): RegistrationContext<P> {
    const server = this;
    return {
      get options() {
        return server._options;
      },
      get logger() {
        return server._logger;
      },
      get plugins() {
        return server._plugins;
      },
      get clients() {
        return server._clients;
      },
      get clientsByIdentity() {
        return server._clientsByIdentity;
      },
      get sessions() {
        return server._sessions;
      },
      get sessionCache() {
        return server._sessionCache;
      },
      get adapter() {
        return server._adapter;
      },
      get nodeId() {
        return server._nodeId;
      },
      get presence() {
        return server._presence;
      },
      get adaptiveLimiter() {
        return server._adaptiveLimiter;
      },
      get workerPool() {
        return server._workerPool;
      },
      emitClient: (client) => {
        server.emit("client", client);
      },
    };
  }

  /** Log and emit a refused handshake, and pass it to the plugins. */
  private _reportAuthFailure(
    handshake: HandshakeInfo,
    req: IncomingMessage,
    code: number,
    message: string,
  ): void {
    const identity = handshake.identity;
    this._logger?.warn?.("Auth rejected", { identity, code });
    // Emit security event for auth failures
    const secEvtAuth = {
      type: "AUTH_FAILED" as const,
      identity,
      ip: req.socket.remoteAddress,
      timestamp: new Date().toISOString(),
      details: { code, message },
    };
    this.emit("securityEvent", secEvtAuth);
    // Plugin: onSecurityEvent + onAuthFailed
    for (const plugin of this._plugins) {
      try {
        guardPluginHook(
          this._logger,
          plugin.onSecurityEvent?.(secEvtAuth),
          plugin.name,
          "onSecurityEvent",
        );
      } catch (err) {
        reportPluginError(this._logger, plugin.name, "onSecurityEvent", err);
      }
      try {
        guardPluginHook(
          this._logger,
          plugin.onAuthFailed?.(handshake, code, message),
          plugin.name,
          "onAuthFailed",
        );
      } catch (err) {
        reportPluginError(this._logger, plugin.name, "onAuthFailed", err);
      }
    }
  }

  private _warnDetailedErrors(): void {
    this._logger?.warn?.(
      "respondWithDetailedErrors is on: a handler error's properties are sent to chargers in CALLERROR details. Keep it off in production.",
    );
  }

  /**
   * An unexpected error during a handshake: logged with its details, and
   * reported as UPGRADE_ERROR so outages are not counted as auth failures.
   */
  private _reportUpgradeError(
    handshake: HandshakeInfo,
    req: IncomingMessage,
    error: string,
    stack: string | undefined,
  ): void {
    const identity = handshake.identity;
    this._logger?.error?.("Handshake failed with an unexpected error", {
      identity,
      error,
      stack,
    });
    const secEvt = {
      type: "UPGRADE_ERROR" as const,
      identity,
      ip: req.socket.remoteAddress,
      timestamp: new Date().toISOString(),
      details: { error },
    };
    this._emitSecurityEvent(secEvt);
  }

  // ─── Getters ─────────────────────────────────────────────────
  get log() {
    return (this._logger || NOOP_LOGGER) as LoggerLikeNotOptional;
  }
  /**
   * Returns a readonly set of all currently connected OCPPServerClient instances.
   */
  get clients(): ReadonlySet<OCPPServerClient<P>> {
    return this._clients;
  }

  /**
   * Returns the current server state (OPEN, CLOSING, CLOSED).
   */
  get state(): "OPEN" | "CLOSING" | "CLOSED" {
    return this._state;
  }

  /**
   * Returns current node observability statistics
   * (e.g. connected socket count, tracked memory sessions, and process CPU/Memory usage).
   * Fully compatible with Loki/Prometheus node metric ingestion.
   */
  stats(): import("../types/index.js").OCPPServerStats {
    let bufferedAmount = 0;
    if (this._wss) {
      for (const ws of this._wss.clients) {
        bufferedAmount += ws.bufferedAmount;
      }
    }

    return {
      connectedClients: this._clients.size,
      activeSessions: this._sessions.size,
      uptimeSeconds: process.uptime(),
      pid: process.pid,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      webSockets: this._wss
        ? {
            total: this._wss.clients.size,
            bufferedAmount,
          }
        : undefined,
    };
  }
  /**
   * Returns observability statistics from the active Event Adapter (e.g. Redis).
   * Useful for tracking consumer backlog and enabling Horizontal Pod Autoscaling.
   */
  async adapterMetrics(): Promise<Record<string, unknown> | null> {
    if (!this._adapter?.metrics) return null;
    try {
      return await this._adapter.metrics();
    } catch (err) {
      this._logger?.warn?.("Failed to fetch adapter metrics", {
        error: err,
      });
      return null;
    }
  }
  /**
   * Synchronously returns the OCPPServerClient instance if the specific identity
   * is connected to THIS local server node.
   * Note: In a clustered environment, clients connected to other nodes will NOT be returned here.
   *
   * @param identity The client identity (username/station ID)
   */
  getLocalClient(identity: string): OCPPServerClient<P> | undefined {
    return this._clientsByIdentity.get(identity);
  }

  /**
   * Synchronously checks if the specific identity is connected to THIS local server node.
   * Note: In a clustered environment, this will return false if the client is connected to another node.
   *
   * @param identity The client identity (username/station ID)
   */
  hasLocalClient(identity: string): boolean {
    return this.getLocalClient(identity) !== undefined;
  }

  /**
   * Asynchronously checks if the specific identity is connected to the server.
   * In a single-node setup, this checks the local connections.
   * In a clustered setup (with a pub/sub adapter), this will also check the global presence registry
   * to see if the client is connected to ANY node in the cluster.
   *
   * @param identity The client identity (username/station ID)
   */
  async isClientConnected(identity: string): Promise<boolean> {
    if (this.hasLocalClient(identity)) {
      return true;
    }

    if (canRoutePresence(this._presence)) {
      const nodeId = await lookupPresence(this._presence, identity);
      return nodeId !== null;
    }

    return false;
  }

  // ─── Auth ────────────────────────────────────────────────────

  // ─── Routing & Middleware ────────────────────────────────────

  /**
   * Applies global CORS rules to all incoming connections before routing.
   */
  cors(options: CORSOptions): this {
    this._globalCORS = options;
    return this;
  }

  /**
   * Registers a new routing dispatcher for multiplexing connections.
   * `server.route("/api/:tenant").use(middleware).auth(cb).on("client", ...)`
   */
  route(...patterns: Array<string | RegExp>): OCPPRouter<P> {
    const router = new OCPPRouter<P>();
    router.route(...patterns);
    this._registerRouter(router);
    return router;
  }

  /**
   * Attaches one or more standalone modular routers created via `createRouter()`.
   * This is useful for separating route definitions across different files.
   */
  attachRouters(...routers: AnyOCPPRouter[]): this {
    for (const router of routers) {
      this._registerRouter(router);
    }
    return this;
  }

  /**
   * Registers one or more plugins for server lifecycle hooks.
   * Plugins are called in registration order for all lifecycle events.
   *
   * @example Single plugin
   * ```ts
   * server.plugin(metricsPlugin);
   * ```
   *
   * @example Multiple plugins
   * ```ts
   * server.plugin(metricsPlugin, loggingPlugin, otelPlugin);
   * ```
   *
   * Written inline, a plugin's hooks get this server's connections typed for
   * its protocols. A plugin typed for every protocol (`OCPPPlugin`) fits any
   * server; one from `createPlugin<"ocpp1.6">()` only a server with those
   * protocols.
   */
  plugin(...plugins: OCPPPlugin<P>[]): this {
    for (const plugin of plugins) {
      // Registering the same plugin object twice only ever doubles its hooks —
      // double-counted metrics, duplicate webhooks. Two distinct instances that
      // share a name (two webhooks to different URLs) are legitimate, so this
      // compares identity, not name.
      if (this._plugins.includes(plugin)) {
        this._logger?.warn?.("Plugin already registered — skipping", {
          name: plugin.name,
        });
        continue;
      }
      this._plugins.push(plugin);
      this._logger?.info?.("Plugin registered", { name: plugin.name });
      this._initPlugin(plugin);

      // Connections already open share this same plugin array, so the new
      // plugin starts receiving onBeforeSend and onBeforeReceive for them
      // immediately, and will be sent their onDisconnect when they close — for
      // connections it never saw open. Anything holding per-connection state
      // would then be reconciling a disconnect against nothing.
      //
      // Catching it up costs one onConnection per live client, at registration
      // only. A plugin registered before listen() sees no clients here and is
      // unaffected.
      for (const client of this._clients) {
        try {
          guardPluginHook(
            this._logger,
            plugin.onConnection?.(client),
            plugin.name,
            "onConnection",
          );
        } catch (err) {
          reportPluginError(this._logger, plugin.name, "onConnection", err);
        }
      }
    }
    // Start telemetry push if configured and not already running
    this._startTelemetryPush();
    return this;
  }

  /**
   * Starts the periodic telemetry push engine if configured.
   * Pushes OCPPServerStats to all plugins implementing onTelemetry.
   */
  private _startTelemetryPush(): void {
    // Don't start if already running or if no interval configured
    if (this._telemetryInterval) return;
    const interval = this._options.telemetry?.pushIntervalMs;
    if (!interval || interval <= 0) return;
    // Only start if at least one plugin has onTelemetry
    if (!this._plugins.some((p) => p.onTelemetry)) return;

    this._telemetryInterval = setInterval(async () => {
      try {
        const stats = this.stats();
        const adapterMetrics = this._adapter
          ? await this.adapterMetrics().catch(() => null)
          : null;
        for (const p of this._plugins) {
          try {
            await p.onTelemetry?.(stats, adapterMetrics ?? undefined);
          } catch {}
        }
      } catch {}
    }, interval);
    this._telemetryInterval.unref(); // Don't block process exit
  }

  /**
   * Registers middleware chain(s) as a wildcard/catch-all router.
   *
   * @example
   * ```ts
   * server.use(myMiddleware).route("/api").on("client", ...);
   * ```
   */
  use(...middlewares: ConnectionMiddleware[]): OCPPRouter<P> {
    const router = new OCPPRouter<P>();
    router.use(...middlewares);
    this._registerRouter(router);
    return router;
  }

  /**
   * Registers a top-level auth handler, returning a router to attach `.on()` or `.use()`.
   */
  auth<TSession = SessionData>(
    callback: AuthCallback<TSession, P>,
  ): OCPPRouter<P> {
    const router = new OCPPRouter<P>();
    router.auth(callback);
    this._registerRouter(router);
    return router;
  }

  /**
   * Routes a router into the appropriate internal structure:
   * - String patterns → radix trie (O(k) lookup)
   * - RegExp patterns → linear fallback array
   * - No patterns → global middleware (catch-all)
   * @internal
   */
  /**
   * Warn when a route sets adaptive-limiter knobs. The adaptive limiter samples
   * host CPU/memory and is process-wide, so it is only ever built from
   * ServerOptions.rateLimit — a route-level `adaptive` is silently inert.
   */
  private _warnRouteAdaptiveRateLimit(): void {
    for (const router of this._allRouters) {
      const rl = router._routeConfig?.rateLimit;
      if (!rl) continue;
      const inert = (
        [
          "adaptive",
          "cpuThresholdPercent",
          "memThresholdPercent",
          "cooldownMs",
        ] as const
      ).filter((k) => rl[k] !== undefined);
      if (inert.length > 0) {
        this._logger?.warn?.(
          "Route-level rateLimit ignores process-wide adaptive options — set them in ServerOptions.rateLimit",
          { ignored: inert },
        );
      }
    }
  }

  private _registerRouter(router: AnyOCPPRouter): void {
    this._allRouters.push(router);
    const stringPatterns = router.patterns.filter(
      (p): p is string => typeof p === "string",
    );
    const hasRegex = router._regexPatterns.length > 0;

    if (stringPatterns.length === 0 && !hasRegex) {
      // No patterns at all → global catch-all middleware
      this._globalMiddlewareRouters.push(router);
    } else {
      // Insert string patterns into the trie
      for (const pattern of stringPatterns) {
        this._trie.insert(pattern, router);
      }
      // RegExp patterns go to fallback array
      if (hasRegex) {
        this._regexRouters.push(router);
      }
    }

    // Sync patterns added after registration (e.g. server.route("/a").route("/b"))
    router._onPatternAdded = (pattern) => {
      // A router that was registered as global middleware becomes scoped
      // the moment it gains a pattern.
      const globalIdx = this._globalMiddlewareRouters.indexOf(router);
      if (globalIdx !== -1) this._globalMiddlewareRouters.splice(globalIdx, 1);

      if (typeof pattern === "string") {
        this._trie.insert(pattern, router);
      } else if (!this._regexRouters.includes(router)) {
        this._regexRouters.push(router);
      }
    };
  }

  // ─── Listen ──────────────────────────────────────────────────

  async listen(
    port = 0,
    host?: string,
    options?: ListenOptions,
  ): Promise<Server> {
    // Route config is chained onto the router after route() returns, so this
    // is the first point where every route's config is settled.
    this._warnRouteAdaptiveRateLimit();

    if (this._adapterDetachedByClose && !this._adapter) {
      this._logger?.warn?.(
        "Restarting without an event adapter — close() disconnected the previous one. Cross-node routing stays disabled until setAdapter() is called again.",
      );
      this._adapterDetachedByClose = false;
    }

    let httpServer: Server;

    if (options?.server) {
      // Use existing HTTP/HTTPS server
      httpServer = options.server;
    } else {
      // Create server based on security profile
      const profile = this._options.securityProfile ?? SecurityProfile.NONE;

      if (
        profile === SecurityProfile.TLS_BASIC_AUTH ||
        profile === SecurityProfile.TLS_CLIENT_CERT
      ) {
        const tlsOpts = this._options.tls ?? {};
        const httpsOptions: HttpsServerOptions =
          OCPPServer._secureContextOptions(tlsOpts);

        // Profile 3: Request client certificate (mTLS)
        if (profile === SecurityProfile.TLS_CLIENT_CERT) {
          httpsOptions.requestCert = true;
          httpsOptions.rejectUnauthorized = tlsOpts.rejectUnauthorized ?? true;
        }

        httpServer = createHttpsServer(httpsOptions);
      } else {
        httpServer = createHttpServer();
      }
    }

    // Reset state if server was previously closed
    if (this._state === "CLOSED") {
      this._state = "OPEN";

      // close() sent every plugin onClosing and onClose, and onInit otherwise
      // runs only at registration — so a restarted server used to come back up
      // with all of its plugins torn down, and the next close() sent them a
      // second onClose they had never been re-initialised for. The worker pool
      // and the event adapter are re-created for the same reason.
      for (const plugin of this._plugins) {
        this._initPlugin(plugin);
      }

      // Everything else close() stopped. Each of these was started once, in the
      // constructor or at plugin registration, so a restarted server came back
      // with the session GC dead (leaking a connection bucket per client IP),
      // adaptive rate limiting stopped while still attached — so it stayed
      // pinned at a multiplier of 1 and never shed load again, while every
      // option still said it was enabled — and telemetry never pushed again.
      this._startSessionGC();
      this._adaptiveLimiter?.start();
      this._startTelemetryPush();
    }

    // Re-create the worker pool after a close()/listen() restart cycle
    // (close() shuts it down so worker threads don't pin the process).
    if (this._options.workerThreads && !this._workerPool) {
      const wt = this._options.workerThreads;
      this._workerPool = createWorkerPool(typeof wt === "object" ? wt : {});
    }

    // Handle upgrade requests
    const upgradeHandler = (
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) => {
      this._handleUpgrade(req, socket, head).catch((err) => {
        // Ensure socket is destroyed on error to prevent leaks
        if (!socket.destroyed) {
          socket.destroy();
        }
        this._logger?.error?.("Upgrade error", {
          error: (err as Error).message,
        });
        this.emit("upgradeError", { error: err, socket });
      });
    };

    httpServer.on("upgrade", upgradeHandler);
    this._httpServers.add(httpServer);

    const ownsServer = !options?.server;
    if (ownsServer) {
      this._ownedHttpServers.add(httpServer);

      // `0` disables the timeout here exactly as it does in reconfigure().
      const headersTimeout = this._options.headersTimeout ?? 30_000;
      const requestTimeout = this._options.requestTimeout ?? 30_000;
      httpServer.headersTimeout = headersTimeout > 0 ? headersTimeout : 0;
      httpServer.requestTimeout = requestTimeout > 0 ? requestTimeout : 0;
    }

    // Health/Metrics HTTP endpoint
    let requestHandler:
      | ((
          req: IncomingMessage,
          res: import("node:http").ServerResponse,
        ) => void)
      | undefined;
    if (this._options.healthEndpoint) {
      // Re-checked here because reconfigure() can replace the option.
      assertHealthEndpointAuth(this._options.healthEndpoint);
      const heOpts: HealthEndpointOptions | undefined =
        typeof this._options.healthEndpoint === "object"
          ? this._options.healthEndpoint
          : undefined;
      if (!heOpts?.auth) {
        this._logger?.warn?.(
          "healthEndpoint has no auth: /health and /metrics answer anyone who can reach this port. Set healthEndpoint: { auth: { bearer } } or { auth: { username, password } }.",
        );
      }

      const serveHealth = async (
        req: IncomingMessage,
        res: import("node:http").ServerResponse,
      ): Promise<void> => {
        if (res.headersSent || res.writableEnded) return;
        const url = req.url ?? "";

        if (
          (url === "/health" || url === "/metrics") &&
          heOpts?.auth &&
          !checkHealthAuth(req, heOpts.auth)
        ) {
          res.writeHead(401, {
            "Content-Type": "text/plain",
            "WWW-Authenticate":
              "bearer" in heOpts.auth
                ? 'Bearer realm="ocpp-ws-io"'
                : 'Basic realm="ocpp-ws-io", charset="UTF-8"',
          });
          res.end("Unauthorized");
          return;
        }

        if (url === "/health") {
          const s = this.stats();
          const body = JSON.stringify({
            status: this._state === "OPEN" ? "ok" : "degraded",
            state: this._state,
            connectedClients: s.connectedClients,
            activeSessions: s.activeSessions,
            uptimeSeconds: Math.round(s.uptimeSeconds),
            pid: s.pid,
          });
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
          });
          res.end(body);
          return;
        }

        if (url === "/metrics") {
          const s = this.stats();
          const lines = [
            "# HELP ocpp_connected_clients Number of currently connected OCPP clients",
            "# TYPE ocpp_connected_clients gauge",
            `ocpp_connected_clients ${s.connectedClients}`,
            "",
            "# HELP ocpp_active_sessions Number of active in-memory sessions",
            "# TYPE ocpp_active_sessions gauge",
            `ocpp_active_sessions ${s.activeSessions}`,
            "",
            "# HELP ocpp_uptime_seconds Process uptime in seconds",
            "# TYPE ocpp_uptime_seconds gauge",
            `ocpp_uptime_seconds ${Math.round(s.uptimeSeconds)}`,
            "",
            "# HELP ocpp_memory_rss_bytes Resident set size in bytes",
            "# TYPE ocpp_memory_rss_bytes gauge",
            `ocpp_memory_rss_bytes ${s.memoryUsage.rss}`,
            "",
            "# HELP ocpp_memory_heap_used_bytes V8 heap used in bytes",
            "# TYPE ocpp_memory_heap_used_bytes gauge",
            `ocpp_memory_heap_used_bytes ${s.memoryUsage.heapUsed}`,
            "",
            "# HELP ocpp_memory_heap_total_bytes V8 heap total in bytes",
            "# TYPE ocpp_memory_heap_total_bytes gauge",
            `ocpp_memory_heap_total_bytes ${s.memoryUsage.heapTotal}`,
            "",
            "# HELP ocpp_ws_buffered_bytes Total buffered WebSocket bytes",
            "# TYPE ocpp_ws_buffered_bytes gauge",
            `ocpp_ws_buffered_bytes ${s.webSockets?.bufferedAmount ?? 0}`,
            "",
          ];
          // Plugin: getCustomMetrics — append plugin-contributed Prometheus lines.
          //
          // Collected before the response starts. Writing the header first and
          // then awaiting meant a slow plugin left the scrape holding an open
          // connection with a 200 and no body, and there was no way back to an
          // error status once the header had gone. Prometheus scrapes on an
          // interval, so each hung scrape stacked another held connection.
          for (const plugin of this._plugins) {
            if (plugin.getCustomMetrics) {
              try {
                // The hook may be sync or async; normalise before bounding it.
                const custom = await withTimeout(
                  Promise.resolve(plugin.getCustomMetrics()),
                  METRICS_PLUGIN_TIMEOUT_MS,
                );
                if (custom?.length) {
                  lines.push("");
                  lines.push(...custom);
                }
              } catch (err) {
                // A plugin that is slow or broken costs its own metrics, not
                // the scrape — the rest of the output still goes out.
                reportPluginError(
                  this._logger,
                  plugin.name,
                  "getCustomMetrics",
                  err,
                );
              }
            }
          }

          res.writeHead(200, {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.end(lines.join("\n"));
          return;
        }

        // Only 404 unknown routes on servers we created. On a user-provided
        // server the application's own handlers must keep working (report H7).
        if (ownsServer) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
      };
      // The "request" listener ignores the returned promise, so a throw inside
      // serveHealth would otherwise be an unhandled rejection.
      requestHandler = (req, res) => {
        serveHealth(req, res).catch((err: Error) => {
          this._logger?.error?.("Health endpoint request failed", {
            error: err?.message ?? String(err),
          });
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal Server Error");
          } else {
            res.destroy();
          }
        });
      };
      httpServer.on("request", requestHandler);
    }
    this._attachedHttpHandlers.set(httpServer, {
      upgrade: upgradeHandler,
      request: requestHandler,
    });

    // Handle abort signal
    if (options?.signal) {
      const ac = new AbortController();
      this._httpServerAbortControllers.add(ac);

      options.signal.addEventListener(
        "abort",
        () => {
          ac.abort();
          // Mirror close(): detach our listeners, only close owned servers
          const handlers = this._attachedHttpHandlers.get(httpServer);
          if (handlers) {
            httpServer.removeListener("upgrade", handlers.upgrade);
            if (handlers.request) {
              httpServer.removeListener("request", handlers.request);
            }
            this._attachedHttpHandlers.delete(httpServer);
          }
          if (this._ownedHttpServers.has(httpServer)) {
            httpServer.close();
            this._ownedHttpServers.delete(httpServer);
          }
          this._httpServers.delete(httpServer);
        },
        { once: true },
      );
    }

    // Start listening if we created the server
    if (!options?.server) {
      await new Promise<void>((resolve, reject) => {
        httpServer.on("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.removeListener("error", reject);
          const addr = httpServer.address();
          this._logger?.info?.("Server listening", {
            port: typeof addr === "object" ? addr?.port : port,
            host: host ?? "0.0.0.0",
          });
          resolve();
        });
      });
    }

    return httpServer;
  }

  /**
   * Hot-reloads the TLS certificate on all active HTTPS servers without
   * dropping any existing WebSocket connections.
   *
   * **When to use:** Call this whenever your TLS certificate is renewed —
   * for example, after a Let's Encrypt auto-renewal (every ~90 days).
   * Without this, you would need to restart the Node.js process to pick up
   * the new certificate, disconnecting all connected charging stations.
   *
   * **How to use:**
   * ```ts
   * server.updateTLS({ cert: newCert, key: newKey });
   * ```
   *
   * **Optional:** Only relevant if you are terminating TLS directly in Node.js
   * (i.e. `SecurityProfile.TLS_BASIC_AUTH` or `TLS_CLIENT_CERT`). If you are
   * running behind a reverse proxy (Nginx, AWS ALB, etc.) that handles TLS,
   * you do not need this method — just rotate the cert on the proxy.
   *
   * @throws If the server is not using a TLS Security Profile.
   */
  updateTLS(tlsOpts: import("../types/index.js").TLSOptions): void {
    const profile = this._options.securityProfile ?? SecurityProfile.NONE;
    if (
      profile !== SecurityProfile.TLS_BASIC_AUTH &&
      profile !== SecurityProfile.TLS_CLIENT_CERT
    ) {
      throw new Error(
        "updateTLS() requires a TLS Security Profile (TLS_BASIC_AUTH or TLS_CLIENT_CERT)",
      );
    }

    // Persist so future listen() calls pick up the new certs
    this._options.tls = { ...this._options.tls, ...tlsOpts };

    // setSecureContext replaces the whole context, so it is built from the
    // merged options: built from the update alone, replacing just the
    // certificate dropped the CA, minVersion and ciphers set at startup.
    const httpsOptions = OCPPServer._secureContextOptions(this._options.tls);

    let updated = 0;
    for (const srv of this._httpServers) {
      if (canReloadSecureContext(srv)) {
        srv.setSecureContext(httpsOptions);
        updated++;
      }
    }

    this._logger?.info?.(
      `TLS context hot-reloaded across ${updated} active server(s)`,
    );

    // Plugin: onTLSUpdate
    for (const plugin of this._plugins) {
      try {
        guardPluginHook(
          this._logger,
          plugin.onTLSUpdate?.(tlsOpts),
          plugin.name,
          "onTLSUpdate",
        );
      } catch (err) {
        this._logger?.error?.("Plugin onTLSUpdate error", {
          name: plugin.name,
          error: (err as Error).message,
        });
      }
    }
  }

  /**
   * Build validators for the protocols this server will validate, ahead of the
   * first message that needs one.
   *
   * Validators are cached process-wide, so several servers in one process
   * share the work and this is a map lookup after the first. Does nothing
   * unless strict mode is on — with validation off these would never be read.
   */
  private _warmValidators(): void {
    const strict = this._options.strictMode;
    if (!strict) return;

    // strictMode may name a subset of protocols to validate; otherwise every
    // configured protocol is fair game. The constructor has already rejected
    // strictMode without protocols, so this is never empty.
    const protocols = Array.isArray(strict)
      ? strict
      : (this._options.protocols ?? []);

    for (const protocol of protocols) {
      try {
        if (!getStandardValidator(protocol)) {
          // Not an error: a custom subprotocol validates through
          // strictModeValidators, which the connection supplies itself.
          this._logger?.debug?.("No bundled schemas for protocol", {
            protocol,
          });
        }
      } catch (err) {
        // Warming is an optimisation. A failure here must not stop a server
        // being constructed — the lazy path will retry and report properly.
        this._logger?.warn?.("Could not prebuild validator", {
          protocol,
          error: (err as Error).message,
        });
      }
    }
  }

  // ─── Handle Upgrade ──────────────────────────────────────────

  get handleUpgrade(): (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => Promise<void> {
    return (req, socket, head) => {
      return this._handleUpgrade(req, socket, head).catch((err) => {
        if (!socket.destroyed) {
          socket.destroy();
        }
        this._logger?.error?.("Upgrade error", {
          error: (err as Error).message,
        });
        this.emit("upgradeError", { error: err, socket });
      });
    };
  }

  // ─── Upgrade Pipeline ─────────────────────────────────────────

  /**
   * Core upgrade handler. Follows a strict pipeline:
   *
   * 1. Validate socket readyState & upgrade header
   * 2. Parse URL → identity + endpoint
   * 3. Enable TCP Keep-Alive
   * 4. Parse & negotiate subprotocols
   * 5. Parse Basic Auth (via modular parseBasicAuth)
   * 6. Extract TLS client certificate (Profile 3)
   * 7. Build HandshakeInfo
   * 8. Run auth callback with AbortController + handshake timeout
   * 9. Complete WebSocket upgrade
   * 10. Create OCPPServerClient
   */
  private async _handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    // The raw socket carries no error listener until the auth block attaches
    // one, and upgrades that never reach auth never got one at all. Every
    // rejection path below writes to this socket, and a write to a peer that
    // has already gone emits 'error' — with nothing listening that is an
    // uncaught exception and the process dies. Attach first, before anything
    // can write.
    const onUpgradeSocketError = (err: Error) => {
      this._logger?.debug?.("Upgrade socket error", { error: err.message });
      if (!socket.destroyed) socket.destroy();
    };
    socket.on("error", onUpgradeSocketError);

    // Server state guard
    if (this._state !== "OPEN") {
      abortHandshake(socket, 503, "Server is shutting down");
      return;
    }

    // Before any expensive handshake work.
    if (refuseOverConnectionLimit(this._upgrade, req, socket)) return;

    // Reserve a slot for this handshake and release it on every exit path.
    this._pendingHandshakes++;
    let handshakeSlotReleased = false;
    const releaseHandshakeSlot = () => {
      if (handshakeSlotReleased) return;
      handshakeSlotReleased = true;
      this._pendingHandshakes = Math.max(0, this._pendingHandshakes - 1);
    };
    // Released by socket 'close' on every rejection path (abortHandshake now
    // destroys), or explicitly below once the connection becomes a client.
    socket.once("close", releaseHandshakeSlot);

    // Connection-level per-IP rate limit
    if (refuseOverConnectionRate(this._upgrade, req, socket)) return;

    // Socket readyState & upgrade header validation
    if ((socket as import("node:net").Socket).readyState !== "open") {
      this._logger?.debug?.("Socket not open at upgrade start");
      if (!socket.destroyed) socket.destroy();
      return;
    }

    if (req.headers.upgrade?.toLowerCase() !== "websocket") {
      abortHandshake(socket, 400, "Invalid upgrade request");
      return;
    }

    // Global CORS gate
    if (this._globalCORS) {
      const { allowed, reason } = checkCORS(req, this._globalCORS);
      if (!allowed) {
        this._logger?.warn?.("CORS rejected connection", {
          reason,
          ip: req.socket.remoteAddress,
        });
        abortHandshake(socket, 403, "Forbidden");
        return;
      }
    }

    // Parse URL & execute router
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );

    const pathname = url.pathname;
    const {
      authCallback: matchedHandler,
      middlewares: matchedMiddlewares,
      routers: matchedRouters,
      params,
      hasTerminalRoute,
      hasPatternRouters,
      config: matchedRouterConfig,
    } = matchRoute(this._routes, pathname, this._logger);

    const identity = identityFromPath(params, pathname);

    if (!identity) {
      abortHandshake(socket, 400, "Missing identity in URL path");
      return;
    }

    // Route-level CORS gate
    for (const router of matchedRouters) {
      if (router._routeCORS) {
        const { allowed, reason } = checkCORS(req, router._routeCORS);
        if (!allowed) {
          this._logger?.warn?.("Route CORS rejected connection", {
            reason,
            ip: req.socket.remoteAddress,
          });
          abortHandshake(socket, 403, "Forbidden");
          return;
        }
      }
    }

    // TCP Keep-Alive
    if ("setKeepAlive" in socket) {
      (socket as import("node:net").Socket).setKeepAlive(true);
    }

    // Parse & negotiate subprotocols
    let protocols = new Set<string>();
    const protocolHeader = req.headers["sec-websocket-protocol"];
    if (protocolHeader) {
      try {
        protocols = parseSubprotocols(protocolHeader);
      } catch {
        abortHandshake(socket, 400, "Invalid Sec-WebSocket-Protocol header");
        return;
      }
    }

    // The first version in the server's list that the charger offered. With
    // nothing in common the handshake is still completed, without a protocol,
    // and then closed (OCPP-J §3.2), after the route, credential and auth
    // checks below, so a charger refused for those still gets its HTTP status.
    // A server without a list takes the charger's first offer.
    const serverProtocols =
      matchedRouterConfig?.protocols ?? this._options.protocols ?? [];
    let selectedProtocol: string | undefined =
      serverProtocols.length > 0
        ? serverProtocols.find((p) => protocols.has(p))
        : protocols.values().next().value;
    // Set when the auth callback picks a version the charger did not offer.
    let protocolRefused = false;

    const profile = this._options.securityProfile ?? SecurityProfile.NONE;
    const handshake = buildHandshakeInfo({
      req,
      socket,
      url,
      identity,
      params,
      protocols,
      securityProfile: profile,
    });

    // Unknown-path rejection.
    //
    // This MUST be evaluated independently of whether any middleware or auth
    // callback was collected. Global middleware routers (server.use()) always
    // match but never set `hasTerminalRoute`, so gating this behind an `else`
    // on the auth branch let a single global middleware make every unmatched
    // path reachable — and an unmatched path has no route auth callback, so
    // the socket was upgraded without ever being authenticated.
    if (hasPatternRouters && !hasTerminalRoute) {
      // If specific routes were defined but user connected to an unknown path,
      // reject the connection smoothly (e.g. connected to /wrong/path)
      this._logger?.warn?.("Connection rejected: No matching route found", {
        pathname,
      });
      abortHandshake(socket, 404, "Endpoint Not Found");
      return;
    }

    const identityError = identityRefusal(
      identity,
      selectedProtocol,
      matchedRouterConfig?.strictMode ?? this._options.strictMode,
      this._options.maxIdentityLength,
    );
    if (identityError) {
      this._reportAuthFailure(handshake, req, 400, identityError);
      abortHandshake(socket, 400, identityError);
      return;
    }

    // Profiles 1 and 2 require a username and password on every connection,
    // the username being the identity (A00.FR.203/204, A00.FR.302/303), and a
    // request without them is answered 401 (Figure 2). parseBasicAuth returns
    // no password when the header is missing, malformed or for another user.
    // `requireBasicAuth: false` hands the decision to the auth callback.
    if (
      (profile === SecurityProfile.BASIC_AUTH ||
        profile === SecurityProfile.TLS_BASIC_AUTH) &&
      this._options.requireBasicAuth !== false &&
      !handshake.password?.length
    ) {
      this._reportAuthFailure(handshake, req, 401, "Unauthorized");
      abortHandshake(socket, 401, "Unauthorized", {
        "WWW-Authenticate": BASIC_AUTH_CHALLENGE,
      });
      return;
    }

    // Checking the password (profiles 1-2) or the certificate (profile 3)
    // against what the CSMS holds is the auth callback's job.
    if (
      profile !== SecurityProfile.NONE &&
      !matchedHandler &&
      !this._warnedNoAuthCallback
    ) {
      this._warnedNoAuthCallback = true;
      this._logger?.warn?.(
        "Security profile is set but no auth callback checks the credentials",
        {
          securityProfile: profile,
          reason:
            "the Basic Auth password (profile 1-2) or client certificate (profile 3) is accepted without being checked",
          fix: "register server.auth() or route().auth() and verify handshake.password or handshake.clientCertificate",
        },
      );
    }

    // Auth callback with AbortController + timeout
    let ctx: import("../types/index.js").ConnectionContext | undefined;
    let acceptOptions: import("../types/index.js").AuthAccept | undefined;

    const isKnownIdentity = this._options.isKnownIdentity;
    if (matchedHandler || matchedMiddlewares.length > 0 || isKnownIdentity) {
      const auth = await authenticate(this._upgrade, {
        req,
        socket,
        handshake,
        identity,
        pathname,
        protocols,
        selectedProtocol,
        authCallback: matchedHandler,
        middlewares: matchedMiddlewares,
        isKnownIdentity,
      });
      // Refused, failed or abandoned: the socket is answered or destroyed.
      if (!auth) return;
      ({ ctx, acceptOptions, selectedProtocol, protocolRefused } = auth);
    }

    // Keyed by the identity auth settled on, so a namespaced charger never reads
    // another tenant's entry. Skipped while the charger is still connected
    // here: its LRU entry is then the live session and newer than the store.
    const sessionIdentity =
      (acceptOptions as AuthAccept | undefined)?.identity || identity;

    // OCPP does not say what happens when a connected charger connects again.
    // "replace" (the default) evicts the old connection once this one is up;
    // "reject" keeps the old one and refuses this one.
    if (
      this._options.duplicateConnection === "reject" &&
      this._clientsByIdentity.has(sessionIdentity)
    ) {
      const message = "Charging station already connected";
      this._reportAuthFailure(handshake, req, 409, message);
      abortHandshake(socket, 409, message);
      return;
    }

    // No version both sides speak: the connection gets no protocol and is
    // closed once the handshake completes (OCPP-J §3.2).
    const refuseProtocol =
      !selectedProtocol && (serverProtocols.length > 0 || protocolRefused);

    let storedSession: PersistedSession | null = null;
    let storedSessionUnavailable = false;
    if (
      !refuseProtocol &&
      this._adapter?.getSession &&
      !this._clientsByIdentity.has(sessionIdentity)
    ) {
      try {
        storedSession = await withTimeout(
          this._adapter.getSession(sessionIdentity),
          OCPPServer._SESSION_FETCH_TIMEOUT_MS,
        );
      } catch {
        storedSessionUnavailable = true;
      }
    }

    // A route can turn strict mode on for a protocol the server has no
    // validator for. Refuse the connection (HTTP 500, logged) before the
    // handshake completes, rather than run it unvalidated in strict mode.
    if (!refuseProtocol && selectedProtocol) {
      assertStrictValidators(
        [selectedProtocol],
        matchedRouterConfig?.strictMode ?? this._options.strictMode,
        this._options.strictModeValidators,
      );
    }

    // Socket readyState check before upgrade
    if ((socket as import("node:net").Socket).readyState !== "open") {
      this._logger?.debug?.("Socket closed before upgrade completion", {
        identity,
      });
      if (!socket.destroyed) socket.destroy();
      return;
    }

    // Ensure _wss is available (should always be after constructor init)
    if (!this._wss) {
      // Reapply full transport config (maxPayload + compression) on re-init
      this._wss = createWss(this._options, this._negotiatedProtocols);
    }

    if (refuseProtocol) {
      this._logger?.warn?.("No shared subprotocol", {
        identity,
        offered: [...protocols],
        accepted: serverProtocols,
      });
      this._negotiatedProtocols.set(req, false);
      this._wss.handleUpgrade(req, socket, head, (ws) => {
        releaseHandshakeSlot();
        ws.close(1002, "No shared subprotocol");
      });
      return;
    }

    // Hand ws the protocol we negotiated so the response header matches.
    if (selectedProtocol) {
      this._negotiatedProtocols.set(req, selectedProtocol);
    }

    // Complete WebSocket upgrade & create client
    this._wss.handleUpgrade(req, socket, head, (ws) => {
      // The handshake is done; from here the connection is counted as a client.
      releaseHandshakeSlot();
      registerClient(this._registration, {
        ws,
        req,
        handshake,
        identity,
        routeConfig: matchedRouterConfig,
        routers: matchedRouters,
        ctx,
        acceptOptions,
        selectedProtocol,
        storedSession,
        storedSessionUnavailable,
      });
    });
  }

  /** Drop persist marks old enough that they no longer suppress a write. */
  private _sweepSessionPersistMarks(now: number): void {
    sweepPersistMarks(this._sessionCache, now);
  }

  /**
   * Start the session garbage collector, which also sweeps the per-IP
   * connection-rate buckets.
   *
   * Called from the constructor and again from `listen()` when a closed server
   * restarts. `close()` clears the interval so the timer cannot hold work
   * against a shut-down server, and for a long time nothing started it again:
   * a restarted server kept `_connectionBuckets` — one entry per distinct
   * client IP, and the only thing that ever removes one is the sweep below —
   * for the rest of the process's life, and stopped expiring sessions by age.
   * Idempotent, so calling it on an already-running server is a no-op.
   */
  private _startSessionGC(): void {
    if (this._gcInterval) return;
    this._gcInterval = setInterval(() => {
      const now = Date.now();
      sweepExpiredSessions(this._sessionCache, now);
      this._sweepSessionPersistMarks(now);
      this._sweepConnectionBuckets(now);
      this._sweepNodeLiveness(now);
    }, 60 * 1000).unref(); // Run every minute, don't block exit
  }

  /** Test seam: see sweepNodeLiveness in server/presence.ts. */
  private _sweepNodeLiveness(now: number): void {
    sweepNodeLiveness(this._presence, now);
  }

  /** Test seam: see sweepConnectionBuckets in server/upgrade/admission.ts. */
  private _sweepConnectionBuckets(now: number): void {
    sweepConnectionBuckets(this._upgrade, now);
  }

  // ─── Close ───────────────────────────────────────────────────

  async close(options: CloseOptions = {}): Promise<void> {
    // A second close() while the first is still draining used to return at
    // once, so `await server.close()` resolved on a server that was still
    // shutting down. That is the normal shape of a shutdown path — a SIGTERM
    // and a SIGINT handler, or a framework onClose alongside an explicit call —
    // and the caller went on to exit the process mid-drain. Join the run in
    // progress instead.
    if (this._state === "CLOSING" && this._closing) return this._closing;
    if (this._state !== "OPEN") return;

    this._closing = this._doClose(options).finally(() => {
      this._closing = null;
    });
    return this._closing;
  }

  private async _doClose(options: CloseOptions = {}): Promise<void> {
    this._state = "CLOSING";
    this.emit("closing");
    this._logger?.info?.("Server closing", {
      clientCount: this._clients.size,
    });

    // Plugin: onClosing (pre-shutdown hook — before client drain)
    for (const plugin of this._plugins) {
      try {
        await awaitShutdownHook(
          this._logger,
          this._options.pluginShutdownTimeoutMs,
          plugin.onClosing?.(),
          plugin.name,
          "onClosing",
        );
      } catch (err) {
        reportPluginError(this._logger, plugin.name, "onClosing", err);
      }
    }

    if (this._gcInterval) {
      clearInterval(this._gcInterval);
      this._gcInterval = null;
    }

    if (this._telemetryInterval) {
      clearInterval(this._telemetryInterval);
      this._telemetryInterval = null;
    }

    if (this._presenceInterval) {
      clearTimeout(this._presenceInterval);
      this._presenceInterval = null;
    }

    // ── Graceful shutdown drain ──
    // When not force-closing, wait for each client's ws.bufferedAmount to
    // reach 0 (max 5s) before closing. Prevents in-flight financial messages
    // from being lost during rolling deployments.
    if (!options.force) {
      const drainTimeout = 5000;
      const drainPromises = Array.from(this._clients).map(async (client) => {
        if (client.bufferedAmount > 0) {
          this._logger?.debug?.("Waiting for client buffer to drain", {
            identity: client.identity,
            bufferedAmount: client.bufferedAmount,
          });
          await new Promise<void>((resolve) => {
            let elapsed = 0;
            const check = setInterval(() => {
              elapsed += 50;
              if (client.bufferedAmount === 0 || elapsed >= drainTimeout) {
                clearInterval(check);
                resolve();
              }
            }, 50);
          });
        }
      });
      await Promise.allSettled(drainPromises);
    }

    // Close all clients
    const closePromises = Array.from(this._clients).map((client) =>
      client.close(options).catch(() => {}),
    );
    await Promise.allSettled(closePromises);

    // Abort all controllers
    for (const ac of this._httpServerAbortControllers) {
      ac.abort();
    }
    this._httpServerAbortControllers.clear();

    // Close WebSocket server and re-init for potential restart.
    // Re-init with full transport config (maxPayload + compression) so a
    // close()/listen() restart cycle preserves the configured behavior.
    if (this._wss) {
      this._wss.close();
      this._wss = createWss(this._options, this._negotiatedProtocols);
    }

    // Detach our listeners from every server; only close servers we own.
    const serverClosePromises: Promise<void>[] = [];
    for (const srv of this._httpServers) {
      const handlers = this._attachedHttpHandlers.get(srv);
      if (handlers) {
        srv.removeListener("upgrade", handlers.upgrade);
        if (handlers.request) srv.removeListener("request", handlers.request);
      }
      if (this._ownedHttpServers.has(srv)) {
        serverClosePromises.push(
          new Promise<void>((resolve) => {
            srv.close(() => resolve());
          }),
        );
      }
    }
    await Promise.allSettled(serverClosePromises);
    this._httpServers.clear();
    this._ownedHttpServers.clear();
    this._attachedHttpHandlers.clear();

    // Stop adaptive limiter
    if (this._adaptiveLimiter) {
      this._adaptiveLimiter.stop();
    }

    // Shut down the worker pool — its threads would otherwise keep the
    // process alive after close() (review fix). listen() re-creates it.
    if (this._workerPool) {
      await this._workerPool.shutdown().catch(() => {});
      this._workerPool = null;
    }

    // Plugin: onClose
    for (const plugin of this._plugins) {
      try {
        await awaitShutdownHook(
          this._logger,
          this._options.pluginShutdownTimeoutMs,
          plugin.onClose?.(),
          plugin.name,
          "onClose",
        );
      } catch (err) {
        reportPluginError(this._logger, plugin.name, "onClose", err);
      }
    }

    // Fail any in-flight cross-node calls
    for (const [, pending] of this._pendingRemoteCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Server closing"));
    }
    this._pendingRemoteCalls.clear();
    this._sessionLastPersisted.clear();

    // Withdraw this node's liveness entry so other nodes stop routing here at
    // once, instead of waiting out its TTL.
    if (this._adapter?.removePresence) {
      await Promise.resolve(
        this._adapter.removePresence(nodeKey(this._nodeId)),
      ).catch(() => {});
    }

    // Let per-client presence deletions and final session writes land before
    // the adapter goes away.
    if (this._pendingAdapterWrites.size > 0) {
      await Promise.race([
        Promise.allSettled([...this._pendingAdapterWrites]),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    }

    // Disconnect adapter.
    //
    // disconnect() tears down the adapter's subscriptions and, for the Redis
    // adapter, its connections. Nothing re-subscribes on a later listen(), so
    // leaving `_adapter` set made a close()/listen() restart look clustered
    // while cross-node RPC was silently dead: sendToClient still took the
    // remote branch, published into a disconnected adapter, and waited out the
    // full timeout. Detaching makes the state honest — the server behaves as a
    // single node until setAdapter() is called again, which listen() warns
    // about below.
    if (this._adapter) {
      await this._adapter.disconnect();
      this._adapter = null;
      this._adapterDetachedByClose = true;
    }

    this._state = "CLOSED";
    this.emit("close");
  }

  // ─── Reconfigure ─────────────────────────────────────────────

  reconfigure(options: Partial<ServerOptions<P>>): void {
    assertMaxIdentityLength(options.maxIdentityLength);
    // Checked on the combined options before any is applied.
    const next = { ...this._options, ...options };
    assertUniqueProtocols(next.protocols);
    assertStrictValidators(
      next.protocols,
      next.strictMode,
      next.strictModeValidators,
    );
    const oldOptions = { ...this._options } as ServerOptions<P>;
    Object.assign(this._options, options);

    if (
      options.respondWithDetailedErrors &&
      !oldOptions.respondWithDetailedErrors
    ) {
      this._warnDetailedErrors();
    }
    if (options.wssOptions !== undefined)
      warnIgnoredWssOptions(this._options.wssOptions, this._logger);

    // Transport-level settings only apply to a fresh WebSocketServer —
    // rebuild so new connections pick them up (existing sockets keep theirs).
    if (
      options.maxPayloadBytes !== undefined ||
      options.compression !== undefined ||
      options.wssOptions !== undefined
    ) {
      this._wss?.close();
      this._wss = createWss(this._options, this._negotiatedProtocols);
    }

    // Toggle the adaptive limiter to match the new rateLimit config
    if (options.rateLimit !== undefined) {
      const wantAdaptive = !!options.rateLimit?.adaptive;
      if (wantAdaptive && !this._adaptiveLimiter) {
        const rl = options.rateLimit;
        this._adaptiveLimiter = new AdaptiveLimiter({
          cpuThresholdPercent: rl.cpuThresholdPercent,
          memThresholdPercent: rl.memThresholdPercent,
          cooldownMs: rl.cooldownMs,
          // Was omitted here while the constructor passed it, so enabling
          // adaptive limiting at runtime silently reverted to the 2s default.
          sampleIntervalMs: rl.sampleIntervalMs,
        });
        this._adaptiveLimiter.on(
          "adapted",
          (event: {
            multiplier: number;
            cpuPercent: number;
            memPercent: number;
          }) => {
            this._logger?.info?.("Adaptive rate limit adjusted", event);
            this.emit("rateLimit:adapted", event);
          },
        );
        this._adaptiveLimiter.start();
      } else if (!wantAdaptive && this._adaptiveLimiter) {
        this._adaptiveLimiter.stop();
        this._adaptiveLimiter = null;
      }
    }

    // Apply HTTP timeout changes to owned servers immediately
    if (
      options.headersTimeout !== undefined ||
      options.requestTimeout !== undefined
    ) {
      for (const srv of this._ownedHttpServers) {
        if (options.headersTimeout !== undefined) {
          srv.headersTimeout =
            options.headersTimeout > 0 ? options.headersTimeout : 0;
        }
        if (options.requestTimeout !== undefined) {
          srv.requestTimeout =
            options.requestTimeout > 0 ? options.requestTimeout : 0;
        }
      }
    }

    // Restart the presence heartbeat with the new TTL
    if (options.presenceTtlSeconds !== undefined && this._presenceInterval) {
      clearTimeout(this._presenceInterval);
      this._presenceInterval = null;
      startPresenceRefresh(this._presence);
    }

    // Plugin: onReconfigure
    for (const plugin of this._plugins) {
      try {
        guardPluginHook(
          this._logger,
          plugin.onReconfigure?.(options, oldOptions),
          plugin.name,
          "onReconfigure",
        );
      } catch (err) {
        this._logger?.error?.("Plugin onReconfigure error", {
          name: plugin.name,
          error: (err as Error).message,
        });
      }
    }
  }

  // ─── Pub/Sub Adapter ─────────────────────────────────────────

  /**
   * Send a request to a specific client (local or remote).
   *
   * 1. Local clients are called directly.
   * 2. Otherwise the presence registry routes the call to the owning node,
   *    and the response is correlated back over the adapter (cross-node RPC).
   * 3. Unknown identity → rejects with "Client <identity> not found".
   *
   * Backward compatibility: nodes running older versions deliver the call
   * but never publish a response — such calls reject with TimeoutError.
   */
  // Params are checked for keys the schema does not define on the action
  // name, as on the clients. Order: the method-only form without options
  // first, then the version-named form, then options, so editors suggest the
  // right fields while a call is being written.
  async sendToClient<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    identity: string,
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
  ): Promise<OCPPResponseType<KnownProtocol<P>, M> | undefined>;

  async sendToClient<
    V extends KnownProtocol<P>,
    M extends AllMethodNames<V>,
    T extends RequestOf<V, M>,
  >(
    identity: string,
    version: V,
    method: CheckedAction<M, RequestOf<V, M>, T>,
    params: T,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M> | undefined>;

  async sendToClient<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    identity: string,
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
    options: CallOptions,
  ): Promise<OCPPResponseType<KnownProtocol<P>, M> | undefined>;

  /** Send an action the types do not check — `sendToClient(id, unchecked("VendorPing"), params)`. */
  async sendToClient<TResult = JsonObject>(
    identity: string,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult | undefined>;

  /** Send an action the types do not check on one of the server's protocols. */
  async sendToClient<TResult = JsonObject>(
    identity: string,
    version: P,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult | undefined>;

  async sendToClient(...args: SendToClientArgs): Promise<unknown> {
    return await routeCall(this._messaging, args);
  }

  // ─── Safe SendToClient (Best Effort) ──────────────────────────

  // Same overloads as sendToClient; see there.
  async safeSendToClient<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    identity: string,
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
  ): Promise<OCPPResponseType<KnownProtocol<P>, M> | undefined>;

  async safeSendToClient<
    V extends KnownProtocol<P>,
    M extends AllMethodNames<V>,
    T extends RequestOf<V, M>,
  >(
    identity: string,
    version: V,
    method: CheckedAction<M, RequestOf<V, M>, T>,
    params: T,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M> | undefined>;

  async safeSendToClient<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    identity: string,
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
    options: CallOptions,
  ): Promise<OCPPResponseType<KnownProtocol<P>, M> | undefined>;

  async safeSendToClient<TResult = JsonObject>(
    identity: string,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult | undefined>;

  async safeSendToClient<TResult = JsonObject>(
    identity: string,
    version: P,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult | undefined>;

  async safeSendToClient(...args: SendToClientArgs): Promise<unknown> {
    return await safeRouteCall(this._messaging, args);
  }
  // ─── Batch Calls ──────────────────────────────────────────────

  /**
   * Pipeline multiple calls to a single client into a concurrent batch.
   * Useful for reconnection warm-up (e.g. GetConfiguration, ChangeAvailability, etc.)
   * where sequential calls would add unnecessary round-trip latency.
   *
   * The calls do not wait for each other's answers, which OCPP-J §4.1.1
   * (Synchronicity) does not allow: use it only for chargers known to cope,
   * as with callConcurrency above 1.
   *
   * @param identity The client identity to send calls to
   * @param calls Array of { method, params, options? } to execute concurrently
   * @returns Array of results in the same order as the calls array.
   *          Each element is the call result, or `undefined` if that individual call failed.
   *
   * @example
   * ```ts
   * const results = await server.sendBatch('CP-101', [
   *   { method: 'GetConfiguration', params: { key: ['MeterInterval'] } },
   *   { method: 'ChangeAvailability', params: { type: 'Operative' } },
   *   { method: 'TriggerMessage', params: { requestedMessage: 'StatusNotification' } },
   * ]);
   * ```
   */
  async sendBatch<C extends BatchCall<KnownProtocol<P>>>(
    identity: string & BatchExactKeys<KnownProtocol<P>, C>,
    calls: readonly C[],
  ): Promise<Array<BatchResult<KnownProtocol<P>, C> | undefined>>;

  async sendBatch(
    identity: string,
    calls: readonly BatchCall<KnownProtocol<P>>[],
  ): Promise<Array<unknown | undefined>> {
    return await sendBatchToClient(this._messaging, identity, calls);
  }

  // ─── Pub/Sub Adapter ─────────────────────────────────────────

  async setAdapter(adapter: EventAdapterInterface): Promise<void> {
    // Detach the previous adapter first. Overwriting the field left the old
    // adapter's subscriptions live: its handlers kept firing _onBroadcast and
    // _onUnicast on this server, so a message arriving on both was processed
    // twice, and its connections were never released. The old adapter is NOT
    // disconnected — the caller owns it and may still be using it — but it
    // stops driving this server.
    const previous = this._adapter;
    if (previous && previous !== adapter) {
      stopPresenceRefresh(this._presence);
      try {
        await previous.unsubscribe("ocpp:broadcast");
        await previous.unsubscribe(`ocpp:node:${this._nodeId}`);
      } catch (err) {
        this._logger?.warn?.("Failed to unsubscribe the previous adapter", {
          error: (err as Error).message,
        });
      }
      this._logger?.info?.(
        "Replaced the event adapter — the previous one is detached but not disconnected; disconnect it yourself if you are done with it",
      );
    }

    this._adapter = adapter;
    this._adapterDetachedByClose = false;

    // The presence methods are optional on the interface, but without
    // getPresence there is no way to discover which node owns an identity, so
    // sendToClient can only ever reach clients on this node — it falls through
    // to "Client not found" for everyone else. That is a silent loss of the
    // headline clustering feature, so say it out loud at wire-up time.
    if (!adapter.getPresence && !adapter.getPresenceBatch) {
      this._logger?.warn?.(
        "Adapter has neither getPresence() nor getPresenceBatch() — cross-node routing is disabled; sendToClient will only reach clients on this node",
      );
    } else if (!adapter.setPresence) {
      this._logger?.warn?.(
        "Adapter has getPresence() but no setPresence() — this node never publishes its own clients, so other nodes cannot route to them",
      );
    }

    // 1. Subscribe to Broadcast
    await this._adapter.subscribe("ocpp:broadcast", (msg: unknown) =>
      handleBroadcastMessage(this._messaging, msg),
    );

    // 2. Subscribe to Unicast (My Node)
    await this._adapter.subscribe(
      `ocpp:node:${this._nodeId}`,
      (msg: unknown) => {
        this._onUnicast(msg);
      },
    );

    // Publish presence for clients that connected before the adapter existed.
    // The heartbeat would eventually pick them up, but not for a third of the
    // TTL — around 100s at the default — during which every one of them is
    // invisible to the rest of the cluster. "Start single-node, attach Redis
    // once it is reachable" is a normal startup shape.
    // Runs unconditionally: besides any existing clients, this is what
    // publishes THIS node's liveness entry. Gating it on having clients left a
    // node invisible to its peers until the first heartbeat tick — a third of
    // the TTL, ~100s at the default — during which every peer would have
    // considered it dead.
    {
      const ttlSec = this._options.presenceTtlSeconds ?? 300;
      try {
        await this._refreshPresence(ttlSec);
        if (this._clientsByIdentity.size > 0) {
          this._logger?.debug?.("Published presence for existing clients", {
            count: this._clientsByIdentity.size,
          });
        }
      } catch (err) {
        this._logger?.warn?.("Initial presence publish failed", {
          error: (err as Error).message,
        });
      }
    }

    // Presence heartbeat — refresh TTLs so long-lived connections never
    // expire out of the cluster registry (report C3).
    startPresenceRefresh(this._presence);
  }

  /** The server's presence fields, read and written through getters. */
  private _createPresenceContext(): PresenceContext {
    const server = this;
    return {
      get nodeId() {
        return server._nodeId;
      },
      get adapter() {
        return server._adapter;
      },
      get logger() {
        return server._logger;
      },
      get nodeLiveness() {
        return server._nodeLiveness;
      },
      get nodeLivenessSeen() {
        return server._nodeLivenessSeen;
      },
      get pendingWrites() {
        return server._pendingAdapterWrites;
      },
      get presenceTtlSeconds() {
        return server._options.presenceTtlSeconds;
      },
      get isOpen() {
        return server._state === "OPEN";
      },
      get presenceInterval() {
        return server._presenceInterval;
      },
      set presenceInterval(timer) {
        server._presenceInterval = timer;
      },
      get refreshInFlight() {
        return server._presenceRefreshInFlight;
      },
      set refreshInFlight(running) {
        server._presenceRefreshInFlight = running;
      },
      localIdentities: () => Array.from(server._clientsByIdentity.keys()),
    };
  }

  // Test seams: the presence logic lives in server/presence.ts.
  private _isNodeAlive(nodeId: string): Promise<boolean> {
    return isNodeAlive(this._presence, nodeId);
  }

  private _refreshPresence(ttlSec: number): Promise<void> {
    return refreshPresence(this._presence, ttlSec);
  }

  /** The server's routing fields, read through getters. */
  private _createMessagingContext(): MessagingContext<P> {
    const server = this;
    return {
      get presence() {
        return server._presence;
      },
      get nodeId() {
        return server._nodeId;
      },
      get adapter() {
        return server._adapter;
      },
      get logger() {
        return server._logger;
      },
      get clients() {
        return server._clients;
      },
      get clientsByIdentity() {
        return server._clientsByIdentity;
      },
      get pendingRemoteCalls() {
        return server._pendingRemoteCalls;
      },
      get callTimeoutMs() {
        return server._options.callTimeoutMs;
      },
      get remoteCallGraceMs() {
        return server._options.remoteCallGraceMs;
      },
      isNodeAlive: (nodeId) => server._isNodeAlive(nodeId),
    };
  }

  /** Test seam: see handleUnicastMessage in server/messaging.ts. */
  private _onUnicast(msg: unknown): void {
    handleUnicastMessage(this._messaging, msg);
  }

  async publish(channel: string, data: unknown): Promise<void> {
    if (this._adapter) {
      await this._adapter.publish(channel, data);
    }
  }

  async broadcast<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
  ): Promise<import("../types/index.js").BroadcastResult>;

  /** Broadcast an action the types do not check — `broadcast(unchecked("VendorPing"), params)`. */
  async broadcast(
    method: UncheckedAction,
    params?: object,
  ): Promise<import("../types/index.js").BroadcastResult>;

  async broadcast(
    method: string,
    params?: object,
  ): Promise<import("../types/index.js").BroadcastResult> {
    return await broadcastToAll(this._messaging, method, params);
  }

  /**
   * Send a specific method & params to a list of specific clients efficiently.
   * This leverages adapter pipelining (e.g. Redis .pipeline()) to minimize network overhead
   * when communicating with thousands of nodes simultaneously.
   *
   * @param identities Array of target client identities
   * @param method The OCPP method to send
   * @param params The request parameters
   * @param options Call options
   */
  async broadcastBatch<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    identities: string[],
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
    options?: CallOptions,
  ): Promise<void>;

  /** broadcastBatch for an action the types do not check. */
  async broadcastBatch(
    identities: string[],
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<void>;

  async broadcastBatch(
    identities: string[],
    method: string,
    params?: object,
    options?: CallOptions,
  ): Promise<void> {
    await broadcastToIdentities(
      this._messaging,
      identities,
      method,
      params,
      options,
    );
  }
}
