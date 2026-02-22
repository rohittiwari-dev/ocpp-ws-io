import { EventEmitter } from "node:events";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import { createId } from "@paralleldrive/cuid2";
import { WebSocketServer } from "ws";
import { checkCORS } from "./cors.js";
import { initLogger } from "./init-logger.js";
import { executeMiddlewareChain, OCPPRouter } from "./router.js";
import { OCPPServerClient } from "./server-client.js";

import {
  type AllMethodNames,
  type AuthAccept,
  type AuthCallback,
  type CallOptions,
  type ClientOptions,
  type CloseOptions,
  type CORSOptions,
  type ConnectionMiddleware,
  type EventAdapterInterface,
  type HandshakeInfo,
  type ListenOptions,
  type LoggerLike,
  type LoggerLikeNotOptional,
  type OCPPProtocol,
  type OCPPRequestType,
  type OCPPResponseType,
  SecurityProfile,
  type ServerEvents,
  type ServerOptions,
  type TypedEventEmitter,
} from "./types.js";
import { NOOP_LOGGER } from "./util.js";
import {
  abortHandshake,
  parseBasicAuth,
  parseSubprotocols,
} from "./ws-util.js";

/**
 * OCPPServer — A typed WebSocket RPC server for OCPP communication.
 *
 * Supports all 3 OCPP Security Profiles:
 * - Profile 1: Basic Auth over unsecured WS
 * - Profile 2: TLS + Basic Auth (HTTPS server)
 * - Profile 3: Mutual TLS (HTTPS server with requestCert)
 */
export class OCPPServer extends (EventEmitter as new () => TypedEventEmitter<ServerEvents>) {
  private _options: ServerOptions;
  private _routers: OCPPRouter[] = [];
  private _clients = new Set<OCPPServerClient>();
  private _clientsByIdentity = new Map<string, OCPPServerClient>();
  private _httpServers = new Set<Server>();
  private _wss: WebSocketServer | null = null;
  private _state: "OPEN" | "CLOSING" | "CLOSED" = "OPEN";
  private _adapter: EventAdapterInterface | null = null;
  private _httpServerAbortControllers = new Set<AbortController>();
  private _logger: LoggerLike | null = null;
  private _globalCORS?: CORSOptions;

  // Robustness & Clustering
  private readonly _nodeId = createId();
  private _sessions = new Map<
    string,
    { data: Record<string, any>; lastActive: number }
  >();
  private _gcInterval: NodeJS.Timeout | null = null;
  private readonly _sessionTimeoutMs: number;

  constructor(options: ServerOptions = {}) {
    super();

    if (options.strictMode) {
      if (!options.strictModeValidators && !options.protocols?.length) {
        throw new Error(
          "strictMode requires either strictModeValidators or protocols to be specified"
        );
      }
    }

    this._options = {
      securityProfile: SecurityProfile.NONE,
      callTimeoutMs: 30000,
      pingIntervalMs: 30000,
      deferPingsOnActivity: false,
      callConcurrency: 1,
      maxBadMessages: Infinity,
      respondWithDetailedErrors: false,
      handshakeTimeoutMs: 30000,
      sessionTtlMs: 2 * 60 * 60 * 1000,
      ...options,
    };

    this._sessionTimeoutMs = this._options.sessionTtlMs!;

    // Initialize WebSocketServer immediately (ws best practice: noServer mode)
    this._wss = new WebSocketServer({ noServer: true });

    // Start Session Garbage Collector
    this._gcInterval = setInterval(() => {
      const now = Date.now();
      for (const [identity, session] of this._sessions.entries()) {
        if (now - session.lastActive > this._sessionTimeoutMs) {
          this._sessions.delete(identity);
        }
      }
    }, 60 * 1000).unref(); // Run every minute, don't block exit

    // Initialize logger
    this._logger = initLogger(this._options.logging, {
      component: "OCPPServer",
    });
  }

  // ─── Getters ─────────────────────────────────────────────────
  get log() {
    return (this._logger || NOOP_LOGGER) as LoggerLikeNotOptional;
  }
  get clients(): ReadonlySet<OCPPServerClient> {
    return this._clients;
  }

  get state(): "OPEN" | "CLOSING" | "CLOSED" {
    return this._state;
  }

