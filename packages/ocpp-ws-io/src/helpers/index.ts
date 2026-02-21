import type {
  AuthAccept,
  AuthCallback,
  ConnectionMiddleware,
  LoggerLike,
  MiddlewareContext,
  MiddlewareFunction,
} from "../types.js";

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
 */
export function defineAuth<TSession = Record<string, unknown>>(
  cb: AuthCallback<TSession>,
): AuthCallback<TSession> {
  return cb;
}

/**
 * Combines multiple AuthCallback functions sequentially.
 *
 * Flow matching standard middleware logic:
 * - If one callback `reject(err)` is called, the loop drops the connection instantly.
 * - If one callback `accept(opts)` is called, the loop terminates and grants the connection.
 * - If the loop finishes without anyone calling accept, it rejects with 401 Unauthorized.
 */
export function combineAuth(...cbs: AuthCallback[]): AuthCallback {
  return async (accept, reject, handshake, signal) => {
    let accepted = false;
    let rejected = false;

    // Wrap the underlying accept/reject purely to detect when they fire
    const trackedAccept = (opts?: AuthAccept<any>) => {
      accepted = true;
      accept(opts);
    };

    const trackedReject = (code?: number, message?: string) => {
      rejected = true;
      reject(code, message);
    };

    try {
      for (const cb of cbs) {
        if (signal.aborted || accepted || rejected) break;

        // Native callbacks from user might be sync or async
        const p = cb(trackedAccept, trackedReject, handshake, signal);
        if (p instanceof Promise) {
          await p;
        }

        if (accepted || rejected) break;
      }

      // If loop finishes and nothing was explicitly decided, drop the connection
      if (!accepted && !rejected) {
        reject(
          401,
          "Unauthorized (All composeAuth handlers passed without accepting)",
        );
      }
    } catch (_err) {
      if (!rejected) {
        reject(500, "Internal Server Error during auth compose execution");
      }
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
