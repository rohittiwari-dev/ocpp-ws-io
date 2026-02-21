import type { RPCError } from "./errors.js";
import * as errors from "./errors.js";

export { NOOP_LOGGER } from "../util.js";

// ─── RPC Error Factory ──────────────────────────────────────────

const RPC_ERROR_REGISTRY = new Map<
  string,
  new (
    message?: string,
    details?: Record<string, unknown>,
  ) => RPCError
>([
  ["GenericError", errors.RPCGenericError],
  ["RpcFrameworkError", errors.RPCFrameworkError],
  ["MessageTypeNotSupported", errors.RPCMessageTypeNotSupportedError],
  ["NotImplemented", errors.RPCNotImplementedError],
  ["NotSupported", errors.RPCNotSupportedError],
  ["InternalError", errors.RPCInternalError],
  ["ProtocolError", errors.RPCProtocolError],
  ["SecurityError", errors.RPCSecurityError],
  ["FormatViolation", errors.RPCFormatViolationError],
  ["FormationViolation", errors.RPCFormationViolationError],
  ["PropertyConstraintViolation", errors.RPCPropertyConstraintViolationError],
  [
    "OccurrenceConstraintViolation",
    errors.RPCOccurrenceConstraintViolationError,
  ],
  ["TypeConstraintViolation", errors.RPCTypeConstraintViolationError],
]);

/**
 * Instantiate a typed RPCError from a string error code.
 * Returns an RPCGenericError if the code is not recognized.
 */
export function createRPCError(
  code: string,
  message?: string,
  details: Record<string, unknown> = {},
): RPCError {
  const Ctor = RPC_ERROR_REGISTRY.get(code) ?? errors.RPCGenericError;
  return new Ctor(message, details);
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
