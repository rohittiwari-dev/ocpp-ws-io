/** Handlers and the argument forms of handle() and sendToClient(). */
import type { CallOptions } from "./calls.js";
import type { AnyOCPPProtocol } from "./protocol.js";

// ─── Handler Types ───────────────────────────────────────────────

export interface HandlerContext<T = unknown> {
  /** Unique message ID */
  messageId: string;
  /** OCPP method name (e.g. "BootNotification") */
  method: string;
  /** Active OCPP protocol version (e.g. "ocpp1.6") */
  protocol: string | undefined;
  /** Request parameters */
  params: T;
  /** Abort signal */
  signal: AbortSignal;
  /**
   * True for an OCPP 2.1 SEND message. Nothing is sent back for it: the
   * handler's return value is ignored and a thrown error is only logged.
   */
  unconfirmed?: boolean;
}
export type CallHandler<TParams = unknown, TResult = unknown> = (
  context: HandlerContext<TParams>,
) => TResult | Promise<TResult>;
export type WildcardHandler = (
  context: HandlerContext,
) => unknown | Promise<unknown>;
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
 * `handle()`'s arguments as its implementation reads them, whichever overload
 * was called: a wildcard handler, an action and its handler, or a version, an
 * action and its handler. The handler types are a client's by default, or a
 * route's. An action's handler is typed for that action's params, so here
 * it takes `never`: any of them fits, and none can be called with params
 * TypeScript has not checked.
 * @internal
 */
export type HandleArgs<
  TWildcard = WildcardHandler,
  THandler = CallHandler<never>,
> =
  | [handler: TWildcard]
  | [method: string, handler: THandler]
  | [version: string, method: string, handler: THandler];
/**
 * A client's `handle()` by its implementation's arguments, for code that
 * passes `handle()` arguments on: a route, to each of its connections.
 * @internal
 */
export interface HandlesByArgs {
  handle(...args: HandleArgs): void;
}
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
/** `sendToClient()`'s arguments naming an action. @internal */
export type PlainSendArgs = [
  identity: string,
  method: string,
  params?: object,
  options?: CallOptions,
];
/** `sendToClient()`'s arguments naming a version and then an action. @internal */
export type VersionNamedSendArgs = [
  identity: string,
  version: string,
  method: string,
  params?: object,
  options?: CallOptions,
];
/**
 * `sendToClient()`'s arguments as its implementation reads them, whichever
 * overload was called.
 * @internal
 */
export type SendToClientArgs = PlainSendArgs | VersionNamedSendArgs;
/**
 * A server's `sendToClient()` and `safeSendToClient()` by their
 * implementation's arguments, for a framework binding that passes its own on.
 * @internal
 */
export interface SendsToClientByArgs {
  sendToClient(...args: SendToClientArgs): Promise<unknown>;
  safeSendToClient(...args: SendToClientArgs): Promise<unknown>;
}
