import { HandshakeRejection } from "../core/errors.js";
import type { MiddlewareFunction } from "../core/middleware.js";
import type {
  AuthAccept,
  AuthCallback,
  AuthContext,
  ConnectionMiddleware,
} from "../types/auth.js";
import type { LoggerLike, LoggingConfig } from "../types/logger.js";
import type { MiddlewareContext } from "../types/middleware.js";
import type { OCPPPlugin } from "../types/plugins.js";
import type { AnyOCPPProtocol } from "../types/protocol.js";
import type { SessionData } from "../types/session.js";

// ─── Middleware Definition ───────────────────────────────────────

/**
 * Utility to define and strongly-type a ConnectionMiddleware function.
 * This provides immediate IDE autocomplete for the `ConnectionContext`.
 */
export function defineMiddleware(
  mw: ConnectionMiddleware,
): ConnectionMiddleware {
  return mw;
}

// ─── Plugin Definition ──────────────────────────────────────────

/**
 * Utility to define and strongly-type an `OCPPPlugin` object.
 * Provides full IDE autocomplete for all lifecycle hooks.
 *
 * @example
 * ```ts
 * import { createPlugin } from 'ocpp-ws-io';
 *
 * const metricsPlugin = createPlugin({
 *   name: 'metrics',
 *   onInit(server)       { console.log('Metrics plugin ready'); },
 *   onConnection(client) { metrics.gauge('connections').inc(); },
 *   onDisconnect(client) { metrics.gauge('connections').dec(); },
 *   onClose()            { metrics.flush(); },
 * });
 *
 * server.plugin(metricsPlugin);
 * ```
 *
 * `createPlugin<"ocpp1.6">({ ... })` types an app's own plugin for its
 * server's protocols: its hooks get 1.6 connections, and only a server with
 * those protocols accepts it. Without a type argument it fits any server.
 */
export function createPlugin<P extends AnyOCPPProtocol = AnyOCPPProtocol>(
  plugin: OCPPPlugin<P>,
): OCPPPlugin<P> {
  return plugin;
}

/**
 * Utility to define and strongly-type an RPC Middleware function.
 * This provides immediate IDE autocomplete for the `MiddlewareContext`
 * used when passing middleware to `client.use()`.
 */
export function defineRpcMiddleware<TContext = MiddlewareContext>(
  mw: MiddlewareFunction<TContext>,
): MiddlewareFunction<TContext> {
  return mw;
}

// ─── Auth Definition & Composition ───────────────────────────────

/**
 * Utility to define and strongly-type an AuthCallback function.
 * This provides immediate IDE autocomplete for the handshake and arguments.
 *
 * Written inline in `server.auth(...)`, `ctx.accept({ protocol })` takes
 * that server's protocols; on its own, the callback fits any server.
 */
export function defineAuth<
  TSession = SessionData,
  P extends AnyOCPPProtocol = AnyOCPPProtocol,
>(cb: AuthCallback<TSession, P>): AuthCallback<TSession, P> {
  return cb;
}

/**
 * Combines multiple AuthCallback functions sequentially.
 *
 * Flow matching standard middleware logic:
 * - If one callback `reject(err)` is called, the loop drops the connection instantly.
 * - If one callback `accept(opts)` is called, the loop terminates and grants the connection.
 * - If the loop finishes without anyone calling accept, it rejects with 401 Unauthorized.
 * - If a callback throws, the error reaches the server, which logs it and
 *   answers 500 without its details.
 */
export function combineAuth<P extends AnyOCPPProtocol = AnyOCPPProtocol>(
  ...cbs: AuthCallback<SessionData, P>[]
): AuthCallback<SessionData, P> {
  return async (ctx) => {
    let accepted = false;
    let rejected = false;

    // Wrap the underlying accept/reject purely to detect when they fire
    const trackedAccept = (opts?: AuthAccept<SessionData, P>) => {
      accepted = true;
      ctx.accept(opts);
    };

    const trackedReject = (code?: number, message?: string): never => {
      rejected = true;
      return ctx.reject(code, message);
    };

    const trackedCtx: AuthContext<SessionData, P> = {
      ...ctx,
      accept: trackedAccept,
      reject: trackedReject,
    };

    try {
      for (const cb of cbs) {
        if (ctx.signal.aborted || accepted || rejected) break;

        // Native callbacks from user might be sync or async
        const p = cb(trackedCtx);
        if (p instanceof Promise) {
          await p;
        }

        if (accepted || rejected) break;
      }

      // If loop finishes and nothing was explicitly decided, drop the connection
      if (!accepted && !rejected) {
        trackedReject(
          401,
          "Unauthorized (All composeAuth handlers passed without accepting)",
        );
      }
    } catch (err) {
      // reject() throws to stop the callback; the server already has the
      // result. Anything else is passed on, so the server logs it and
      // answers 500 instead of it being dropped here.
      if (!(err instanceof HandshakeRejection)) throw err;
    }
  };
}

