/** OCPP protocols, message frames and the types derived from the method maps. */
import type {
  AllMethodNames,
  OCPPMethodMap,
  OCPPProtocolKey,
  OCPPSendMethodMap,
  SendMethodNames,
} from "../generated/index.js";
import type { HandlerContext } from "./handlers.js";
import type { JsonObject } from "./json.js";

// ─── OCPP Protocol ───────────────────────────────────────────────

export type OCPPProtocol = OCPPProtocolKey;
export type AnyOCPPProtocol = OCPPProtocol | (string & {});
/**
 * The protocols among P that have types: the OCPP versions and any custom
 * protocol declared in `OCPPMethodMap`. A plain `string`, a protocol list only
 * known at runtime, stands for every one of them.
 */
export type KnownProtocol<P extends AnyOCPPProtocol> = string extends P
  ? OCPPProtocol
  : Extract<P, OCPPProtocol>;
/**
 * T where TypeScript does not infer from: a list such as `strictMode` is then
 * checked against the configured protocols instead of adding to them.
 */
export type Configured<T> = NoInfer<T>;
/**
 * An action strict mode can be limited to (`strictModeMethods`): a CALL action
 * or SEND message of P's protocols (by default every declared one), or an
 * `unchecked()` name.
 */
export type StrictModeMethod<P extends AnyOCPPProtocol = AnyOCPPProtocol> =
  | AllMethodNames<KnownProtocol<P>>
  | SendMethodNames<KnownProtocol<P>>
  | UncheckedAction;
/**
 * The `strictModeMethods` a constructor or a route's `config()` takes: the
 * configured protocols' actions. Checked there rather than in the options
 * types a client or server keeps: TypeScript cannot tell that a protocol's
 * action names grow with the protocols, so options typed that way would stop
 * a typed client fitting a plain `OCPPClient`. `reconfigure()` takes any
 * declared action.
 */
export type StrictModeMethodsFor<P extends AnyOCPPProtocol> = {
  strictModeMethods?: readonly Configured<StrictModeMethod<P>>[];
};
/**
 * The connection type of a server or route, for storing its connections:
 * `new Map<string, ConnectionOf<typeof server>>()`.
 */
export type ConnectionOf<S> =
  S extends import("../server/server.js").OCPPServer<
    infer P extends AnyOCPPProtocol
  >
    ? import("../server/server-client.js").OCPPServerClient<P>
    : S extends import("../server/router.js").OCPPRouter<
          infer P extends AnyOCPPProtocol
        >
      ? import("../server/server-client.js").OCPPServerClient<P>
      : never;
// ─── Connection State ────────────────────────────────────────────

export const ConnectionState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;
export type ConnectionState =
  (typeof ConnectionState)[keyof typeof ConnectionState];
// ─── Security Profiles (OCPP Spec) ──────────────────────────────

export enum SecurityProfile {
  /** No security — plain WS, no auth (dev/testing only) */
  NONE = 0,
  /** Profile 1: Basic Auth over unsecured WS (ws://) — password-based */
  BASIC_AUTH = 1,
  /** Profile 2: TLS + Basic Auth (wss://) — server cert + password */
  TLS_BASIC_AUTH = 2,
  /** Profile 3: Mutual TLS (wss://) — client + server certificates */
  TLS_CLIENT_CERT = 3,
}
// ─── Message Types ───────────────────────────────────────────────

/**
 * RPC message type numbers. CALLRESULTERROR and SEND exist only in OCPP 2.1;
 * on older protocols they are unknown message types and are ignored.
 */
export const MessageType = {
  CALL: 2,
  CALLRESULT: 3,
  CALLERROR: 4,
  CALLRESULTERROR: 5,
  SEND: 6,
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];
// ─── OCPP Message Tuples ─────────────────────────────────────────

export type OCPPCall<T = unknown> = [2, string, string, T];
export type OCPPCallResult<T = unknown> = [3, string, T];
export type OCPPCallError = [
  4,
  string,
  string,
  string,
  Record<string, unknown>,
];
/** OCPP 2.1: sent back when a received CALLRESULT could not be processed. */
export type OCPPCallResultError = [
  5,
  string,
  string,
  string,
  Record<string, unknown>,
];
/** OCPP 2.1: an unconfirmed message that is never answered. */
export type OCPPSend<T = unknown> = [6, string, string, T];
export type OCPPMessage<T = unknown> =
  | OCPPCall<T>
  | OCPPCallResult<T>
  | OCPPCallError
  | OCPPCallResultError
  | OCPPSend<T>;
