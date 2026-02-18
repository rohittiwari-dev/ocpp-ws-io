// ─── Base Errors ─────────────────────────────────────────────────

export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

// ─── RPC Error Base ──────────────────────────────────────────────

export interface RPCError extends Error {
  readonly rpcErrorCode: string;
  readonly rpcErrorMessage: string;
  readonly details: Record<string, unknown>;
}

export class RPCGenericError extends Error implements RPCError {
  readonly rpcErrorCode: string = "GenericError";
  readonly rpcErrorMessage: string = "";
  readonly details: Record<string, unknown>;

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "RPCGenericError";
    this.details = details;
  }
}

// ─── Specific RPC Errors ─────────────────────────────────────────

export class RPCNotImplementedError extends RPCGenericError {
  override readonly rpcErrorCode = "NotImplemented";
  override readonly rpcErrorMessage = "Requested method is not known";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCNotImplementedError";
  }
}

export class RPCNotSupportedError extends RPCGenericError {
  override readonly rpcErrorCode = "NotSupported";
  override readonly rpcErrorMessage =
    "Requested method is recognised but not supported";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCNotSupportedError";
  }
}

export class RPCInternalError extends RPCGenericError {
  override readonly rpcErrorCode = "InternalError";
  override readonly rpcErrorMessage =
    "An internal error occurred and the receiver was not able to process the requested action successfully";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCInternalError";
  }
}

export class RPCProtocolError extends RPCGenericError {
  override readonly rpcErrorCode = "ProtocolError";
  override readonly rpcErrorMessage = "Payload for action is incomplete";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCProtocolError";
  }
}

export class RPCSecurityError extends RPCGenericError {
  override readonly rpcErrorCode = "SecurityError";
  override readonly rpcErrorMessage =
    "During the processing of action a security issue occurred preventing receiver from completing the action successfully";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCSecurityError";
  }
}

export class RPCFormationViolationError extends RPCGenericError {
  override readonly rpcErrorCode = "FormationViolation";
  override readonly rpcErrorMessage =
    "Payload for action is syntactically incorrect or not conform the PDU structure for action";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCFormationViolationError";
  }
}

export class RPCFormatViolationError extends RPCGenericError {
  override readonly rpcErrorCode = "FormatViolation";
  override readonly rpcErrorMessage =
    "Payload is syntactically correct but at least one field contains an invalid value";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCFormatViolationError";
  }
}

export class RPCPropertyConstraintViolationError extends RPCGenericError {
  override readonly rpcErrorCode = "PropertyConstraintViolation";
  override readonly rpcErrorMessage =
    "Payload is syntactically correct but at least one of the fields violates data type constraints";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCPropertyConstraintViolationError";
  }
}

export class RPCOccurrenceConstraintViolationError extends RPCGenericError {
  override readonly rpcErrorCode = "OccurrenceConstraintViolation";
  override readonly rpcErrorMessage =
    "Payload for action is syntactically correct but at least one of the fields violates occurrence constraints";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCOccurrenceConstraintViolationError";
  }
}

export class RPCTypeConstraintViolationError extends RPCGenericError {
  override readonly rpcErrorCode = "TypeConstraintViolation";
  override readonly rpcErrorMessage =
    "Payload for action is syntactically correct but at least one of the fields violates type constraints";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCTypeConstraintViolationError";
  }
}

export class RPCMessageTypeNotSupportedError extends RPCGenericError {
  override readonly rpcErrorCode = "MessageTypeNotSupported";
  override readonly rpcErrorMessage =
    "A message with a Message Type Number received that is not supported by this implementation";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCMessageTypeNotSupportedError";
  }
}

export class RPCFrameworkError extends RPCGenericError {
  override readonly rpcErrorCode = "RpcFrameworkError";
  override readonly rpcErrorMessage =
    "Content of the call is not a valid RPC request";

  constructor(message?: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "RPCFrameworkError";
  }
}
