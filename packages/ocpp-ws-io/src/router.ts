import { EventEmitterBase } from "./emitter-base.js";
import type {
  AllMethodNames,
  OCPPRequestType,
  OCPPSendRequestType,
  SendMethodNames,
} from "./generated/index.js";
import { assertUniqueProtocols } from "./protocol-list.js";
import type { AnyOCPPServerClient, OCPPServerClient } from "./server-client.js";
import type {
  AnyOCPPProtocol,
  AuthCallback,
  CheckedHandler,
  CORSOptions,
  ConnectionMiddleware,
  HandleArgs,
  HandlerContext,
  HandlerResult,
  HandlerReturn,
  HandlesByArgs,
  JsonObject,
  KnownProtocol,
  ResponseOf,
  RouterConfig,
  RouterHandlerContext,
  RouterWildcardHandler,
  ServerEvents,
  StrictModeMethodsFor,
  TypedEventEmitter,
  UncheckedAction,
  UncheckedHandler,
  WithUniqueProtocols,
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

    // Attach next to the context. Its promise is kept, so a middleware that
    // calls next() without awaiting or returning it still has the rest of the
    // chain awaited below: a rejection further down reaches the handshake's
    // error handling instead of escaping as an unhandled rejection, which
    // ended the process.
    let downstream: Promise<void> | undefined;
    ctx.next = (nextPayload?: Record<string, unknown>) => {
      downstream = dispatch(i + 1, nextPayload);
      // Handled from the start, in case it rejects while the middleware is
      // still running; the await below still raises the error.
      downstream.catch(() => {});
      return downstream;
    };

    // Call the middleware
    await fn(ctx);
    if (downstream) await downstream;
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
 * A route's handle() arguments: its handlers' contexts have the connection.
 * An action's handler takes `never` params, as in HandleArgs.
 */
type RouteHandleArgs<P extends AnyOCPPProtocol> = HandleArgs<
  RouterWildcardHandler<P>,
  (context: RouterHandlerContext<never, P>) => unknown
>;

/** Gives a handler's context the connection as `ctx.client`. */
function attachClient<T, C>(
  context: HandlerContext<T>,
  client: C,
): asserts context is HandlerContext<T> & { client: C } {
  if (context && typeof context === "object") {
    Object.defineProperty(context, "client", {
      value: client,
      enumerable: true,
      configurable: true,
    });
  }
}

/**
 * A route's handle() arguments as a connection takes them: each handler is
 * wrapped to get the connection as `ctx.client`. Anything else, which only
 * untyped code can pass, goes on unchanged for the connection's handle() to
 * refuse.
 */
function forConnection<P extends AnyOCPPProtocol>(
  args: RouteHandleArgs<P>,
  client: OCPPServerClient<P>,
): HandleArgs {
  if (args.length === 1) {
    const [handler] = args;
    return [
      typeof handler === "function"
        ? (method, context) => {
            attachClient(context, client);
            return handler(method, context);
          }
        : handler,
    ];
  }
  if (args.length === 2) {
    const [method, handler] = args;
    return [
      method,
      typeof handler === "function"
        ? (context) => {
            attachClient(context, client);
            return handler(context);
          }
        : handler,
    ];
  }
  if (args.length === 3) {
    const [version, method, handler] = args;
    return [
      version,
      method,
      typeof handler === "function"
        ? (context) => {
            attachClient(context, client);
            return handler(context);
          }
        : handler,
    ];
  }
  return args;
}

/**
 * OCPPRouter — An Express-like Connection dispatcher.
 * Isolated handler for a specific set of matching URL route patterns.
 *
 * String patterns are matched via radix trie (O(k) lookup, managed by OCPPServer).
 * RegExp patterns fall back to linear matching.
 */
export class OCPPRouter<
  P extends AnyOCPPProtocol = AnyOCPPProtocol,
> extends EventEmitterBase {
  // Typed for this router's protocols; a base class expression cannot use P.
  declare on: TypedEventEmitter<ServerEvents<P>>["on"];
  declare once: TypedEventEmitter<ServerEvents<P>>["once"];
  declare off: TypedEventEmitter<ServerEvents<P>>["off"];
  declare emit: TypedEventEmitter<ServerEvents<P>>["emit"];
  declare addListener: TypedEventEmitter<ServerEvents<P>>["addListener"];
  declare removeListener: TypedEventEmitter<ServerEvents<P>>["removeListener"];
  declare removeAllListeners: TypedEventEmitter<
    ServerEvents<P>
  >["removeAllListeners"];

  /** Raw registered patterns (strings and/or RegExp) for reference. */
  public patterns: Array<string | RegExp>;
  /** Connection middlewares attached to this router. */
  public middlewares: ConnectionMiddleware[];
  /** Auth callback for this route endpoint. */
  public authCallback: AuthCallback<unknown, P> | null = null;
  /** Route-level CORS options. */
  public _routeCORS?: CORSOptions;
  /** Route-level config overrides. */
  public _routeConfig?: RouterConfig<P>;

  /**
   * Compiled RegExp patterns for fallback linear matching.
   * Only populated when RegExp patterns are registered.
   * @internal
   */
  public _regexPatterns: CompiledRegexPattern[] = [];

  /**
   * @internal Set by OCPPServer when the router is registered, so patterns
   * added after registration still reach the trie / regex list.
   */
  _onPatternAdded?: (pattern: string | RegExp) => void;

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
      this._onPatternAdded?.(p);
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
   * Overrides global connection settings (e.g. timeouts, protocols) for this
   * router. Its `protocols` are a subset of the server's, and the router and
   * its connections are typed for them.
   */
  config<Q extends P, const L extends readonly Q[] = readonly Q[]>(
    options: WithUniqueProtocols<RouterConfig<Q>, Q, L> &
      StrictModeMethodsFor<Q>,
  ): OCPPRouter<Q>;
  // The same router; only its type narrows to the route's protocols.
  config(options: RouterConfig<P>): object {
    assertUniqueProtocols(options.protocols);
    this._routeConfig = options;
    return this;
  }

  /**
   * Registers an authentication and protocol-negotiation callback for this route endpoint.
   */
  auth<TSession = Record<string, unknown>>(
    callback: AuthCallback<TSession, P>,
  ): this {
    this.authCallback = callback as AuthCallback<unknown, P>;
    return this;
  }

  // As on the clients: the payload is checked for keys the schema does not
  // define on the action name, and method-only overloads come first so editors
  // suggest the right fields while a handler is being written.

  /**
   * Binds a message handler directly to all clients that match this route using the default protocol.
   * A response with a key the schema does not define is an error.
   *
   * @throws {Error} AT RUNTIME when a client connects, if a handler for this method is already registered for that client.
   */
  handle<
    M extends AllMethodNames<KnownProtocol<P>>,
    R extends HandlerResult<ResponseOf<KnownProtocol<P>, M>>,
  >(
    method: CheckedHandler<M, ResponseOf<KnownProtocol<P>, M>, R>,
    handler: (
      context: RouterHandlerContext<OCPPRequestType<KnownProtocol<P>, M>, P>,
    ) => HandlerReturn<R, ResponseOf<KnownProtocol<P>, M>>,
  ): this;

  /**
   * Binds a handler for an OCPP 2.1 SEND message on the default protocol.
   * Nothing is sent back: `ctx.unconfirmed` is true and the return value is ignored.
   */
  handle<M extends SendMethodNames<KnownProtocol<P>>>(
    method: M,
    handler: (
      context: RouterHandlerContext<
        OCPPSendRequestType<KnownProtocol<P>, M>,
        P
      >,
    ) => void | Promise<void>,
  ): this;

  /**
   * Binds a version-specific OCPP message handler directly to all clients that match this route.
   *
   * @throws {Error} AT RUNTIME when a client connects, if a handler for this version and method is already registered for that client.
   */
  handle<
    V extends KnownProtocol<P>,
    M extends AllMethodNames<V>,
    R extends HandlerResult<ResponseOf<V, M>>,
  >(
    version: V,
    method: CheckedHandler<M, ResponseOf<V, M>, R>,
    handler: (
      context: RouterHandlerContext<OCPPRequestType<V, M>, P>,
    ) => HandlerReturn<R, ResponseOf<V, M>>,
  ): this;

  /**
   * Binds a version-specific handler for an OCPP 2.1 SEND message. Nothing is
   * sent back: `ctx.unconfirmed` is true and the return value is ignored.
   */
  handle<V extends KnownProtocol<P>, M extends SendMethodNames<V>>(
    version: V,
    method: M,
    handler: (
      context: RouterHandlerContext<OCPPSendRequestType<V, M>, P>,
    ) => void | Promise<void>,
  ): this;

  /**
   * Binds a handler for an action the types do not check, such as an
   * undeclared vendor action — `handle(unchecked("VendorPing"), handler)`.
   *
   * @throws {Error} AT RUNTIME when a client connects, if a handler for this method is already registered for that client.
   */
  handle(
    method: UncheckedAction,
    handler: UncheckedHandler<RouterHandlerContext<JsonObject, P>>,
  ): this;

  /**
   * Binds a version-specific handler for an action the types do not check.
   * The version must be one of the route's protocols.
   *
   * @throws {Error} AT RUNTIME when a client connects, if a handler for this version and method is already registered for that client.
   */
  handle(
    version: P,
    method: UncheckedAction,
    handler: UncheckedHandler<RouterHandlerContext<JsonObject, P>>,
  ): this;

  /**
   * Binds a wildcard handler to all clients that match this route.
   *
   * @throws {Error} AT RUNTIME when a client connects, if a wildcard handler is already registered for that client.
   */
  handle(handler: RouterWildcardHandler<P>): this;

  handle(...args: RouteHandleArgs<P>): this {
    this.on("client", (client) => {
      (client as HandlesByArgs).handle(...forConnection(args, client));
    });
    return this;
  }

  /**
   * @internal Hands this router a connection the server accepted on it. The
   * server holds routers of every protocol set, so it cannot call the typed
   * emit itself; the connection speaks one of this router's protocols.
   */
  _emitClient(client: AnyOCPPServerClient): void {
    this.emit("client", client as OCPPServerClient<P>);
  }
}

/** The members of OCPPRouter whose types follow its protocols. */
type ProtocolTypedMember =
  | "handle"
  | "auth"
  | "config"
  | "route"
  | "use"
  | "cors"
  | "on"
  | "once"
  | "off"
  | "emit"
  | "addListener"
  | "removeListener"
  | "removeAllListeners";

/**
 * Any router, whatever its protocols: what OCPPServer keeps, and what
 * `attachRouters()` takes.
 */
export type AnyOCPPRouter = Omit<OCPPRouter, ProtocolTypedMember>;

/**
 * Creates a standalone, modular `OCPPRouter` instance that can be attached
 * to an `OCPPServer` later via `server.attachRouters()`.
 */
export function createRouter(...patterns: Array<string | RegExp>): OCPPRouter {
  return new OCPPRouter(patterns);
}
