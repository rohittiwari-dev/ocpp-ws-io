/**
 * RPC middleware helpers. Apart from the other helpers because the browser
 * entry exports them: the auth and plugin helpers name server types, and
 * through them Node's.
 */
import type { MiddlewareFunction } from "../core/middleware.js";
import type { LoggerLike, LoggingConfig } from "../types/logger.js";
import type { MiddlewareContext } from "../types/middleware.js";

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
