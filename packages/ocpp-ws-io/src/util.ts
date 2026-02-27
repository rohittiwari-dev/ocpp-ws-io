import type { RPCError } from "./errors.js";
import * as errors from "./errors.js";
import type { LoggerLikeNotOptional } from "./types.js";

// ─── RPC Error Factory ──────────────────────────────────────────

export function createRPCError(
  code: string,
  message?: string,
  details: Record<string, unknown> = {},
): RPCError {
  switch (code) {
    case "GenericError":
      return new errors.RPCGenericError(message, details);
    case "RpcFrameworkError":
      return new errors.RPCFrameworkError(message, details);
    case "MessageTypeNotSupported":
      return new errors.RPCMessageTypeNotSupportedError(message, details);
    case "NotImplemented":
      return new errors.RPCNotImplementedError(message, details);
    case "NotSupported":
      return new errors.RPCNotSupportedError(message, details);
    case "InternalError":
      return new errors.RPCInternalError(message, details);
    case "ProtocolError":
      return new errors.RPCProtocolError(message, details);
    case "SecurityError":
      return new errors.RPCSecurityError(message, details);
    case "FormatViolation":
      return new errors.RPCFormatViolationError(message, details);
    case "FormationViolation":
      return new errors.RPCFormationViolationError(message, details);
    case "PropertyConstraintViolation":
      return new errors.RPCPropertyConstraintViolationError(message, details);
    case "OccurrenceConstraintViolation":
      return new errors.RPCOccurrenceConstraintViolationError(message, details);
    case "TypeConstraintViolation":
      return new errors.RPCTypeConstraintViolationError(message, details);
    default:
      return new errors.RPCGenericError(message, details);
  }
}

// ─── Error Serialization ────────────────────────────────────────

/**
 * Known error properties to extract, in a defined order.
 * This covers standard Error fields plus common OCPP RPC fields.
 */
const ERROR_PROPERTIES = [
  "name",
  "message",
  "stack",
  "code",
  "rpcErrorCode",
  "rpcErrorMessage",
  "details",
] as const;

/**
 * Convert an Error (or subclass) into a plain, JSON-safe object.
 *
 * Extracts well-known properties explicitly rather than relying on
 * Object.getOwnPropertyNames to avoid exposing internal fields and
 * to guarantee a stable output shape.
 *
 * If a property holds a non-serializable value (functions, symbols,
 * circular references), it is silently skipped.
 */
export function getErrorPlainObject(err: Error): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const prop of ERROR_PROPERTIES) {
    const value = (err as unknown as Record<string, unknown>)[prop];
    if (value !== undefined) {
      // Skip functions and symbols — they aren't JSON-serializable
      if (typeof value === "function" || typeof value === "symbol") continue;

      // Test serializability for complex values
      if (typeof value === "object" && value !== null) {
        try {
          JSON.stringify(value);
          result[prop] = value;
        } catch {
          // Skip non-serializable properties (circular refs, etc.)
        }
      } else {
        result[prop] = value;
      }
    }
  }

  // Ensure we always have at least name and message
  if (!result.name) result.name = err.name;
  if (!result.message) result.message = err.message;

  return result;
}

// ─── Package Identity ───────────────────────────────────────────

const PKG_NAME = "ocpp-ws-io";
const PKG_VERSION = "1.0.1";

/**
 * Get the package identifier string used in HTTP headers and logging.
 * Format: `ocpp-ws-io/1.0.0`
 */
export function getPackageIdent(): string {
  return `${PKG_NAME}/${PKG_VERSION}`;
}

/* 
  No-op logger for when logging is disabled.
  
*/
export const NOOP_LOGGER: LoggerLikeNotOptional = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};
