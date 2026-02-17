import * as errors from "./errors.js";

const rpcErrorLUT: Record<
  string,
  new (message?: string, details?: Record<string, unknown>) => errors.RPCError
> = {
  GenericError: errors.RPCGenericError,
  NotImplemented: errors.RPCNotImplementedError,
  NotSupported: errors.RPCNotSupportedError,
  InternalError: errors.RPCInternalError,
  ProtocolError: errors.RPCProtocolError,
  SecurityError: errors.RPCSecurityError,
  FormationViolation: errors.RPCFormationViolationError,
  FormatViolation: errors.RPCFormatViolationError,
  PropertyConstraintViolation: errors.RPCPropertyConstraintViolationError,
  OccurrenceConstraintViolation: errors.RPCOccurrenceConstraintViolationError,
  OccurenceConstraintViolation: errors.RPCOccurenceConstraintViolationError,
  TypeConstraintViolation: errors.RPCTypeConstraintViolationError,
  MessageTypeNotSupported: errors.RPCMessageTypeNotSupportedError,
  RpcFrameworkError: errors.RPCFrameworkError,
};

/**
 * Create an RPCError instance from an error code string.
 * Falls back to RPCGenericError for unknown codes.
 */
export function createRPCError(
  code: string,
  message?: string,
  details: Record<string, unknown> = {},
): errors.RPCError {
  const ErrorClass = rpcErrorLUT[code] ?? errors.RPCGenericError;
  const err = new ErrorClass(message, details);
  return err;
}

/**
 * Convert an error to a safe plain object (no circular references).
 */
export function getErrorPlainObject(err: Error): Record<string, unknown> {
  try {
    const plain = JSON.parse(
      JSON.stringify(err, Object.getOwnPropertyNames(err)),
    );
    return plain as Record<string, unknown>;
  } catch {
    return {
      name: err.name,
      message: err.message,
    };
  }
}

let _packageIdent: string | undefined;

/**
 * Get the package identifier string (for HTTP headers, user agent, etc.)
 */
export function getPackageIdent(): string {
  if (!_packageIdent) {
    _packageIdent = "ocpp-ws-io/1.0.0";
  }
  return _packageIdent;
}
