// ─── Core ────────────────────────────────────────────────────────
export { OCPPClient } from "./client.js";
export { OCPPServer } from "./server.js";
export { OCPPServerClient } from "./server-client.js";

// ─── Validation ──────────────────────────────────────────────────
export { Validator, createValidator } from "./validator.js";
export { standardValidators } from "./standard-validators.js";

// ─── Utilities ───────────────────────────────────────────────────
export {
  createRPCError,
  getErrorPlainObject,
  getPackageIdent,
} from "./util.js";

// ─── Adapters ────────────────────────────────────────────────────
export { InMemoryAdapter } from "./adapters/adapter.js";

// ─── Errors ──────────────────────────────────────────────────────
export {
  TimeoutError,
  UnexpectedHttpResponse,
  WebsocketUpgradeError,
  type RPCError,
  RPCGenericError,
  RPCNotImplementedError,
  RPCNotSupportedError,
  RPCInternalError,
  RPCProtocolError,
  RPCSecurityError,
  RPCFormationViolationError,
  RPCFormatViolationError,
  RPCPropertyConstraintViolationError,
  RPCOccurrenceConstraintViolationError,
  RPCTypeConstraintViolationError,
  RPCMessageTypeNotSupportedError,
  RPCFrameworkError,
} from "./errors.js";

// ─── Types ───────────────────────────────────────────────────────
export {
  ConnectionState,
  SecurityProfile,
  MessageType,
  NOREPLY,
  type OCPPProtocol,
  type AnyOCPPProtocol,
  type OCPPCall,
  type OCPPCallResult,
  type OCPPCallError,
  type OCPPMessage,
  type TLSOptions,
  type HandlerContext,
  type CallHandler,
  type WildcardHandler,
  type CallOptions,
  type CloseOptions,
  type HandshakeInfo,
  type SessionData,
  type ClientOptions,
  type ServerOptions,
  type ListenOptions,
  type AuthAccept,
  type AuthCallback,
  type ClientEvents,
  type ServerEvents,
  type EventAdapterInterface,
  type TypedEventEmitter,
  type LoggerLike,
  type LoggingConfig,
} from "./types.js";

// ─── Generated OCPP Protocol Types ──────────────────────────────
export type {
  OCPPMethodMap,
  OCPPProtocolKey,
  AllMethodNames,
  OCPPRequestType,
  OCPPResponseType,
} from "./generated/index.js";
export type { OCPP16Methods } from "./generated/ocpp16.js";
export type { OCPP201Methods } from "./generated/ocpp201.js";
export type { OCPP21Methods } from "./generated/ocpp21.js";
