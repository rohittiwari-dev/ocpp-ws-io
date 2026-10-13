/**
 * A route's handler types: their context has the connection. Apart from
 * `handlers.ts` because the connection is the server's class, which names
 * Node's types, and the browser entry's declarations use `handlers.ts`.
 */
import type { HandleArgs, HandlerContext } from "./handlers.js";
import type { AnyOCPPProtocol } from "./protocol.js";

export interface RouterHandlerContext<
  T = unknown,
  P extends AnyOCPPProtocol = AnyOCPPProtocol,
> extends HandlerContext<T> {
  /** The specific server client that issued the message. */
  client: import("../server/server-client.js").OCPPServerClient<P>;
}
/** A route's wildcard handler: its context has the connection, typed for P. */
export type RouterWildcardHandler<P extends AnyOCPPProtocol = AnyOCPPProtocol> =
  (context: RouterHandlerContext<unknown, P>) => unknown | Promise<unknown>;
/**
 * A route's `handle()` arguments: its handlers' contexts have the connection.
 * An action's handler takes `never` params, as in HandleArgs.
 * @internal
 */
export type RouteHandleArgs<P extends AnyOCPPProtocol> = HandleArgs<
  RouterWildcardHandler<P>,
  (context: RouterHandlerContext<never, P>) => unknown
>;
/**
 * A route's `handle()` by its implementation's arguments, for code that
 * registers handlers named only at runtime: the NestJS explorer, from its
 * decorators' metadata.
 * @internal
 */
export interface RoutesByArgs {
  handle(...args: RouteHandleArgs<AnyOCPPProtocol>): unknown;
}
