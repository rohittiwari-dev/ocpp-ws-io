import { EventEmitter } from "node:events";
import type {
  AuthCallback,
  ConnectionMiddleware,
  ServerEvents,
  TypedEventEmitter,
} from "./types.js";

/**
 * Executes a Koa/Express style middleware chain on an incoming WebSocket connection.
 */
export async function executeMiddlewareChain(
  middlewares: ConnectionMiddleware[],
  ctx: Parameters<ConnectionMiddleware>[0],
): Promise<void> {
  let index = -1;
  const dispatch = async (i: number): Promise<void> => {
    if (i <= index) {
      throw new Error("next() called multiple times in middleware");
    }
    index = i;
    const fn = middlewares[i];
    if (i === middlewares.length) {
      return; // end of chain, resolve
    }
    if (!fn) return; // Should not happen

    // Call the middleware, injecting `next()` mapping to i + 1
    await fn(ctx, dispatch.bind(null, i + 1));
  };
  await dispatch(0);
}

/**
 * OCPPRouter — An Express-like Connection dispatcher.
 * Isolated handler for a specific set of matching URL route patterns.
 */
export class OCPPRouter extends (EventEmitter as new () => TypedEventEmitter<ServerEvents>) {
  public readonly patterns: Array<string | RegExp>;
  public readonly middlewares: ConnectionMiddleware[];
  public authCallback: AuthCallback<unknown> | null = null;

  constructor(
    patterns: Array<string | RegExp>,
    middlewares: ConnectionMiddleware[],
  ) {
    super();
    this.patterns = patterns;
    this.middlewares = middlewares;
  }

  /**
   * Registers an authentication and protocol-negotiation callback for this route endpoint.
   */
  auth<TSession = Record<string, unknown>>(
    callback: AuthCallback<TSession>,
  ): this {
    this.authCallback = callback as AuthCallback<unknown>;
    return this;
  }
}
