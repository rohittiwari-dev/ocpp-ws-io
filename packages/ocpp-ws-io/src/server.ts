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
import { initLogger } from "./init-logger.js";
import { OCPPServerClient } from "./server-client.js";

import {
  type AllMethodNames,
  type AuthAccept,
  type AuthCallback,
  type ClientOptions,
  type CloseOptions,
  type EventAdapterInterface,
  type HandshakeInfo,
  type ListenOptions,
  type LoggerLike,
  type OCPPRequestType,
  SecurityProfile,
  type ServerEvents,
  type ServerOptions,
  type TypedEventEmitter,
} from "./types.js";
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
  private _authCallback: AuthCallback | null = null;
  private _clients = new Set<OCPPServerClient>();
  private _httpServers = new Set<Server>();
  private _wss: WebSocketServer | null = null;
  private _adapter: EventAdapterInterface | null = null;
  private _httpServerAbortControllers = new Set<AbortController>();
  private _logger: LoggerLike | null = null;

  // Robustness & Clustering
  private readonly _nodeId = createId();
  private _sessions = new Map<
    string,
    { data: Record<string, unknown>; lastActive: number }
  >();
  private _gcInterval: NodeJS.Timeout | null = null;
  // Default session timeout: 2 hours
  private readonly _sessionTimeoutMs = 2 * 60 * 60 * 1000;

  constructor(options: ServerOptions = {}) {
    super();

    if (options.strictMode) {
      if (!options.strictModeValidators && !options.protocols?.length) {
        throw new Error(
          "strictMode requires either strictModeValidators or protocols to be specified",
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
      ...options,
    };

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

  get clients(): ReadonlySet<OCPPServerClient> {
    return this._clients;
  }

  // ─── Auth ────────────────────────────────────────────────────

  auth(callback: AuthCallback): void {
    this._authCallback = callback;
  }

  // ─── Listen ──────────────────────────────────────────────────

  async listen(
    port = 0,
    host?: string,
    options?: ListenOptions,
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

    // Create WebSocketServer attached to noServer mode
    if (!this._wss) {
      this._wss = new WebSocketServer({ noServer: true });
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

    // ── Step 2: Parse URL → identity + endpoint ──
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );
    const pathParts = url.pathname.split("/").filter(Boolean);
    const identity = decodeURIComponent(pathParts[pathParts.length - 1] ?? "");

    if (!identity) {
      abortHandshake(socket, 400, "Missing identity in URL path");
      return;
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

    const serverProtocols = this._options.protocols ?? [];
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
      endpoint: url.pathname,
      query: url.searchParams,
      request: req,
      password,
      clientCertificate,
      securityProfile: profile,
    };

    // ── Step 8: Auth callback with AbortController + timeout ──
    if (this._authCallback) {
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
        await new Promise<AuthAccept | undefined>((resolve, reject) => {
          let settled = false;

          const accept = (opts?: AuthAccept) => {
            if (settled) return;
            settled = true;
            if (opts?.protocol) selectedProtocol = opts.protocol;
            resolve(opts);
          };

          const rejectAuth = (code = 401, message = "Unauthorized") => {
            if (settled) return;
            settled = true;
            reject({ code, message });
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
            { once: true },
          );

          this._authCallback?.(accept, rejectAuth, handshake, ac.signal);
        });
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
        const { code, message } = err as { code: number; message: string };
        this._logger?.warn?.("Auth rejected", { identity, code });
        abortHandshake(socket, code ?? 401, message ?? "Unauthorized");
        return;
      } finally {
        if (timer) clearTimeout(timer);
        socket.removeListener("close", onSocketGone);
        socket.removeListener("error", onSocketGone);
        socket.removeListener("end", onSocketGone);
      }
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
        callTimeoutMs: this._options.callTimeoutMs,
        pingIntervalMs: this._options.pingIntervalMs,
        deferPingsOnActivity: this._options.deferPingsOnActivity,
        callConcurrency: this._options.callConcurrency,
        maxBadMessages: this._options.maxBadMessages,
        respondWithDetailedErrors: this._options.respondWithDetailedErrors,
        strictMode: this._options.strictMode,
        strictModeValidators: this._options.strictModeValidators,
        reconnect: false,
        logging: this._options.logging,
      };

      const client = new OCPPServerClient(clientOptions, {
        ws,
        handshake,
        session: this._sessions.get(identity)?.data ?? {},
        protocol: selectedProtocol,
      });

      this._updateSessionActivity(identity, client.session);
      this._clients.add(client);

      this._logger?.info?.("Client connected", {
        identity,
        remoteAddress: req.socket.remoteAddress,
        protocol: selectedProtocol,
      });

      client.on("close", () => {
        this._clients.delete(client);
        this._logger?.info?.("Client disconnected", { identity });
      });

      this.emit("client", client);

      client.on("message", () => {
        this._updateSessionActivity(identity, client.session);
      });
    });
  }

  private _updateSessionActivity(
    identity: string,
    data: Record<string, unknown>,
  ) {
    this._sessions.set(identity, {
      data,
      lastActive: Date.now(),
    });
  }

  // ─── Close ───────────────────────────────────────────────────

  async close(options: CloseOptions = {}): Promise<void> {
    this._logger?.info?.("Server closing", { clientCount: this._clients.size });

    if (this._gcInterval) {
      clearInterval(this._gcInterval);
      this._gcInterval = null;
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

    // Close WebSocket server
    if (this._wss) {
      this._wss.close();
      this._wss = null;
    }

    // Close all HTTP servers
    const serverClosePromises = Array.from(this._httpServers).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    );
    await Promise.allSettled(serverClosePromises);
    this._httpServers.clear();

    // Disconnect adapter
    if (this._adapter) {
      await this._adapter.disconnect();
    }
  }

  // ─── Reconfigure ─────────────────────────────────────────────

  reconfigure(options: Partial<ServerOptions>): void {
    Object.assign(this._options, options);
  }

  // ─── Pub/Sub Adapter ─────────────────────────────────────────

  setAdapter(adapter: EventAdapterInterface): void {
    this._adapter = adapter;

    // Subscribe to global broadcast channel
    this._adapter.subscribe("ocpp:broadcast", (msg: unknown) => {
      try {
        if (!msg || typeof msg !== "object") return;
        const payload = msg as {
          source: string;
          method: string;
          params: unknown;
        };

        // Loopback protection: Ignore own messages
        if (payload.source === this._nodeId) return;

        // Forward to local clients
        // We iterate and fire-and-forget to not block the event loop
        for (const client of this._clients) {
          client.call(payload.method, payload.params as any).catch(() => {
            // Ignore errors from individual clients during broadcast
          });
        }
      } catch (err) {
        console.error("Error processing broadcast message:", err);
      }
    });
  }

  async publish(channel: string, data: unknown): Promise<void> {
    if (this._adapter) {
      await this._adapter.publish(channel, data);
    }
  }

  /**
   * Broadcasts a request to all connected clients (local and remote).
   *
   * 1. Iterates over all local clients and sends the request.
   * 2. Publishes the request to Redis so other nodes can do the same.
   */
  async broadcast<V extends AllMethodNames<any>>(
    method: V,
    params: OCPPRequestType<any, V>,
  ): Promise<void> {
    // 1. Send to local clients
    const localPromises = Array.from(this._clients).map((client) =>
      // Cast to any to bypass strict protocol checks during broadcast
      client.call(method as any, params as any).catch(() => {}),
    );

    // 2. Publish to Redis (if adapter exists)
    const remotePromise = this._adapter
      ? this._adapter.publish("ocpp:broadcast", {
          source: this._nodeId,
          method,
          params,
        })
      : Promise.resolve();

    await Promise.all([Promise.all(localPromises), remotePromise]);
  }
}
