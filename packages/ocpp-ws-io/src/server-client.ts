import type { RawData, WebSocket } from "ws";
import { OCPPClient } from "./client.js";
import {
  type ClientOptions,
  ConnectionState,
  type HandshakeInfo,
  type OCPPPlugin,
} from "./types.js";
import type { WorkerPool } from "./worker-pool.js";

/**
 * OCPPServerClient — A server-side client representation.
 *
 * Created by OCPPServer when a charging station connects.
 * Extends OCPPClient but is pre-connected (cannot call connect()).
 */
export class OCPPServerClient extends OCPPClient {
  private _serverSession: Record<string, any>;
  private _serverHandshake: HandshakeInfo;
  /** Plugins passed from OCPPServer for hook execution */
  private _serverPlugins: OCPPPlugin[];

  constructor(
    options: ClientOptions,
    context: {
      ws: WebSocket;
      handshake: HandshakeInfo;
      session: Record<string, any>;
      protocol?: string;
      /** Optional adaptive rate multiplier getter (from OCPPServer.AdaptiveLimiter) */
      adaptiveMultiplier?: () => number;
      /** Optional worker pool for off-thread JSON parsing */
      workerPool?: WorkerPool;
      /** Plugins from the server for hook execution */
      plugins?: OCPPPlugin[];
    },
  ) {
    super(options);

    this._serverSession = context.session;
    this._serverHandshake = context.handshake;
    this._adaptiveMultiplier = context.adaptiveMultiplier ?? null;
    this._workerPool = context.workerPool ?? null;
    this._serverPlugins = context.plugins ?? [];

    // Set state to OPEN directly (already connected via server)
    this._state = ConnectionState.OPEN;
    this._identity = this._options.identity;
    this._ws = context.ws;
    this._protocol = context.protocol ?? context.ws.protocol;

    // Attach WebSocket handlers
    // We do NOT call super._attachWebsocket because we want to intercept messages
    // for Server-only features like Rate Limiting.
    this._attachServerWebsocket(context.ws);

    // Activate ping/pong dead-peer detection — without this, 4G NAT teardowns
    // leave zombie connections open indefinitely. Now detected within ~40s.
    this._startPing();
  }

  // ─── Rate Limiting State ──────────────────────────────────────────

  private _rateLimits: Record<string, { tokens: number; lastRefill: number }> =
    {};
  private _adaptiveMultiplier: (() => number) | null = null;
  private _workerPool: WorkerPool | null = null;

  /**
   * Per-connection inbound pipeline. Serializes async pre-processing
   * (plugin onBeforeReceive, rate-limit parse, worker-pool parse) so
   * messages are DISPATCHED in wire order — OCPP transaction semantics
   * depend on it (e.g. StartTransaction before StopTransaction).
   *
   * The guarantee ends at dispatch. An async handler is not awaited here, so
   * two handlers can interleave once the first hits an await, and they may
   * finish out of order. Handlers whose side effects must not overlap have to
   * serialize themselves — per-identity, so one slow charger cannot stall the
   * rest.
   */
  private _inboundChain: Promise<void> = Promise.resolve();
  /** Frames queued on the chain, used to pause the socket when it falls behind. */
  private _inboundDepth = 0;
  private _inboundPaused = false;
  private static readonly _INBOUND_HIGH_WATER = 100;
  private static readonly _INBOUND_LOW_WATER = 25;

  private _checkRateLimit(method?: string): boolean {
    const limits = this._options.rateLimit;
    if (!limits) return true;

    const now = Date.now();

    const checkBucket = (key: string, limit: number, windowMs: number) => {
      let bucket = this._rateLimits[key];
      if (!bucket) {
        bucket = { tokens: limit, lastRefill: now };
        this._rateLimits[key] = bucket;
      } else {
        const timePassed = now - bucket.lastRefill;
        // Refill logic (tokens per ms) — adaptive multiplier scales the refill rate
        const adaptiveScale = this._adaptiveMultiplier?.() ?? 1;
        const refillRate = (limit / windowMs) * adaptiveScale;
        const tokensToAdd = timePassed * refillRate;
        if (tokensToAdd > 0) {
          bucket.tokens = Math.min(limit, bucket.tokens + tokensToAdd);
          bucket.lastRefill = now;
        }
      }

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return true;
      }
      return false;
    };