// ─── Message IDs ─────────────────────────────────────────────────

/**
 * Creates the message ID of an outgoing CALL or SEND. The ID must differ from
 * every ID this side has used for the same charging station, across
 * reconnects too (OCPP-J §4.1.4, 2.0.1 errata 2023-12), and should be at most
 * 36 characters. A call rejects when it returns an empty or non-string value,
 * or an ID that a pending call already uses.
 */
export type MessageIdGenerator = () => string;
/**
 * Decides whether the message ID of an incoming CALL or SEND is acceptable.
 * Return `false` (or throw) to reject it: a CALL is then answered under
 * message ID `"-1"` with `RpcFrameworkError` (`GenericError` on OCPP 1.6),
 * a SEND is not answered, and both count as bad messages.
 */
export type MessageIdValidator = (messageId: string) => boolean;
// ─── Symbols ─────────────────────────────────────────────────────

export const NOREPLY: unique symbol = Symbol("NOREPLY");
// ─── Unchecked actions ───────────────────────────────────────────

declare const uncheckedAction: unique symbol;
/**
 * An action name the types do not check, from {@link unchecked}. Typed methods
 * take only the actions their protocols define; this is the explicit way to
 * use one they do not, such as an undeclared vendor action or a name passed
 * through from the wire.
 */
export type UncheckedAction = string & { readonly [uncheckedAction]: true };
// ─── Unique protocols ────────────────────────────────────────────

/** The type a protocol listed twice gets in its position: the error says why. */
type ListedTwice<H> = { readonly "Error: protocol listed more than once": H };
/**
 * A `protocols` list, checked for a protocol listed twice: the repeat gets
 * {@link ListedTwice}, so the error is on it. Constructors take
 * `L & UniqueProtocols<L>`, with L the list as a tuple. A list known only at
 * runtime (`string[]`) is not a tuple and passes; the constructor throws for
 * it instead.
 */
export type UniqueProtocols<
  L extends readonly unknown[],
  Seen = never,
> = L extends readonly [infer H, ...infer Rest]
  ? readonly [
      [H] extends [Seen] ? ListedTwice<H> : H,
      ...UniqueProtocols<Rest, Seen | H>,
    ]
  : L;
/**
 * Options whose `protocols` is also inferred as the tuple L, so a protocol
 * listed twice can be reported.
 */
export type WithUniqueProtocols<O, P extends AnyOCPPProtocol, L> = O & {
  protocols?: L &
    readonly P[] &
    (L extends readonly unknown[] ? UniqueProtocols<L> : unknown);
};
// Payload types by indexed access. While TypeScript infers a call, the action
// is still open, and resolving the conditional OCPPRequestType and
// OCPPResponseType for an open action distributes over every action of every
// version: for three versions that exceeds the compiler's instantiation limit
// (TS2589) and loses literal types such as `status: "Accepted"`. An indexed
// access resolves without distributing. For a given action they are the same
// types.

type MethodEntry<V extends keyof OCPPMethodMap, M> = OCPPMethodMap[V][M &
  keyof OCPPMethodMap[V]];
/** Response of action M in each of the versions V that defines it. */
export type ResponseOf<
  V extends keyof OCPPMethodMap,
  M,
> = V extends keyof OCPPMethodMap
  ? MethodEntry<V, M>["response" & keyof MethodEntry<V, M>]
  : never;
/** Request of action M in each of the versions V that defines it. */
export type RequestOf<
  V extends keyof OCPPMethodMap,
  M,
> = V extends keyof OCPPMethodMap
  ? MethodEntry<V, M>["request" & keyof MethodEntry<V, M>]
  : never;
type SendEntry<V extends keyof OCPPSendMethodMap, M> = OCPPSendMethodMap[V][M &
  keyof OCPPSendMethodMap[V]];
/** Payload of SEND message M in each of the versions V that defines it. */
export type SendRequestOf<V, M> = V extends keyof OCPPSendMethodMap
  ? SendEntry<V, M>["request" & keyof SendEntry<V, M>]
  : never;
/**
 * Handler for an action the types do not check. A CALL is answered with the
 * object it returns, or not at all with `NOREPLY`.
 */
export type UncheckedHandler<TContext = HandlerContext<JsonObject>> = (
  context: TContext,
) => object | typeof NOREPLY | Promise<object | typeof NOREPLY>;
