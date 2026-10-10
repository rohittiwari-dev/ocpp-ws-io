import type {
  AllMethodNames,
  OCPPProtocolKey,
  OCPPRequestType,
  OCPPResponseType,
} from "../../generated/index.js";
import type { ISessionStore } from "./session.js";

export enum MessageType {
  CALL = 2,
  CALLRESULT = 3,
  CALLERROR = 4,
}

/**
 * A value a payload carries: JSON, or `undefined` for a field a mapper leaves
 * out, which JSON drops when the message is sent.
 */
export type ProxyValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ProxyValue[]
  | { [key: string]: ProxyValue };

/** An OCPP payload as the proxy carries it: always a JSON object (OCPP-J §4.2). */
export type ProxyPayload = { [key: string]: ProxyValue };

export type OCPPMessage =
  | {
      type: MessageType.CALL;
      messageId: string;
      action: string;
      payload: ProxyPayload;
    }
  | { type: MessageType.CALLRESULT; messageId: string; payload: ProxyPayload }
  | {
      type: MessageType.CALLERROR;
      messageId: string;
      errorCode: string;
      errorDescription: string;
      errorDetails: ProxyPayload;
    };

export interface TranslationContext {
  identity: string;
  sourceProtocol: string;
  targetProtocol: string;
  session: ISessionStore;
}

/**
 * What a call mapper returns. Its payload may be any object (a generated OCPP
 * type passed on, or an object built field by field): it is sent as JSON.
 */
export type TranslationResult = { action?: string; payload: object };

export type MiddlewarePhase = "pre" | "post";
export type MiddlewareDirection =
  | "upstream"
  | "downstream"
  | "response"
  | "error";

/**
 * Middleware function signature.
 * Return the (possibly mutated) message to pass it along,
 * or return undefined to pass the original message unchanged.
 */
export type ProxyMiddleware = (
  message: OCPPMessage,
  context: TranslationContext,
  direction: MiddlewareDirection,
  phase: MiddlewarePhase,
) => Promise<OCPPMessage | undefined>;

/** `"ocpp1.6:BootNotification"`: a protocol and one of its actions. */
export type ActionKey = {
  [V in OCPPProtocolKey]: `${V}:${AllMethodNames<V>}`;
}[OCPPProtocolKey];

/** `"ocpp2.1:BootNotificationResponse"`: the answer to an action. */
export type ResponseKey = {
  [V in OCPPProtocolKey]: `${V}:${AllMethodNames<V>}Response`;
}[OCPPProtocolKey];

/** `"ocpp2.1:Error"`: the errors of a protocol. */
export type ErrorKey = `${OCPPProtocolKey}:Error`;

/** The request of the action an ActionKey names. */
export type RequestAt<K> =
  K extends `${infer V extends OCPPProtocolKey}:${infer M}`
    ? OCPPRequestType<V, M>
    : never;

/** The response of the action a ResponseKey names. */
export type ResponseAt<K> =
  K extends `${infer V extends OCPPProtocolKey}:${infer M}Response`
    ? OCPPResponseType<V, M>
    : never;

/** Translates a call; its params are the request of the action it is keyed by. */
export type CallMapper<P> = (
  params: P,
  context: TranslationContext,
) => TranslationResult | Promise<TranslationResult>;

/** Translates an answer; its params are the response it is keyed by. */
export type ResponseMapper<P> = (
  params: P,
  context: TranslationContext,
) => object | Promise<object>;

/** A CALLERROR as an error mapper returns it. */
export interface TranslatedError {
  errorCode: string;
  errorDescription: string;
  errorDetails: ProxyPayload;
}

export type ErrorMapper = (
  errorCode: string,
  errorDescription: string,
  errorDetails: ProxyPayload,
  context: TranslationContext,
) => TranslatedError | Promise<TranslatedError>;

/**
 * Translation functions by key. A key names a protocol and an action the types
 * know (a custom protocol is known once declared on `OCPPMethodMap`), so a
 * misspelt key is an error and each function's params are that action's
 * request or response.
 */
export type TranslationMap = {
  /** EVSE -> CSMS call mappers, keyed by `sourceProtocol:Action` */
  upstream: { [K in ActionKey]?: CallMapper<RequestAt<K>> };

  /** CSMS -> EVSE call mappers, keyed by `targetProtocol:Action` */
  downstream: { [K in ActionKey]?: CallMapper<RequestAt<K>> };

  /** Response payload mappers, keyed by `targetProtocol:ActionResponse` */
  responses?: { [K in ResponseKey]?: ResponseMapper<ResponseAt<K>> };

  /** Error mappers, keyed by `sourceProtocol:Error` */
  errors?: { [K in ErrorKey]?: ErrorMapper };
};

export interface IConnection {
  identity: string;
  protocol: string;
  send(message: OCPPMessage): Promise<OCPPMessage | undefined>;
  onMessage(
    handler: (message: OCPPMessage) => Promise<OCPPMessage | undefined>,
  ): void;
  onClose(handler: () => void): void;
}

export interface ITransportAdapter {
  listen(onConnection: (connection: IConnection) => void): Promise<void>;
  close(): Promise<void>;
}