    // 1. Check Global Limit wrapper
    if (!checkBucket("global", limits.limit, limits.windowMs)) {
      return false;
    }

    // 2. Check Method-Specific Limit
    if (method && limits.methods?.[method]) {
      const specific = limits.methods[method];
      if (!checkBucket(`method:${method}`, specific.limit, specific.windowMs)) {
        return false;
      }
    }

    return true;
  }

  // ─── Websocket Override & Hooks ─────────────────────────────────

  protected override _invokeBeforeSend(
    message: import("./types.js").OCPPMessage,
  ): boolean | Promise<boolean> {
    if (this._serverPlugins.length === 0) return true;

    // Check if we need to return a promise (if any plugin returns a promise)
    const promises: Promise<boolean>[] = [];

    for (const p of this._serverPlugins) {
      if (p.onBeforeSend) {
        try {
          const result = p.onBeforeSend(this, message);
          if (result instanceof Promise) {
            promises.push(
              result.then((res) => res !== false).catch(() => true),
            );
          } else if (result === false) {
            return false;
          }
        } catch (_err) {}
      }
    }

    if (promises.length > 0) {
      return Promise.all(promises).then((results) =>
        results.every((r) => r === true),
      );
    }

    return true;
  }

  private _attachServerWebsocket(ws: WebSocket): void {
    ws.on("message", (data: RawData) => {
      this._recordActivity();

      // Apply back-pressure to the peer while the chain is behind.
      //
      // Every arriving frame used to be appended unconditionally, and each one
      // is held in memory until its turn. A sender faster than the processing
      // stage — a slow plugin hook, an off-thread parse, a busy event loop —
      // therefore grew this chain without limit, turning a fast charger into
      // unbounded heap growth on the server. Pausing the socket lets TCP push
      // the backlog back to the sender instead of buffering it here.
      this._inboundDepth++;
      if (
        !this._inboundPaused &&
        this._inboundDepth >= OCPPServerClient._INBOUND_HIGH_WATER
      ) {
        this._inboundPaused = true;
        ws.pause();
        this._logger?.warn?.("Inbound backlog high — pausing socket", {
          identity: this.identity,
          depth: this._inboundDepth,
        });
      }

      this._inboundChain = this._inboundChain
        .then(() => this._processInboundMessage(data))
        .catch(() => {
          // _processInboundMessage handles its own errors; never break the chain
        })
        .finally(() => {
          this._inboundDepth--;
          if (
            this._inboundPaused &&
            this._inboundDepth <= OCPPServerClient._INBOUND_LOW_WATER
          ) {
            this._inboundPaused = false;
            ws.resume();
            this._logger?.debug?.("Inbound backlog drained — resuming socket", {
              identity: this.identity,
            });
          }
        });
    });

    ws.on("close", (code: number, reason: Buffer) =>
      this._onClose(code, reason),
    );
    ws.on("error", (err: Error) => {
      if (this.listenerCount("error") > 0) {
        this.emit("error", err);
      } else {
        this._logger?.debug?.(
          "WebSocket error (unhandled by client listener)",
          {
            error: err.message,
          },
        );
      }
    });
    ws.on("ping", () => {
      this._recordActivity();
      this.emit("ping");
    });
    ws.on("pong", () => {
      if (this._pongTimer) {
        clearTimeout(this._pongTimer);
        this._pongTimer = null;
      }
      this._recordActivity();
      this.emit("pong");
    });
  }

  private async _processInboundMessage(data: RawData): Promise<void> {
    // Plugin interception: onBeforeReceive
    for (const p of this._serverPlugins) {
      if (p.onBeforeReceive) {
        try {
          const result = p.onBeforeReceive(this, data);
          if (result instanceof Promise) {
            const res = await result;
            if (res === false) return;
          } else if (result === false) {
            return;
          }
        } catch (_err) {
          // Don't let plugin errors stop message processing
        }
      }
    }

    const limits = this._options.rateLimit;

    // Without per-method rules the limiter needs nothing from the payload, so
    // reject before spending anything on parsing — that is the whole point of
    // a connection rate limit.
    if (limits && !limits.methods) {
      if (!this._checkRateLimit(undefined)) {
        this._handleRateLimitExceeded(data.toString());
        return;
      }
    }

    // Parse, off-thread when a pool is available.
    //
    // Extracting the method name for per-method rate limiting used to be done
    // with a main-thread JSON.parse that then returned early, so configuring
    // `rateLimit.methods` alongside `workerThreads` left the pool allocated
    // and permanently idle while every frame parsed on the event loop.
    const needsMethod = !!limits?.methods;
    let parsed: unknown;
    let didParse = false;

    if (this._workerPool) {
      const raw = typeof data === "string" ? data : (data as Buffer);
      try {
        const result = await this._workerPool.parse(raw);
        parsed = result.message;
        didParse = true;
      } catch (err) {
        // Falls back to a main-thread parse, which also handles genuinely bad
        // JSON. That fallback used to be completely silent, so a pool that was
        // saturated, wedged or dead looked exactly like normal operation while
        // every frame quietly reverted to the main thread.
        const reason = (err as Error)?.message ?? String(err);
        if (!/JSON|Unexpected token/i.test(reason)) {
          this._logger?.warn?.("Worker parse unavailable — parsing inline", {
            identity: this.identity,
            reason,
          });
        }
        if (needsMethod) {
          try {
            parsed = JSON.parse(data as unknown as string);
            didParse = true;
          } catch {
            // Leave it to _onMessage, which reports bad JSON properly.
          }
        }
      }
    } else if (needsMethod) {
      try {
        // JSON.parse accepts a Buffer directly (implicit utf8 toString)
        parsed = JSON.parse(data as unknown as string);
        didParse = true;
      } catch {
        // Ignore parse errors here, let _onMessage handle bad JSON
      }
    }

    // Per-method rules need the action name, so this runs after the parse.
    if (needsMethod) {
      let method: string | undefined;
      if (didParse && Array.isArray(parsed) && parsed[0] === 2) {
        method = parsed[2];
      }
      if (!this._checkRateLimit(method)) {
        this._handleRateLimitExceeded(didParse ? parsed : data.toString());
        return;
      }
    }

    // Hand over the parsed payload when we have one, so nothing parses twice.
    if (didParse) {
      this._onMessage(data, parsed);
      return;
    }
    this._onMessage(data);
  }

  private _handleRateLimitExceeded(rawData: unknown): void {
    const limits = this._options.rateLimit!;
    const action = limits.onLimitExceeded || "ignore";

    // Plugin hook: onRateLimitExceeded
    this.emit("rateLimitExceeded", { rawData });

    if (action === "disconnect") {
      this._logger?.warn?.("Rate limit exceeded — disconnecting client", {
        identity: this.identity,
      });
      this._ws?.terminate();
    } else if (typeof action === "function") {
      try {
        const res = action(this, rawData);
        if (res instanceof Promise) {
          res.catch((err) => {
            this._logger?.error?.("Error in custom onLimitExceeded handler", {
              identity: this.identity,
              error: err,
            });
          });
        }
      } catch (err) {
        this._logger?.error?.("Error in custom onLimitExceeded handler", {
          identity: this.identity,
          error: err,
        });
      }
    } else {
      this._logger?.debug?.("Rate limit exceeded — ignoring message", {
        identity: this.identity,
      });
    }
  }

  /**
   * Session data associated with this client connection.
   */
  get session(): Record<string, any> {
    return this._serverSession;
  }

  /**
   * Handshake information from the initial connection.
   */
  get handshake(): HandshakeInfo {
    return this._serverHandshake;
  }

  /**
   * Server clients cannot initiate connections.
   * @throws Always throws — use OCPPClient for outbound connections.
   */
  override async connect(): Promise<never> {
    throw new Error(
      "Cannot connect from server client — connection is managed by the server",
    );
  }

  /**
   * Forcibly disconnects this charging station from the server.
   * Useful for authentication revocation, administrative kicks, or clearing hung connections.
   * By default, waits for pending calls to finish before closing (awaitPending: true).
   *
   * @example
   * await client.close({ code: 1000, reason: "Admin revocation" });
   */
  override close(
    options: import("./types.js").CloseOptions = {},
  ): Promise<{ code: number; reason: string }> {
    return super.close(options);
  }
}
