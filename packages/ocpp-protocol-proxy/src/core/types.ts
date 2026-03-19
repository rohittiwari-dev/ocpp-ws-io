import type { ISessionStore } from "./session.js";

export enum MessageType {
  CALL = 2,
  CALLRESULT = 3,
  CALLERROR = 4,
}

export type OCPPMessage =
  | { type: MessageType.CALL; messageId: string; action: string; payload: any }
  | { type: MessageType.CALLRESULT; messageId: string; payload: any }
  | {
      type: MessageType.CALLERROR;
      messageId: string;
      errorCode: string;
      errorDescription: string;
      errorDetails: any;
    };

export interface TranslationContext {
  identity: string;
  sourceProtocol: string;
  targetProtocol: string;
  session: ISessionStore;
}

export type TranslationResult = { action?: string; payload: any };

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

export type TranslationMap = {
  /** EVSE -> CSMS call mappers, keyed by `sourceProtocol:Action` */
  upstream: Record<
    string,
    (
      params: any,
      context: TranslationContext,
    ) => TranslationResult | Promise<TranslationResult>
  >;

  /** CSMS -> EVSE call mappers, keyed by `targetProtocol:Action` */
  downstream: Record<
    string,
    (
      params: any,
      context: TranslationContext,
    ) => TranslationResult | Promise<TranslationResult>
  >;

  /** Response payload mappers, keyed by `targetProtocol:ActionResponse` */
  responses?: Record<
    string,
    (params: any, context: TranslationContext) => any | Promise<any>
  >;

  /** Error mappers, keyed by `sourceProtocol:Error` */
  errors?: Record<
    string,
    (
      errorCode: string,
      errorDescription: string,
      errorDetails: any,
      context: TranslationContext,
    ) =>
      | { errorCode: string; errorDescription: string; errorDetails: any }
      | Promise<{
          errorCode: string;
          errorDescription: string;
          errorDetails: any;
        }>
  >;
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
