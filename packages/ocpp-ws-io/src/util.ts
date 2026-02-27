import type { RPCError } from "./errors.js";
import * as errors from "./errors.js";
import type { LoggerLikeNotOptional } from "./types.js";

// ─── RPC Error Factory ──────────────────────────────────────────

/**
 * Registry mapping OCPP-J RPC error code strings to their corresponding
 * error constructors. Organized by OCPP spec error category.
 */
const RPC_ERROR_REGISTRY = new Map<
  string,
  new (
    message?: string,
    details?: Record<string, unknown>,
  ) => RPCError
>([
  // Generic / framework errors
  ["GenericError", errors.RPCGenericError],
  ["RpcFrameworkError", errors.RPCFrameworkError],
  ["MessageTypeNotSupported", errors.RPCMessageTypeNotSupportedError],

  // Action-level errors
  ["NotImplemented", errors.RPCNotImplementedError],
  ["NotSupported", errors.RPCNotSupportedError],
  ["InternalError", errors.RPCInternalError],

  // Protocol / security errors
  ["ProtocolError", errors.RPCProtocolError],
  ["SecurityError", errors.RPCSecurityError],

  // Payload validation errors
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
  const RegisteredError = RPC_ERROR_REGISTRY.get(code);
  if (RegisteredError) {
    return new RegisteredError(message, details);
  }
  return new errors.RPCGenericError(message, details);
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
