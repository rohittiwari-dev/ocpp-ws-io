import type { RPCError } from "./errors.js";
import * as errors from "./errors.js";

export { NOOP_LOGGER } from "../util.js";

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
 * Convert an Error into a plain, JSON-safe object.
 */
export function getErrorPlainObject(err: Error): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const prop of ERROR_PROPERTIES) {
    const value = (err as unknown as Record<string, unknown>)[prop];
    if (value !== undefined) {
      if (typeof value === "function" || typeof value === "symbol") continue;

      if (typeof value === "object" && value !== null) {
        try {
          JSON.stringify(value);
          result[prop] = value;
        } catch {
          // Skip non-serializable
        }
      } else {
        result[prop] = value;
      }
    }
  }

  if (!result.name) result.name = err.name;
  if (!result.message) result.message = err.message;

  return result;
}