// ─── Logging Middleware ──────────────────────────────────────────

/**
 * Creates a middleware that logs all RPC exchanges using the provided logger.
 * Logs start/end of calls and results with duration.
 */
export function createLoggingMiddleware(
  logger: LoggerLike,
  identity: string,
  config: LoggingConfig | boolean = {},
): MiddlewareFunction<MiddlewareContext> {
  const options = typeof config === "object" ? config : {};
  const { exchangeLog = false, prettify = false } = options;

  return async (ctx, next) => {
    const start = Date.now();
    const method = ctx.method;

    // Use info if exchangeLog is enabled, otherwise debug
    const level = exchangeLog ? "info" : "debug";

    switch (ctx.type) {
      case "incoming_call":
        if (exchangeLog && prettify) {
          logger[level]?.(`⚡ ${identity}  ←  ${method}  [IN]`, {
            messageId: ctx.messageId,
            method: ctx.method,
            protocol: ctx.protocol,
            payload: ctx.params,
            direction: "IN",
          });
        } else {
          logger[level]?.(`CALL ←`, {
            messageId: ctx.messageId,
            method: ctx.method,
            protocol: ctx.protocol,
            payload: ctx.params,
            direction: "IN",
          });
        }
        break;

      case "outgoing_call":
        if (exchangeLog && prettify) {
          logger[level]?.(`⚡ ${identity}  →  ${method}  [OUT]`, {
            method: ctx.method,
            params: ctx.params,
            direction: "OUT",
          });
        } else {
          logger[level]?.(`CALL →`, {
            method: ctx.method,
            params: ctx.params,
            direction: "OUT",
          });
        }
        break;
    }

    try {
      const result = await next();
      const durationMs = Date.now() - start;

      switch (ctx.type) {
        case "incoming_call":
          if (result !== undefined && result !== null) {
            if (exchangeLog && prettify) {
              logger[level]?.(`✅ ${identity}  →  ${method}  [RES]`, {
                messageId: ctx.messageId,
                method: ctx.method,
                durationMs,
                params: result,
                direction: "OUT",
              });
            } else {
              logger[level]?.(`CALLRESULT →`, {
                messageId: ctx.messageId,
                method: ctx.method,
                durationMs,
                params: result,
                direction: "OUT",
              });
            }
          }
          break;

        case "outgoing_call":
          if (exchangeLog && prettify) {
            logger[level]?.(`✅ ${identity}  ←  ${method}  [RES]`, {
              messageId: ctx.messageId,
              method: ctx.method,
              durationMs,
              payload: result,
              direction: "IN",
            });
          } else {
            logger[level]?.(`CALLRESULT ←`, {
              messageId: ctx.messageId,
              method: ctx.method,
              durationMs,
              payload: result,
              direction: "IN",
            });
          }
          break;
      }

      return result;
    } catch (err) {
      const msg = (err as Error).message;
      const durationMs = Date.now() - start;

      if (ctx.type === "incoming_call") {
        if (exchangeLog && prettify) {
          logger.error?.(`🚨 ${identity}  →  ${method}  [ERR]`, {
            messageId: ctx.messageId,
            method: ctx.method,
            durationMs,
            error: msg,
            direction: "OUT",
          });
        } else {
          logger.error?.(`CALLERROR →`, {
            messageId: ctx.messageId,
            method: ctx.method,
            durationMs,
            error: msg,
            direction: "OUT",
          });
        }
      } else if (ctx.type === "outgoing_call") {
        if (exchangeLog && prettify) {
          logger.warn?.(`🚨 ${identity}  ←  ${method}  [ERR]`, {
            messageId: ctx.messageId,
            method: ctx.method,
            durationMs,
            error: msg,
            direction: "IN",
          });
        } else {
          logger.warn?.(`CALLERROR ←`, {
            messageId: ctx.messageId,
            method: ctx.method,
            durationMs,
            error: msg,
            direction: "IN",
          });
        }
      }
      throw err;
    }
  };
}
