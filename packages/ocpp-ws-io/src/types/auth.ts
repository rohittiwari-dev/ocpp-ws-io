/** Auth callbacks and connection middleware contexts. */
import type { HandshakeInfo } from "./handshake.js";
import type { AnyOCPPProtocol } from "./protocol.js";
import type { SessionData } from "./session.js";

// ─── Auth Callback ───────────────────────────────────────────────

export interface AuthAccept<
  TSession = SessionData,
  P extends AnyOCPPProtocol = AnyOCPPProtocol,
> {
  /** Subprotocol to use for this client */
  protocol?: P;
  /** Session data for the connection, over what `ctx.state` and the stored session hold. */
  session?: TSession;
  /**
   * Override the connection identity.
   *
   * By default the identity is the `:identity` route param, falling back to the
   * last path segment. That is the charge point id alone, so two chargers with
   * the same station id on different paths — `/tenant-a/CP001` and
   * `/tenant-b/CP001` — collide: they share a `_clientsByIdentity` entry, share
   * a cluster presence key, and the second connection evicts the first.
   *
   * Namespace it here when a single server serves more than one tenant:
   *
   * ```ts
   * server.route("/:tenant/:identity").auth((ctx) => {
   *   ctx.accept({ identity: `${ctx.handshake.params.tenant}:${ctx.handshake.params.identity}` });
   * });
   * ```
   *
   * The value is used for routing, presence and session storage, so it must be
   * unique across the whole cluster.
   */
  identity?: string;
}
export type AuthCallback<
  TSession = SessionData,
  P extends AnyOCPPProtocol = AnyOCPPProtocol,
> = (ctx: AuthContext<TSession, P>) => void | Promise<void>;
export type RoutePattern = string | RegExp;
export interface AuthRoute {
  pattern: RoutePattern | null; // null represents the default fallback route
  handler: AuthCallback;
}
// ─── Router Component Types ──────────────────────────────────────────

export interface BaseConnectionContext {
  /** The handshake info from the upgrading WebSocket request */
  handshake: HandshakeInfo;
  /**
   * Data passed between middlewares and the auth callback (e.g. auth
   * tokens). It becomes the start of the connection's session (OCPPSession),
   * so its values are JSON.
   */
  state: SessionData;
  /** Safely reject the WebSocket connection explicitly with an HTTP code and reason */
  reject: (code?: number, message?: string) => never;
}
export interface ConnectionContext extends BaseConnectionContext {
  /** Triggers the next middleware in the execution chain, optionally merging a payload into ctx.state and then client.session in the chain*/
  next: (payload?: SessionData) => Promise<void>;
}
export interface AuthContext<
  TSession = SessionData,
  P extends AnyOCPPProtocol = AnyOCPPProtocol,
> extends BaseConnectionContext {
  /** The AbortSignal representing if the client abruptly closed the underlying socket */
  signal: AbortSignal;
  /**
   * Grants the connection and optionally sets the negotiated protocol or session metadata.
   *
   * A method, not a property: an `AuthCallback` written for every protocol
   * (from `defineAuth`, `combineAuth`, or typed `AuthCallback`) then still
   * fits a server or route typed for fewer. A protocol the charger did not
   * offer is refused at runtime.
   */
  accept(options?: AuthAccept<TSession, P>): void;
}
export type ConnectionMiddleware = (
  ctx: ConnectionContext,
) => Promise<void> | void;
