import type { RawData, WebSocket } from "ws";
import { OCPPClient } from "./client.js";
import {
  type ClientOptions,
  ConnectionState,
  type HandshakeInfo,
} from "./types.js";

/**
 * OCPPServerClient — A server-side client representation.
 *
 * Created by OCPPServer when a charging station connects.
 * Extends OCPPClient but is pre-connected (cannot call connect()).
 */
export class OCPPServerClient extends OCPPClient {
  private _serverSession: Record<string, any>;
  private _serverHandshake: HandshakeInfo;

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
      workerPool?: import("./worker-pool.js").WorkerPool;
    },
  ) {
    super(options);

    this._serverSession = context.session;
    this._serverHandshake = context.handshake;
    this._adaptiveMultiplier = context.adaptiveMultiplier ?? null;

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
    // @ts-expect-error — _startPing is private in base class OCPPClient
    this._startPing();
  }

  // ─── Rate Limiting State ──────────────────────────────────────────

  private _rateLimits: Record<string, { tokens: number; lastRefill: number }> =
    {};
  private _adaptiveMultiplier: (() => number) | null = null;

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

  // ─── Websocket Override ──────────────────────────────────────────

  private _attachServerWebsocket(ws: WebSocket): void {
    ws.on("message", (data: RawData) => {
      // @ts-expect-error
      this._recordActivity();

      // Rate Limit Check
      const limits = this._options.rateLimit;
      if (limits) {
        // We need to parse just enough to find the method name if there are method rules
        let method: string | undefined;
        let pData: unknown;

        if (limits.methods) {
          try {
            // Zero-copy — JSON.parse accepts Buffer directly (Node 18+)
            pData = JSON.parse(data as unknown as string);
            if (Array.isArray(pData) && pData[0] === 2) {
              method = pData[2];
            }
          } catch {
            // Ignore parse errors here, let super._onMessage handle bad JSON
          }
        }

        if (!this._checkRateLimit(method)) {
          this._handleRateLimitExceeded(pData || data.toString());
          return;
        }

        // Fast path: if we parsed data to find a method, reconstruct to string or pass it if possible
        // Actually, super._onMessage expects RawData. It'll parse it again.
        // It's a small performance hit, but safe.
      }

      // @ts-expect-error
      this._onMessage(data);
    });

    ws.on("close", (code: number, reason: Buffer) =>
      // @ts-expect-error
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
      // @ts-expect-error
      this._recordActivity();
      this.emit("ping");
    });
    ws.on("pong", () => {
      // @ts-expect-error
      if (this._pongTimer) {
        // @ts-expect-error
        clearTimeout(this._pongTimer);
        // @ts-expect-error
        this._pongTimer = null;
      }
      // @ts-expect-error
      this._recordActivity();
      this.emit("pong");
    });
  }

  private _handleRateLimitExceeded(rawData: unknown): void {
    const limits = this._options.rateLimit!;
    const action = limits.onLimitExceeded || "ignore";

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
