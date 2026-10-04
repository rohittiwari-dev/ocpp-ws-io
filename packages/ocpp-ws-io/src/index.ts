// ─── Core ────────────────────────────────────────────────────────

// ─── Adapters ────────────────────────────────────────────────────
export { defineAdapter, InMemoryAdapter } from "./adapters/adapter.js";
export {
  ClusterDriver,
  type ClusterDriverOptions,
  type ClusterNode,
} from "./adapters/redis/cluster-driver.js";
export { RedisAdapter } from "./adapters/redis/index.js";
export type {
  AdaptedEvent,
  AdaptiveLimiterOptions,
} from "./adaptive-limiter.js";
// ─── Adaptive Rate Limiting ──────────────────────────────────────
export { AdaptiveLimiter } from "./adaptive-limiter.js";
export { type AnyOCPPClient, OCPPClient } from "./client.js";
// ─── Errors ──────────────────────────────────────────────────────
export {
  type RPCError,
  RPCFormationViolationError,
  RPCFormatViolationError,
  RPCFrameworkError,
  RPCGenericError,
  RPCInternalError,
  RPCMessageTypeNotSupportedError,
  RPCNotImplementedError,
  RPCNotSupportedError,
  RPCOccurenceConstraintViolationError,
  RPCOccurrenceConstraintViolationError,
  RPCPropertyConstraintViolationError,
  RPCProtocolError,
  RPCSecurityError,
  RPCTypeConstraintViolationError,
  TimeoutError,
  UnexpectedHttpResponse,
  WebsocketUpgradeError,
} from "./errors.js";
// ─── Generated OCPP Protocol Types ──────────────────────────────
export type {
  AllMethodNames,
  OCPPMethodMap,
  OCPPProtocolKey,
  OCPPRequestType,
  OCPPResponseType,
  OCPPSendMethodMap,
  OCPPSendRequestType,
  SendMethodNames,
} from "./generated/index.js";
export type {
  OCPP16Methods,
  OCPP16SendMethods,
} from "./generated/ocpp16.js";
export type {
  OCPP21Methods,
  OCPP21SendMethods,
} from "./generated/ocpp21.js";
export type {
  OCPP201Methods,
  OCPP201SendMethods,
} from "./generated/ocpp201.js";
export {
  combineAuth,
  createLoggingMiddleware,
  createPlugin,
  defineAuth,
  defineMiddleware,
  defineRpcMiddleware,
} from "./helpers/index.js";
export { LRUMap } from "./lru-map.js";
export * from "./middleware.js";
export { createRouter, OCPPRouter } from "./router.js";
export { OCPPServer } from "./server.js";
export { type AnyOCPPServerClient, OCPPServerClient } from "./server-client.js";
export {
  getStandardProtocols,
  getStandardValidator,
  getStandardValidators,
} from "./standard-validators.js";
// ─── Types ───────────────────────────────────────────────────────
export {
  type AnyOCPPProtocol,
  type AuthAccept,
  type AuthCallback,
  type AuthContext,
  type CallHandler,
  type CallOptions,
  type ClientEvents,
  type ClientOptions,
  type CloseOptions,
  type CORSOptions,
  type CompressionOptions,
  type ConnectionContext,
  type ConnectionMiddleware,
  type ConnectionOf,
  ConnectionState,
  type DuplicateConnectionPolicy,
  type EventAdapterInterface,
  type HandlerContext,
  type HandshakeInfo,
  type HealthEndpointAuth,
  type HealthEndpointBasicAuth,
  type HealthEndpointBearerAuth,
  type HealthEndpointOptions,
  type IdentityLookup,
  type JsonObject,
  type JsonValue,
  type KnownProtocol,
  type ListenOptions,
  type LoggerLike,
  type LoggingConfig,
  type ManagedWsClientOption,
  type ManagedWsServerOption,
  type MessageDirection,
  type MessageEventContext,
  type MessageEventPayload,
  type MessageIdGenerator,
  type MessageIdValidator,
  MessageType,
  NOREPLY,
  type NoReplyCallOptions,
  type OCPPCall,
  type OCPPCallError,
  type OCPPCallResult,
  type OCPPCallResultError,
  type OCPPMessage,
  type OCPPPlugin,
  type OCPPProtocol,
  type OCPPSend,
  type OCPPServerStats,
  type OCPPSession,
  type PersistedSession,
  type RateLimitOptions,
  type RouterConfig,
  type SecurityEvent,
  SecurityProfile,
  type ServerEvents,
  type ServerOptions,
  type SessionData,
  type SessionValue,
  type TelemetryConfig,
  type TLSOptions,
  type TypedEventEmitter,
  type UncheckedAction,
  type UncheckedHandler,
  type WildcardHandler,
  type WireCall,
  type WsClientOptions,
  type WsServerOptions,
} from "./types.js";
// ─── Utilities ───────────────────────────────────────────────────
export { unchecked } from "./unchecked.js";
export {
  createRPCError,
  getErrorPlainObject,
  getPackageIdent,
  sessionOf,
} from "./util.js";
// ─── Validation ──────────────────────────────────────────────────
export { createValidator, Validator } from "./validator.js";
