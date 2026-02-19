import type { MiddlewareContext, MiddlewareFunction } from "../types.js";
import type { LoggerLike } from "../types.js";

/**
 * Creates a middleware that logs all RPC exchanges using the provided logger.
 * Logs start/end of calls and results with duration.
 */
export function createLoggingMiddleware(
  logger: LoggerLike,
  identity: string,
): MiddlewareFunction<MiddlewareContext> {
  return async (ctx, next) => {
    const start = Date.now();
    const method = ctx.method;

    // Log Start
    // Format: ⚡ {identity} {arrow} {method} {direction}
    // Direction: [IN] for incoming, [OUT] for outgoing

    switch (ctx.type) {
      case "incoming_call":
        logger.info?.(`⚡ ${identity}  ←  ${method}  [IN]`, {
          messageId: ctx.messageId,
          method: ctx.method,
          protocol: ctx.protocol,
          payload: ctx.params, // User log shows "payload"
          direction: "IN",
        });
        break;
      case "outgoing_call":
        logger.info?.(`⚡ ${identity}  →  ${method}  [OUT]`, {
          method: ctx.method,
          params: ctx.params,
          direction: "OUT",
        });
        break;
    }

    try {
      const result = await next();

      // Log End / Result
      const durationMs = Date.now() - start;

      // We might want to log results too, but user only showed the CALL log in sample.
      // Assuming we keep result logging but maybe simplified or separate?
      // Or maybe user wants result logged same way?
      // User complaint was about "clean flow".

      switch (ctx.type) {
        case "incoming_call":
          // If result is sent back
          if (result !== undefined && result !== null) {
            logger.info?.(`⚡ ${identity}  →  ${method}  [RES]`, {
              messageId: ctx.messageId,
              method: ctx.method,
              durationMs,
              params: result,
              direction: "OUT",
            });
          }
          break;

        case "outgoing_call":
          logger.info?.(`⚡ ${identity}  ←  ${method}  [RES]`, {
            messageId: (ctx as any).messageId, // if we hack it, or just omit
            method: ctx.method,
            durationMs,
            params: result,
            direction: "IN",
          });
          break;

        case "incoming_result":
          // This is a result received for a previous call
          logger.info?.(`⚡ ${identity}  ←  ${method}  [RES]`, {
            messageId: ctx.messageId,
            method: ctx.method,
            durationMs,
            payload: ctx.payload,
            direction: "IN",
          });
          break;
      }

      return result;
    } catch (err) {
      // Log Error
      const msg = (err as Error).message;
      if (ctx.type === "incoming_call") {
        logger.error?.(`Handler error`, {
          messageId: ctx.messageId,
          method: ctx.method,
          error: msg,
        });
      } else if (ctx.type === "outgoing_call") {
        logger.error?.(`Call error`, {
          method: ctx.method,
          error: msg,
        });
      }
      throw err;
    }
  };
}
