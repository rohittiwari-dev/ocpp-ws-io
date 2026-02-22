import { EventEmitter } from "node:events";
import type {
  AuthCallback,
  ConnectionMiddleware,
  CORSOptions,
  RouterConfig,
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
  const dispatch = async (
    i: number,
    payload?: Record<string, unknown>,
  ): Promise<void> => {
    if (payload) {
      ctx.state = {
        ...(ctx.state || {}),
        ...(payload || {}),
      };
    }
    if (i <= index) {
      throw new Error("next() called multiple times in middleware");
    }
    index = i;
    const fn = middlewares[i];
    if (i === middlewares.length) {
      return; // end of chain, resolve
    }
    if (!fn) return; // Should not happen

    // Attach next to the context
    ctx.next = dispatch.bind(null, i + 1);

    // Call the middleware
    await fn(ctx);
  };
  await dispatch(0);
}

interface CompiledPattern {
  regex: RegExp;
  paramNames: string[];
}

/**
 * OCPPRouter — An Express-like Connection dispatcher.
 * Isolated handler for a specific set of matching URL route patterns.
 */
export class OCPPRouter extends (EventEmitter as new () => TypedEventEmitter<ServerEvents>) {
  public patterns: Array<string | RegExp>;
  public compiledPatterns: CompiledPattern[] = [];
  public middlewares: ConnectionMiddleware[];
  public authCallback: AuthCallback<unknown> | null = null;
  public _routeCORS?: CORSOptions;
  public _routeConfig?: RouterConfig;

  constructor(
    patterns?: Array<string | RegExp>,
    middlewares?: ConnectionMiddleware[],
  ) {
    super();
    this.patterns = [];
    this.middlewares = middlewares ?? [];
    if (patterns?.length) {
      this.route(...patterns);
    }
  }

  /**
   * Appends URL paths or regular expressions to this router's match condition.
   */
  route(...patterns: Array<string | RegExp>): this {
    this.patterns.push(...patterns);
    for (const p of patterns) {
      if (typeof p === "string") {
        const paramNames: string[] = [];

        // 1. Escape regex control characters (except colons and asterisks)
        let regexStr = p.replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&");

        // 2. Translate Express-style wildcards
        regexStr = regexStr.replace(/\*/g, ".*");

        // 3. Extract named parameters
        regexStr = regexStr.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
          paramNames.push(key);
          return "([^/]+)";
        });

        this.compiledPatterns.push({
          regex: new RegExp(`^${regexStr}$`),
          paramNames,
        });
      } else {
        this.compiledPatterns.push({ regex: p, paramNames: [] });
      }
    }
    return this;
  }

  /**
   * Appends connection middlewares to this router's execution chain.
   */
  use(...middlewares: ConnectionMiddleware[]): this {
    this.middlewares.push(...middlewares);
    return this;
  }

  /**
   * Applies specific CORS rules to connections matching this router's paths.
   */
  cors(options: CORSOptions): this {
    this._routeCORS = options;
    return this;
  }

  /**
   * Overrides global connection settings (e.g. timeouts, protocols) for this router.
   */
  config(options: RouterConfig): this {
    this._routeConfig = options;
    return this;
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
