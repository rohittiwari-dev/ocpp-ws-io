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
