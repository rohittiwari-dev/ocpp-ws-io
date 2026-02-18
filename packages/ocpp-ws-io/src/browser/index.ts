// ─── Core ────────────────────────────────────────────────────────
export { BrowserOCPPClient } from "./client.js";

// ─── Errors ──────────────────────────────────────────────────────
export {
  TimeoutError,
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

// ─── Utilities ───────────────────────────────────────────────────
export { createRPCError, getErrorPlainObject } from "./util.js";

// ─── Types ───────────────────────────────────────────────────────
export {
  ConnectionState,
  MessageType,
  NOREPLY,
  type OCPPProtocol,
  type AnyOCPPProtocol,
  type OCPPCall,
  type OCPPCallResult,
  type OCPPCallError,
  type OCPPMessage,
  type HandlerContext,
  type CallHandler,
  type WildcardHandler,
  type CallOptions,
  type CloseOptions,
  type BrowserClientOptions,
  type BrowserClientEvents,
  type AllMethodNames,
  type OCPPRequestType,
  type OCPPResponseType,
} from "./types.js";
