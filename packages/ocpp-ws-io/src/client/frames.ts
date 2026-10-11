import type { RPCError } from "../core/errors.js";
import { supportsSend } from "../core/protocol-list.js";
import { createRPCError } from "../core/util.js";
import type { ClientOptions } from "../types/client.js";
import { MessageType } from "../types/protocol.js";

// The rules an incoming frame is checked against, by OCPP-J version.

/** Fewest elements a frame of each message type can have (Part 4 §4.2). */
export const MIN_FRAME_LENGTH: Readonly<Record<MessageType, number>> = {
  [MessageType.CALL]: 4,
  [MessageType.CALLRESULT]: 3,
  [MessageType.CALLERROR]: 5,
  [MessageType.CALLRESULTERROR]: 5,
  [MessageType.SEND]: 4,
};

/** Which error frame answers a bad message, and under which message ID. */
export interface BadMessageReply {
  frame: typeof MessageType.CALLERROR | typeof MessageType.CALLRESULTERROR;
  messageId: string;
}

/** A frame whose message ID could not be read is answered under ID "-1". */
export const UNREADABLE_ID_REPLY: BadMessageReply = {
  frame: MessageType.CALLERROR,
  messageId: "-1",
};

/** OCPP-J §4.1.4: "maximum of 36 characters, to allow for UUIDs/GUIDs". */
const MAX_MESSAGE_ID_LENGTH = 36;

/** Which schema of a message is being validated. */
export type SchemaKind = "req" | "conf" | "send";

/** Position of the payload (or error details) object per message type. */
export const PAYLOAD_INDEX: Readonly<Record<MessageType, number>> = {
  [MessageType.CALL]: 3,
  [MessageType.CALLRESULT]: 2,
  [MessageType.CALLERROR]: 4,
  [MessageType.CALLRESULTERROR]: 4,
  [MessageType.SEND]: 3,
};

/** What decides whether an incoming request's message ID is accepted. */
export interface MessageIdRules {
  readonly protocol: string | undefined;
  readonly idValidator: ClientOptions["idValidator"];
  readonly strictMode: ClientOptions["strictMode"];
  /** The protocols strict mode covers; null for every one. */
  readonly strictProtocols: readonly string[] | null;
}

/**
 * CALLRESULTERROR exists only in OCPP 2.1; SEND in OCPP 2.1 and custom
 * protocols ({@link supportsSend}).
 */
export function isKnownMessageType(
  protocol: string | undefined,
  type: number,
): type is MessageType {
  if (
    type === MessageType.CALL ||
    type === MessageType.CALLRESULT ||
    type === MessageType.CALLERROR
  ) {
    return true;
  }
  if (type === MessageType.SEND) return supportsSend(protocol);
  return protocol === "ocpp2.1" && type === MessageType.CALLRESULTERROR;
}

/**
 * A malformed CALL gets a CALLERROR (Part 4 §4.2.3, "the call is received"),
 * and on OCPP 2.1 a malformed CALLRESULT gets a CALLRESULTERROR (2.1 Part 2
 * FR.06). Nothing else is answered — a CALLERROR in particular, since two
 * peers replying to each other's errors would loop.
 */
export function replyTo(
  protocol: string | undefined,
  messageType: number,
  messageId: string,
): BadMessageReply | undefined {
  if (messageType === MessageType.CALL) {
    return { frame: MessageType.CALLERROR, messageId };
  }
  if (messageType === MessageType.CALLRESULT && protocol === "ocpp2.1") {
    return { frame: MessageType.CALLRESULTERROR, messageId };
  }
  return undefined;
}

/**
 * Why an incoming request's message ID is rejected, if it is. idValidator
 * decides when set, in any mode; otherwise strict mode applies the spec's
 * limit of 36 characters (1.6J Table 3, 2.0.1 / 2.1 Table 4). 1.6 has no
 * RpcFrameworkError (Table 7), so GenericError answers there.
 */
export function messageIdError(
  rules: MessageIdRules,
  messageId: string,
): RPCError | undefined {
  const code =
    rules.protocol === "ocpp1.6" ? "GenericError" : "RpcFrameworkError";
  const validate = rules.idValidator;
  if (validate) {
    let valid: boolean;
    try {
      valid = validate(messageId);
    } catch (err) {
      return createRPCError(
        code,
        `idValidator failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return valid ? undefined : createRPCError(code, "Message ID rejected");
  }
  const strict =
    rules.strictMode &&
    (!rules.strictProtocols ||
      rules.strictProtocols.includes(rules.protocol ?? ""));
  const length = Array.from(messageId).length;
  if (strict && length > MAX_MESSAGE_ID_LENGTH) {
    return createRPCError(
      code,
      `Message ID is ${length} characters; the maximum is ${MAX_MESSAGE_ID_LENGTH}`,
    );
  }
  return undefined;
}

/** ErrorDescription is string[255] on 2.0.1 and 2.1 (Table 7); 1.6 sets no limit. */
export function fitErrorDescription(
  protocol: string | undefined,
  description: string,
): string {
  if (protocol !== "ocpp2.0.1" && protocol !== "ocpp2.1") {
    return description;
  }
  const chars = Array.from(description);
  return chars.length > 255 ? chars.slice(0, 255).join("") : description;
}
