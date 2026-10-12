import type { RPCError, RPCGenericError } from "../../core/errors.js";
import { MessageType, type OCPPMessage, type ProxyPayload } from "./types.js";

type ErrorMessage = Extract<OCPPMessage, { type: MessageType.CALLERROR }>;

/**
 * A CALLERROR the proxy answers a peer with. The library sends an RPC error's
 * own code, description and details; a plain Error went out as InternalError.
 */
export class ProxiedCallError extends Error implements RPCError {
  readonly rpcErrorCode: string;
  readonly rpcErrorMessage: string;
  readonly details: ProxyPayload;

  constructor(code: string, description: string, details: ProxyPayload) {
    super(description);
    this.name = "ProxiedCallError";
    this.rpcErrorCode = code;
    this.rpcErrorMessage = description;
    this.details = details;
  }
}

/** A peer's CALLERROR, which rejected a call with an RPC error, as a message. */
export function callErrorMessage(
  err: RPCGenericError,
  messageId: string,
): ErrorMessage {
  return {
    type: MessageType.CALLERROR,
    messageId,
    errorCode: err.rpcErrorCode,
    errorDescription: err.message,
    // The details of a CALLERROR are the JSON object the peer sent.
    errorDetails: err.details as ProxyPayload,
  };
}
