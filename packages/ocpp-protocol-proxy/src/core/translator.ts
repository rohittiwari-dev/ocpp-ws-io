import {
  MessageType,
  type OCPPMessage,
  type TranslationContext,
  type TranslationMap,
} from "./types.js";

export class OCPPTranslator {
  constructor(private translationMap: TranslationMap) {}

  public updateMap(map: Partial<TranslationMap>) {
    this.translationMap.upstream = {
      ...this.translationMap.upstream,
      ...map.upstream,
    };
    this.translationMap.downstream = {
      ...this.translationMap.downstream,
      ...map.downstream,
    };
    if (map.responses) {
      this.translationMap.responses = {
        ...this.translationMap.responses,
        ...map.responses,
      };
    }
    if (map.errors) {
      this.translationMap.errors = {
        ...this.translationMap.errors,
        ...map.errors,
      };
    }
  }

  public async translateUpstreamCall(
    message: Extract<OCPPMessage, { type: MessageType.CALL }>,
    context: TranslationContext,
  ): Promise<Extract<OCPPMessage, { type: MessageType.CALL }>> {
    const key = `${context.sourceProtocol}:${message.action}`;
    const mapper = this.translationMap.upstream[key];

    if (!mapper) {
      throw new Error(`No upstream translation found for ${key}`);
    }

    const translated = await mapper(message.payload, context);
    return {
      type: MessageType.CALL,
      messageId: message.messageId,
      action: translated.action || message.action,
      payload: translated.payload,
    };
  }

  public async translateDownstreamCall(
    message: Extract<OCPPMessage, { type: MessageType.CALL }>,
    context: TranslationContext,
  ): Promise<Extract<OCPPMessage, { type: MessageType.CALL }>> {
    const key = `${context.targetProtocol}:${message.action}`;
    const mapper = this.translationMap.downstream[key];

    if (!mapper) {
      throw new Error(`No downstream translation found for ${key}`);
    }

    const translated = await mapper(message.payload, context);
    return {
      type: MessageType.CALL,
      messageId: message.messageId,
      action: translated.action || message.action,
      payload: translated.payload,
    };
  }

  public async translateCallResult(
    message: Extract<OCPPMessage, { type: MessageType.CALLRESULT }>,
    originalAction: string,
    context: TranslationContext,
  ): Promise<Extract<OCPPMessage, { type: MessageType.CALLRESULT }>> {
    const responseKey = `${context.targetProtocol}:${originalAction}Response`;
    console.error(
      "[DEBUG] translateCallResult resolving key:",
      responseKey,
      " available:",
      Object.keys(this.translationMap.responses || {}),
    );
    const responseMapper = this.translationMap.responses?.[responseKey];

    if (responseMapper) {
      const translatedPayload = await responseMapper(message.payload, context);
      return {
        type: MessageType.CALLRESULT,
        messageId: message.messageId,
        payload: translatedPayload,
      };
    }

    // Default passthrough if no mapper
    return message;
  }

  public async translateCallError(
    message: Extract<OCPPMessage, { type: MessageType.CALLERROR }>,
    context: TranslationContext,
  ): Promise<Extract<OCPPMessage, { type: MessageType.CALLERROR }>> {
    const errorKey = `${context.sourceProtocol}:Error`;
    const errorMapper = this.translationMap.errors?.[errorKey];

    if (errorMapper) {
      const translated = await errorMapper(
        message.errorCode,
        message.errorDescription,
        message.errorDetails,
        context,
      );
      return {
        type: MessageType.CALLERROR,
        messageId: message.messageId,
        errorCode: translated.errorCode,
        errorDescription: translated.errorDescription,
        errorDetails: translated.errorDetails,
      };
    }

    // Default passthrough
    return message;
  }
}
