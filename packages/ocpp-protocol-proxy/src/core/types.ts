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
}

export type TranslationResult = { action?: string; payload: any };

export type TranslationMap = {
  // EVSE -> CSMS
  upstream: Record<
    string,
    (
      params: any,
      context: TranslationContext,
    ) => TranslationResult | Promise<TranslationResult>
  >;

  // CSMS -> EVSE
  downstream: Record<
    string,
    (
      params: any,
      context: TranslationContext,
    ) => TranslationResult | Promise<TranslationResult>
  >;

  // Responses map for specific mapping, if needed
  responses?: Record<
    string,
    (params: any, context: TranslationContext) => any | Promise<any>
  >;

  // Errors map to map an error code from one protocol to another
  errors?: Record<
    string,
    (
      errorCode: string,
      errorDescription: string,
      errorDetails: any,
      context: TranslationContext,
    ) => { errorCode: string; errorDescription: string; errorDetails: any }
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
