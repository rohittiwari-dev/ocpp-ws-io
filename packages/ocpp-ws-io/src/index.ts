// ─── Core ────────────────────────────────────────────────────────

// ─── Adapters ────────────────────────────────────────────────────
export { InMemoryAdapter } from "./adapters/adapter.js";
export { RedisAdapter } from "./adapters/redis/index.js";

export { OCPPClient } from "./client.js";
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
} from "./generated/index.js";
export type { OCPP16Methods } from "./generated/ocpp16.js";
export type { OCPP21Methods } from "./generated/ocpp21.js";
export type { OCPP201Methods } from "./generated/ocpp201.js";
export {
  combineAuth,
  createLoggingMiddleware,
  defineAuth,
  defineMiddleware,
  defineRpcMiddleware,
} from "./helpers/index.js";
export * from "./middleware.js";
export { OCPPRouter } from "./router.js";
export { OCPPServer } from "./server.js";
export { OCPPServerClient } from "./server-client.js";
export { standardValidators } from "./standard-validators.js";
// ─── Types ───────────────────────────────────────────────────────
export {
  type AnyOCPPProtocol,
  type AuthAccept,
  type AuthCallback,
  type CallHandler,
  type CallOptions,
  type ClientEvents,
  type ClientOptions,
  type CloseOptions,
  type ConnectionContext,
  type ConnectionMiddleware,
  ConnectionState,
  type CORSOptions,
  type EventAdapterInterface,
  type HandlerContext,
  type HandshakeInfo,
  type ListenOptions,
  type LoggerLike,
  type LoggingConfig,
  MessageType,
  NOREPLY,
  type OCPPCall,
  type OCPPCallError,
  type OCPPCallResult,
  type OCPPMessage,
  type OCPPProtocol,
  type RouterConfig,
  SecurityProfile,
  type ServerEvents,
  type ServerOptions,
  type SessionData,
  type TLSOptions,
  type TypedEventEmitter,
  type WildcardHandler,
} from "./types.js";
// ─── Utilities ───────────────────────────────────────────────────
export {
  createRPCError,
  getErrorPlainObject,
  getPackageIdent,
} from "./util.js";
// ─── Validation ──────────────────────────────────────────────────
export { createValidator, Validator } from "./validator.js";
