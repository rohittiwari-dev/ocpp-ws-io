/**
 * The library's public types, one file per subject. This file re-exports
 * exactly the names that are public; a helper shared between two of the
 * files stays internal.
 */

export type { MiddlewareFunction, MiddlewareNext } from "../core/middleware.js";
export type {
  AllMethodNames,
  OCPPMethodMap,
  OCPPProtocolKey,
  OCPPRequestType,
  OCPPResponseType,
  OCPPSendMethodMap,
  OCPPSendRequestType,
  SendMethodNames,
} from "../generated/index.js";
export type { EventAdapterInterface } from "./adapter.js";
export type {
  AuthAccept,
  AuthCallback,
  AuthContext,
  AuthRoute,
  BaseConnectionContext,
  ConnectionContext,
  ConnectionMiddleware,
  RoutePattern,
} from "./auth.js";
export type { CallOptions, CloseOptions, NoReplyCallOptions } from "./calls.js";
export type { ClientOptions } from "./client.js";
export type {
  BroadcastResult,
  ClientEvents,
  MessageDirection,
  MessageEventContext,
  MessageEventPayload,
  SecurityEvent,
  ServerEvents,
  TypedEventEmitter,
} from "./events.js";
export type {
  BatchCall,
  BatchExactKeys,
  BatchResult,
  CheckedAction,
  CheckedHandler,
  ExactKeys,
  HandlerResult,
  HandlerReturn,
} from "./exact-keys.js";
export type {
  CallHandler,
  HandleArgs,
  HandlerContext,
  HandlesByArgs,
  PlainSendArgs,
  RouteHandleArgs,
  RouterHandlerContext,
  RouterWildcardHandler,
  RoutesByArgs,
  SendsToClientByArgs,
  SendToClientArgs,
  VersionNamedSendArgs,
  WildcardHandler,
} from "./handlers.js";
export type {
  DuplicateConnectionPolicy,
  HandshakeInfo,
  IdentityLookup,
} from "./handshake.js";
export type { JsonObject, JsonValue } from "./json.js";
export type {
  LoggerLike,
  LoggerLikeNotOptional,
  LoggingConfig,
} from "./logger.js";
export type { MiddlewareContext, WireCall } from "./middleware.js";
export type { OCPPPlugin, PluginHookResult } from "./plugins.js";
export type {
  AnyOCPPProtocol,
  ConnectionOf,
  KnownProtocol,
  MessageIdGenerator,
  MessageIdValidator,
  OCPPCall,
  OCPPCallError,
  OCPPCallResult,
  OCPPCallResultError,
  OCPPMessage,
  OCPPProtocol,
  OCPPSend,
  RequestOf,
  ResponseOf,
  SendRequestOf,
  StrictModeMethod,
  StrictModeMethodsFor,
  UncheckedAction,
  UncheckedHandler,
  UniqueProtocols,
  WithUniqueProtocols,
} from "./protocol.js";
export {
  ConnectionState,
  MessageType,
  NOREPLY,
  SecurityProfile,
} from "./protocol.js";
export type {
  CORSOptions,
  HealthEndpointAuth,
  HealthEndpointBasicAuth,
  HealthEndpointBearerAuth,
  HealthEndpointOptions,
  ListenOptions,
  OCPPServerStats,
  RateLimitOptions,
  RouterConfig,
  ServerOptions,
  TelemetryConfig,
} from "./server.js";
export type {
  OCPPSession,
  PersistedSession,
  SessionData,
  SessionValue,
} from "./session.js";
export type {
  CompressionOptions,
  ManagedWsClientOption,
  ManagedWsServerOption,
  TLSOptions,
  WsClientOptions,
  WsServerOptions,
} from "./transport.js";
