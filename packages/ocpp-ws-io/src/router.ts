import { EventEmitter } from "node:events";
import type {
  AllMethodNames,
  OCPPRequestType,
  OCPPResponseType,
} from "./generated/index.js";
import type { OCPPServerClient } from "./server-client.js";
import type {
  AuthCallback,
  CORSOptions,
  ConnectionMiddleware,
  OCPPProtocol,
  RouterConfig,
  RouterHandlerContext,
  RouterWildcardHandler,
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

/**
 * Compiled regex pattern for RegExp-based route fallback.
 * Only used when a user registers a RegExp pattern (not string patterns).
 * @internal
 */
export interface CompiledRegexPattern {
  regex: RegExp;
  paramNames: string[];
}

/**
 * OCPPRouter — An Express-like Connection dispatcher.
 * Isolated handler for a specific set of matching URL route patterns.
 *
 * String patterns are matched via radix trie (O(k) lookup, managed by OCPPServer).
 * RegExp patterns fall back to linear matching.
 */
export class OCPPRouter extends (EventEmitter as new () => TypedEventEmitter<ServerEvents>) {
  /** Raw registered patterns (strings and/or RegExp) for reference. */
  public patterns: Array<string | RegExp>;
  /** Connection middlewares attached to this router. */
  public middlewares: ConnectionMiddleware[];
  /** Auth callback for this route endpoint. */
  public authCallback: AuthCallback<unknown> | null = null;
  /** Route-level CORS options. */
  public _routeCORS?: CORSOptions;
  /** Route-level config overrides. */
  public _routeConfig?: RouterConfig;

  /**
   * Compiled RegExp patterns for fallback linear matching.
   * Only populated when RegExp patterns are registered.
   * @internal
   */
  public _regexPatterns: CompiledRegexPattern[] = [];

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
   * String patterns are stored for trie insertion by OCPPServer.
   * RegExp patterns are compiled for linear fallback matching.
   */
  route(...patterns: Array<string | RegExp>): this {
    this.patterns.push(...patterns);
    for (const p of patterns) {
      if (typeof p !== "string") {
        // RegExp — compile for fallback linear matching
        this._regexPatterns.push({ regex: p, paramNames: [] });
      }
      // String patterns are handled by the RadixTrie in OCPPServer
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

  /**
   * Binds a version-specific OCPP message handler directly to all clients that match this route.
   */
  handle<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    version: V,
    method: M,
    handler: (
      context: RouterHandlerContext<OCPPRequestType<V, M>>,
    ) => OCPPResponseType<V, M> | Promise<OCPPResponseType<V, M>>,
  ): this;

  /**
   * Binds a custom/extension message handler directly to all clients that match this route.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle<S extends string>(
    version: S extends OCPPProtocol ? never : S,
    method: string,
    handler: (context: RouterHandlerContext<Record<string, any>>) => any,
  ): this;

  /**
   * Binds a message handler directly to all clients that match this route using the default protocol.
   */
  handle<M extends AllMethodNames<OCPPProtocol>>(
    method: M,
    handler: (
      context: RouterHandlerContext<OCPPRequestType<OCPPProtocol, M>>,
    ) =>
      | OCPPResponseType<OCPPProtocol, M>
      | Promise<OCPPResponseType<OCPPProtocol, M>>,
  ): this;

  /** Binds a custom/extension method not in the typed map. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(
    method: string,
    handler: (context: RouterHandlerContext<Record<string, any>>) => any,
  ): this;

  /** Binds a wildcard handler to all clients that match this route. */
  handle(handler: RouterWildcardHandler): this;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(...args: any[]): this {
    this.on("client", (client: OCPPServerClient) => {
      const originalHandler = args[args.length - 1];
      const wrappedArgs = [...args];

      if (typeof originalHandler === "function") {
        wrappedArgs[wrappedArgs.length - 1] = (...handlerArgs: any[]) => {
          const contextIndex = handlerArgs.length - 1;
          const context = handlerArgs[contextIndex];

          if (context && typeof context === "object") {
            Object.defineProperty(context, "client", {
              value: client,
              enumerable: true,
              configurable: true,
            });
          }

          return originalHandler(...handlerArgs);
        };
      }

      // @ts-expect-error - forward arguments to client
      client.handle(...wrappedArgs);
    });
    return this;
  }
}

/**
 * Creates a standalone, modular `OCPPRouter` instance that can be attached
 * to an `OCPPServer` later via `server.attachRouters()`.
 */
export function createRouter(...patterns: Array<string | RegExp>): OCPPRouter {
  return new OCPPRouter(patterns);
}