  /**
   * Returns current node observability statistics
   * (e.g. connected socket count, tracked memory sessions, and process CPU/Memory usage).
   * Fully compatible with Loki/Prometheus node metric ingestion.
   */
  stats(): import("./types.js").OCPPServerStats {
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
    if (!this._adapter || !this._adapter.metrics) return null;
    try {
      return await this._adapter.metrics();
    } catch (err) {
      this._logger?.warn?.("Failed to fetch adapter metrics", { error: err });
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
  getLocalClient(identity: string): OCPPServerClient | undefined {
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

    if (this._adapter?.getPresence) {
      const nodeId = await this._adapter.getPresence(identity);
      return nodeId !== null && nodeId !== undefined;
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
  route(...patterns: Array<string | RegExp>): OCPPRouter {
    const router = new OCPPRouter();
    router.route(...patterns);
    this._routers.push(router);
    return router;
  }

  /**
   * Attaches one or more standalone modular routers created via `createRouter()`.
   * This is useful for separating route definitions across different files.
   */
  attachRouters(...routers: OCPPRouter[]): this {
    this._routers.push(...routers);
    return this;
  }

  /**
   * Registers a new middleware chain, acting as a wildcard/catch-all router if no patterns are added.
   * `server.use(middleware).route("/api").on("client", ...)`
   */
  use(...middlewares: ConnectionMiddleware[]): OCPPRouter {
    const router = new OCPPRouter();
    router.use(...middlewares);
    this._routers.push(router);
    return router;
  }

  /**
   * Registers a top-level auth handler, returning a router to attach `.on()` or `.use()`.
   */
  auth<TSession = Record<string, unknown>>(
    callback: AuthCallback<TSession>
  ): OCPPRouter {
    const router = new OCPPRouter();
    router.auth(callback);
    this._routers.push(router);
    return router;
  }

  // ─── Listen ──────────────────────────────────────────────────

  async listen(
    port = 0,
    host?: string,
    options?: ListenOptions
  ): Promise<Server> {
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
        const httpsOptions: Record<string, unknown> = {};

        if (tlsOpts.cert) httpsOptions.cert = tlsOpts.cert;
        if (tlsOpts.key) httpsOptions.key = tlsOpts.key;
        if (tlsOpts.ca) httpsOptions.ca = tlsOpts.ca;
        if (tlsOpts.passphrase) httpsOptions.passphrase = tlsOpts.passphrase;

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
    }

    // Handle upgrade requests
    const upgradeHandler = (
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer
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

    // Handle abort signal
    if (options?.signal) {
      const ac = new AbortController();
      this._httpServerAbortControllers.add(ac);

      options.signal.addEventListener(
        "abort",
        () => {
          ac.abort();
          httpServer.close();
          this._httpServers.delete(httpServer);
        },
        { once: true }
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

  // ─── Handle Upgrade ──────────────────────────────────────────

  get handleUpgrade(): (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer
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
    head: Buffer
  ): Promise<void> {
    // ── Step 0: Server state guard ──
    if (this._state !== "OPEN") {
      abortHandshake(socket, 503, "Server is shutting down");
      return;
    }

    // ── Step 1: Socket readyState & upgrade header validation ──
    if ((socket as import("node:net").Socket).readyState !== "open") {
      this._logger?.debug?.("Socket not open at upgrade start");
      if (!socket.destroyed) socket.destroy();
      return;
    }

    if (req.headers.upgrade?.toLowerCase() !== "websocket") {
      abortHandshake(socket, 400, "Invalid upgrade request");
      return;
    }

    // ── Step 1.5: Global CORS gate ──
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

    // ── Step 2: Parse URL & Execute Router ──
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`
    );

    let matchedHandler: AuthCallback | undefined;
    const matchedMiddlewares: ConnectionMiddleware[] = [];
    const matchedRouters: OCPPRouter[] = [];
    const params: Record<string, string> = {};
    const pathname = url.pathname;

    let hasTerminalRoute = false;
    let hasPatternRouters = false;
    let matchedRouterConfig: import("./types.js").RouterConfig | undefined;

    // 1. Additive Matching: Collect ALL middlewares from ALL matching routers
    for (const router of this._routers) {
      let matched = false;
      if (router.compiledPatterns.length === 0) {
        // Global middleware (server.use) matches everything
        matched = true;
      } else {
        hasPatternRouters = true;
        for (const compiled of router.compiledPatterns) {
          const match = compiled.regex.exec(pathname);
          if (match) {
            matched = true;
            if (compiled.paramNames.length > 0) {
              compiled.paramNames.forEach((name, i) => {
                params[name] = decodeURIComponent(match[i + 1] ?? "");
              });
            } else if (match.groups) {
              for (const [key, val] of Object.entries(match.groups)) {
                params[key] = decodeURIComponent(val ?? "");
              }
            }
            break; // Stop checking patterns within this single router
          }
        }
      }

      if (matched) {
        matchedRouters.push(router);
        if (router.compiledPatterns.length > 0) {
          hasTerminalRoute = true;
          // Use the config of the most specific router
          if (router._routeConfig) {
            matchedRouterConfig = Object.assign(
              matchedRouterConfig || {},
              router._routeConfig
            );
          }
        }
        // Accumulate middlewares
        if (router.middlewares.length > 0) {
          matchedMiddlewares.push(...router.middlewares);
        }
        // First matched explicit handler wins (respects route registration order)
        if (router.authCallback && !matchedHandler) {
          matchedHandler = router.authCallback as AuthCallback | undefined;
        }
      }
    }

    // Determine the identity:
    // 1. If it was successfully matched as a param, use it.
    // 2. Otherwise extract it from the end of the pathname (legacy behavior).
    let identity = params.identity;
    if (!identity) {
      const pathParts = pathname.split("/").filter(Boolean);
      identity = decodeURIComponent(pathParts[pathParts.length - 1] ?? "");
    }

    if (!identity) {
      abortHandshake(socket, 400, "Missing identity in URL path");
      return;
    }

    // ── Step 2.5: Route-level CORS gate ──
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

    // ── Step 3: TCP Keep-Alive ──
    if ("setKeepAlive" in socket) {
      (socket as import("node:net").Socket).setKeepAlive(true);
    }

    // ── Step 4: Parse & negotiate subprotocols ──
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

    const serverProtocols =
      matchedRouterConfig?.protocols ?? this._options.protocols ?? [];
    let selectedProtocol: string | undefined;

    if (serverProtocols.length > 0) {
      if (protocols.size === 0) {
        abortHandshake(socket, 400, "Missing subprotocol");
        return;
      }
      selectedProtocol = serverProtocols.find((p) => protocols.has(p));
      if (!selectedProtocol) {
        abortHandshake(socket, 400, "No matching subprotocol");
        return;
      }
    }

    // ── Step 5: Parse Basic Auth (modular) ──
    const password = parseBasicAuth(req.headers.authorization ?? "", identity);

    // ── Step 6: Client certificate (Profile 3 — mTLS) ──
    let clientCertificate:
      | ReturnType<TLSSocket["getPeerCertificate"]>
      | undefined;
    const profile = this._options.securityProfile ?? SecurityProfile.NONE;
    if (
      profile === SecurityProfile.TLS_CLIENT_CERT &&
      "getPeerCertificate" in socket
    ) {
      clientCertificate = (socket as TLSSocket).getPeerCertificate();
    }

    // ── Step 7: Build HandshakeInfo ──
    const handshake: HandshakeInfo = {
      identity,
      remoteAddress: req.socket.remoteAddress ?? "",
      headers: req.headers as Record<string, string | string[] | undefined>,
      protocols,
      pathname,
      params,
      query: url.searchParams,
      request: req,
      password,
      clientCertificate,
      securityProfile: profile,
    };

    // ── Step 8: Auth callback with AbortController + timeout ──
    let ctx: import("./types.js").ConnectionContext | undefined;
    let acceptOptions: import("./types.js").AuthAccept | undefined;

    if (matchedHandler || matchedMiddlewares.length > 0) {
      const ac = new AbortController();

      // Socket lifecycle → abort on premature close / error
      const onSocketGone = () => {
        ac.abort(new Error("Socket closed during handshake"));
      };
      socket.on("close", onSocketGone);
      socket.on("error", onSocketGone);
      socket.on("end", onSocketGone);

      // Handshake timeout guard
      const timeoutMs = this._options.handshakeTimeoutMs ?? 30_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          ac.abort(new Error("Handshake timeout"));
        }, timeoutMs);
      }

      try {
        ctx = {
          handshake,
          state: {},
          reject: (code = 401, message = "Unauthorized") => {
            throw { code, message, _isMiddlewareReject: true };
          },
          next: async (_payload?: Record<string, unknown>) => {}, // Bound dynamically inside executeMiddlewareChain
        };

        const chain = [...matchedMiddlewares];
        let authCalled = false;

        // Push the Auth check as the terminal handler of the middleware chain
        chain.push(async (c) => {
          authCalled = true;
          if (!matchedHandler) {
            // Default auth pass-through if no explicit auth callback was matched
            selectedProtocol =
              handshake.protocols.values().next().value ?? undefined;
          } else {
            acceptOptions = await new Promise<AuthAccept | undefined>(
              (resolve, reject) => {
                let settled = false;

                const accept = (opts?: AuthAccept) => {
                  if (settled) return;
                  settled = true;
                  if (opts?.protocol) selectedProtocol = opts.protocol;
                  resolve(opts);
                };

                const rejectAuth = (
                  code = 401,
                  message = "Unauthorized"
                ): never => {
                  if (!settled) {
                    settled = true;
                    reject({ code, message });
                  }
                  throw { code, message, _isMiddlewareReject: true };
                };

                // Guard: already aborted before we even start
                if (ac.signal.aborted) {
                  reject(ac.signal.reason);
                  return;
                }

                ac.signal.addEventListener(
                  "abort",
                  () => {
                    if (!settled) {
                      settled = true;
                      reject(ac.signal.reason);
                    }
                  },
                  { once: true }
                );

                this._logger?.debug?.("Executing auth callback", {
                  identity,
                  pathname,
                });

                const authCtx: import("./types.js").AuthContext = {
                  handshake,
                  state: c.state,
                  reject: rejectAuth,
                  signal: ac.signal,
                  accept,
                };

                matchedHandler!(authCtx);
              }
            );
          }
        });

        // Execute dynamic middleware pipeline
        await executeMiddlewareChain(chain, ctx);

        if (!authCalled) {
          // A middleware halted the chain without calling next() or reject()
          throw {
            code: 500,
            message: "Middleware chain halted unexpectedly without rejecting",
            _isMiddlewareReject: true,
          };
        }
      } catch (err) {
        if (ac.signal.aborted) {
          const reason = err instanceof Error ? err.message : "Unknown abort";
          this._logger?.warn?.("Handshake aborted", { identity, reason });
          this.emit("upgradeAborted", {
            identity,
            reason,
            socket,
            request: req,
          });
          if (!socket.destroyed) socket.destroy();
          return;
        }

        // Auth explicitly rejected
        const errObj = err as any;
        const code = typeof errObj?.code === "number" ? errObj.code : 401;
        const message =
          typeof errObj?.message === "string" ? errObj.message : "Unauthorized";

        this._logger?.warn?.("Auth rejected", { identity, code });
        abortHandshake(socket, code, message);
        return;
      } finally {
        if (timer) clearTimeout(timer);
        socket.removeListener("close", onSocketGone);
        socket.removeListener("error", onSocketGone);
        socket.removeListener("end", onSocketGone);
      }
    } else if (hasPatternRouters && !hasTerminalRoute) {
      // If specific routes were defined but user connected to an unknown path,
      // reject the connection smoothly (e.g. connected to /wrong/path)
      this._logger?.warn?.("Connection rejected: No matching route found", {
        pathname,
      });
      abortHandshake(socket, 404, "Endpoint Not Found");
      return;
    }

    // ── Step 9: Socket readyState check before upgrade ──
    if ((socket as import("node:net").Socket).readyState !== "open") {
      this._logger?.debug?.("Socket closed before upgrade completion", {
        identity,
      });
      if (!socket.destroyed) socket.destroy();
      return;
    }

    // Ensure _wss is available (should always be after constructor init)
    if (!this._wss) {
      this._wss = new WebSocketServer({ noServer: true });
    }

    // ── Step 10: Complete WebSocket upgrade & create client ──
    this._wss.handleUpgrade(req, socket, head, (ws) => {
      const clientOptions: ClientOptions = {
        identity,
        endpoint: "",
        callTimeoutMs:
          matchedRouterConfig?.callTimeoutMs ?? this._options.callTimeoutMs,
        pingIntervalMs:
          matchedRouterConfig?.pingIntervalMs ?? this._options.pingIntervalMs,
        deferPingsOnActivity:
          matchedRouterConfig?.deferPingsOnActivity ??
          this._options.deferPingsOnActivity,
        callConcurrency:
          matchedRouterConfig?.callConcurrency ?? this._options.callConcurrency,
        maxBadMessages: this._options.maxBadMessages,
        respondWithDetailedErrors: this._options.respondWithDetailedErrors,
        strictMode: matchedRouterConfig?.strictMode ?? this._options.strictMode,
        strictModeMethods:
          matchedRouterConfig?.strictModeMethods ??
          this._options.strictModeMethods,
        strictModeValidators: this._options.strictModeValidators,
        rateLimit: matchedRouterConfig?.rateLimit ?? this._options.rateLimit,
        reconnect: false,
        logging: this._options.logging,
      };

      const finalSession = {
        ...(ctx?.state || {}),
        ...(this._sessions.get(identity)?.data || {}),
        ...(((acceptOptions as any)?.session as Record<string, unknown>) || {}),
      };

      const client = new OCPPServerClient(clientOptions, {
        ws,
        handshake,
        session: finalSession,
        protocol: selectedProtocol,
      });

      this._updateSessionActivity(identity, client.session);
      this._clients.add(client);
      this._clientsByIdentity.set(identity, client);

      // Register presence
      if (this._adapter?.setPresence) {
        // TTL: slightly longer than session timeout or heartbeat interval
        // For now, use 60s as a default active TTL, refreshed on activity?
        // Actually, we should set it with a reasonable TTL (e.g. 5 mins)
        // and ideally refresh it. For Phase 1, we set it once.
        // Let's use 5 minutes (300s).
        this._adapter.setPresence(identity, this._nodeId, 300).catch((err) => {
          this._logger?.error?.("Error setting presence", {
            identity,
            error: err,
          });
        });
      }

      this._logger?.info?.("Client connected", {
        identity,
        remoteAddress: req.socket.remoteAddress,
        protocol: selectedProtocol,
      });

      client.on("close", () => {
        this._clients.delete(client);
        if (this._clientsByIdentity.get(identity) === client) {
          this._clientsByIdentity.delete(identity);
        }
        // Remove presence
        if (this?._adapter?.removePresence) {
          this._adapter.removePresence(identity).catch((err) => {
            this._logger?.error?.("Error removing presence", {
              identity,
              error: err,
            });
          });
        }
        this._logger?.info?.("Client disconnected", { identity });
      });

      // Dispatch route-specific "client" events
      this.emit("client", client);
      for (const router of matchedRouters) {
        router.emit("client", client);
      }

      client.on("message", () => {
        this._updateSessionActivity(identity, client.session);
      });
    });
  }

  private _updateSessionActivity(
    identity: string,
    data: Record<string, unknown>
  ) {
    this._sessions.set(identity, {
      data,
      lastActive: Date.now(),
    });
  }

  // ─── Close ───────────────────────────────────────────────────

  async close(options: CloseOptions = {}): Promise<void> {
    if (this._state !== "OPEN") return;

    this._state = "CLOSING";
    this.emit("closing");
    this._logger?.info?.("Server closing", { clientCount: this._clients.size });

    if (this._gcInterval) {
      clearInterval(this._gcInterval);
      this._gcInterval = null;
    }

    // Close all clients gracefully
    const closePromises = Array.from(this._clients).map((client) =>
      client.close(options).catch(() => {})
    );
    await Promise.allSettled(closePromises);

    // Abort all controllers
    for (const ac of this._httpServerAbortControllers) {
      ac.abort();
    }
    this._httpServerAbortControllers.clear();

    // Close WebSocket server and re-init for potential restart
    if (this._wss) {
      this._wss.close();
      this._wss = new WebSocketServer({ noServer: true });
    }

    // Close all HTTP servers
    const serverClosePromises = Array.from(this._httpServers).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    );
    await Promise.allSettled(serverClosePromises);
    this._httpServers.clear();

    // Disconnect adapter
    if (this._adapter) {
      await this._adapter.disconnect();
    }

    this._state = "CLOSED";
    this.emit("close");
  }

  // ─── Reconfigure ─────────────────────────────────────────────

  reconfigure(options: Partial<ServerOptions>): void {
    Object.assign(this._options, options);
  }

  // ─── Pub/Sub Adapter ─────────────────────────────────────────

  /**
   * Send a request to a specific client (local or remote).
   *
   * 1. Checks local clients.
   * 2. Checks Presence Registry -> Unicast.
   * 3. Fallback: Broadcast.
   */
  /**
   * Send a request to a specific client (local or remote).
   *
   * 1. Checks local clients.
   * 2. Checks Presence Registry -> Unicast.
   * 3. Fallback: Error (Client not found).
   */
  // 1. Protocol-specific overload
  async sendToClient<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    identity: string,
    version: V,
    method: M,
    params: OCPPRequestType<V, M>,
    options?: CallOptions
  ): Promise<OCPPResponseType<V, M> | undefined>;

  // 2. Global overload (infers method from any protocol)
  async sendToClient<M extends AllMethodNames<any>>(
    identity: string,
    method: M,
    params: OCPPRequestType<any, M>,
    options?: CallOptions
  ): Promise<OCPPResponseType<any, M> | undefined>;

  // 3. Custom/Loose overload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendToClient<_T = any>(
    identity: string,
    method: string,
    params: Record<string, any>,
    options?: CallOptions
  ): Promise<any | undefined>;

  async sendToClient(...args: any[]): Promise<any> {
    let identity: string;
    let method: string;
    let params: any;
    let options: CallOptions | undefined;

    // Parse overloads
    if (
      args.length >= 4 &&
      typeof args[0] === "string" &&
      typeof args[1] === "string" &&
      typeof args[2] === "string"
    ) {
      // (identity, version, method, params, options)
      identity = args[0];
      // version = args[1]; // Not used for routing yet, but could be validation
      method = args[2];
      params = args[3];
      options = args[4];
    } else {
      // (identity, method, params, options)
      identity = args[0];
      method = args[1];
      params = args[2];
      options = args[3];
    }

    // 1. Check local
    for (const client of this._clients) {
      if (client.identity === identity) {
        // Found locally
        return await client.call(method as any, params as any, options);
      }
    }

    // 2. Check Registry & Unicast
    if (this._adapter?.getPresence) {
      const nodeId = await this._adapter.getPresence(identity);
      if (nodeId) {
        // Found remote node
        await this._adapter.publish(`ocpp:node:${nodeId}`, {
          source: this._nodeId,
          target: identity,
          method,
          params,
          options,
        });
        return;
      } else {
        // Node not found in registry
      }
    }

    // 3. Fallback to Broadcast (if configured/needed)
    // For now, we only broadcast if explicitly called via .broadcast()
    // But if we want comprehensive routing, we could broadcast here.
    // Ideally, sendToClient implies targeted. If not found, we throw or return false.
    throw new Error(`Client ${identity} not found`);
  }

  // ─── Safe SendToClient (Best Effort) ──────────────────────────

  // 1. Protocol-specific overload
  async safeSendToClient<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    identity: string,
    version: V,
    method: M,
    params: OCPPRequestType<V, M>,
    options?: CallOptions
  ): Promise<OCPPResponseType<V, M> | undefined>;

  // 2. Global overload
  async safeSendToClient<M extends AllMethodNames<any>>(
    identity: string,
    method: M,
    params: OCPPRequestType<any, M>,
    options?: CallOptions
  ): Promise<OCPPResponseType<any, M> | undefined>;

  // 3. Custom/Loose overload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async safeSendToClient<_T = any>(
    identity: string,
    method: string,
    params: Record<string, any>,
    options?: CallOptions
  ): Promise<any | undefined>;

  async safeSendToClient(...args: any[]): Promise<any> {
    try {
      // @ts-expect-error
      return await this.sendToClient(...args);
    } catch (error) {
      if (
        this._logger &&
        typeof this._logger.warn === "function" &&
        (error as Error).name !== "TimeoutError"
      ) {
        this._logger.warn("SafeSendToClient failed", {
          identity: args[0],
          method:
            args.length >= 4 &&
            typeof args[1] === "string" &&
            typeof args[2] === "string"
              ? args[2] // versioned: id, ver, method, params, options
              : args.length >= 3 && typeof args[1] === "string"
              ? args[1] // global: id, method, params, options
              : "unknown",
          error,
        });
      }
      return undefined;
    }
  }

  // ─── Pub/Sub Adapter ─────────────────────────────────────────

  async setAdapter(adapter: EventAdapterInterface): Promise<void> {
    this._adapter = adapter;

    // 1. Subscribe to Broadcast
    await this._adapter.subscribe("ocpp:broadcast", (msg: unknown) =>
      this._onBroadcast(msg)
    );

    // 2. Subscribe to Unicast (My Node)
    await this._adapter.subscribe(
      `ocpp:node:${this._nodeId}`,
      (msg: unknown) => {
        this._onUnicast(msg);
      }
    );
  }

  private _onBroadcast(msg: unknown) {
    try {
      if (!msg || typeof msg !== "object") return;
      const payload = msg as {
        source: string;
        method: string;
        params: unknown;
      };

      if (payload.source === this._nodeId) return;

      for (const client of this._clients) {
        client.call(payload.method, payload.params as any).catch(() => {});
      }
    } catch (err) {
      this._logger?.error?.("Error processing broadcast message", {
        error: (err as Error).message,
      });
    }
  }

  private _onUnicast(msg: unknown) {
    try {
      if (!msg || typeof msg !== "object") return;
      const payload = msg as {
        source: string;
        target: string;
        method: string;
        params: unknown;
        options?: CallOptions;
      };

      // Unicast is meant for ME, but specifically for a TARGET client
      // I should find that client and send.
      // Unlike broadcast, I don't need to iterate all.
      for (const client of this._clients) {
        if (client.identity === payload.target) {
          client
            .call(payload.method, payload.params as any, payload.options)
            .catch((err) => {
              if ((err as Error).name !== "TimeoutError") {
                this._logger?.error?.("Error delivering unicast to client", {
                  identity: payload.target,
                  error: err,
                });
              }
            });
          return;
        }
      }
      // If we got here, we received a unicast for a client we don't have.
      // This implies the Registry is stale.
      this._logger?.warn?.("Received unicast for unknown client", {
        target: payload.target,
      });
      // Corrective action: Clean up stale registry entry?
      if (this._adapter?.removePresence) {
        this._adapter.removePresence(payload.target).catch(() => {});
      }
    } catch (err) {
      this._logger?.error?.("Error processing unicast", {
        error: (err as Error).message,
      });
    }
  }

  async publish(channel: string, data: unknown): Promise<void> {
    if (this._adapter) {
      await this._adapter.publish(channel, data);
    }
  }

  async broadcast<V extends AllMethodNames<any>>(
    method: V,
    params: OCPPRequestType<any, V>
  ): Promise<void> {
    const localPromises = Array.from(this._clients).map((client) =>
      client.call(method as any, params as any).catch(() => {})
    );

    const remotePromise = this._adapter
      ? this._adapter.publish("ocpp:broadcast", {
          source: this._nodeId,
          method,
          params,
        })
      : Promise.resolve();

    await Promise.all([Promise.all(localPromises), remotePromise]);
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
  async broadcastBatch<V extends AllMethodNames<any>>(
    identities: string[],
    method: V,
    params: OCPPRequestType<any, V>,
    options?: CallOptions
  ): Promise<void> {
    const localIdentities = new Set<string>();
    const localPromises: Promise<any>[] = [];

    // 1. Send to local clients immediately (O(1) lookup via _clientsByIdentity)
    for (const identity of identities) {
      const client = this._clientsByIdentity.get(identity);
      if (client) {
        localIdentities.add(identity);
        localPromises.push(
          client.call(method as any, params as any, options).catch(() => {})
        );
      }
    }

    // 2. Resolve remote clients
    const remoteIdentities = identities.filter(
      (id) => !localIdentities.has(id)
    );

    if (remoteIdentities.length > 0 && this._adapter) {
      // 2a. Fetch presence in batch
      let presences: (string | null)[] = [];
      if (this._adapter.getPresenceBatch) {
        presences = await this._adapter.getPresenceBatch(remoteIdentities);
      } else if (this._adapter.getPresence) {
        presences = await Promise.all(
          remoteIdentities.map((id) => this._adapter!.getPresence!(id))
        );
      }

      // 2b. Prepare batch messages payload
      const batchMessages: { channel: string; data: unknown }[] = [];

      for (let i = 0; i < remoteIdentities.length; i++) {
        const nodeId = presences[i];
        if (nodeId) {
          batchMessages.push({
            channel: `ocpp:node:${nodeId}`,
            data: {
              source: this._nodeId,
              target: remoteIdentities[i],
              method,
              params,
              options,
            },
          });
        }
      }

      // 2c. Publish in batch via adapter
      if (batchMessages.length > 0) {
        if (this._adapter.publishBatch) {
          await this._adapter.publishBatch(batchMessages);
        } else {
          await Promise.all(
            batchMessages.map((bm) =>
              this._adapter!.publish(bm.channel, bm.data)
            )
          );
        }
      }
    }

    await Promise.all(localPromises);
  }
}
