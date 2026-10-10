import {
  type CallMapper,
  type ErrorMapper,
  MessageType,
  type OCPPMessage,
  type ProxyPayload,
  type ResponseMapper,
  type TranslationContext,
  type TranslationMap,
} from "./types.js";

/**
 * A translation map read by a key built at runtime from a message's protocol
 * and action. Every typed function fits here, taking `never`; the key names
 * the message it is given, so its payload is the one that function expects.
 */
type ByKey<F> = Record<string, F | undefined>;

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
    const mappers: ByKey<CallMapper<never>> = this.translationMap.upstream;
    const mapper = mappers[key];

    if (!mapper) {
      // Passthrough if no mapper exists — don't crash on unknown actions
      return message;
    }

    const translated = await mapper(message.payload as never, context);
    return {
      type: MessageType.CALL,
      messageId: message.messageId,
      action: translated.action || message.action,
      // A mapper builds a JSON object; the message carries it as one.
      payload: translated.payload as ProxyPayload,
    };
  }

  public async translateDownstreamCall(
    message: Extract<OCPPMessage, { type: MessageType.CALL }>,
    context: TranslationContext,
  ): Promise<Extract<OCPPMessage, { type: MessageType.CALL }>> {
    const key = `${context.targetProtocol}:${message.action}`;
    const mappers: ByKey<CallMapper<never>> = this.translationMap.downstream;
    const mapper = mappers[key];

    if (!mapper) {
      // Passthrough if no mapper exists
      return message;
    }

    const translated = await mapper(message.payload as never, context);
    return {
      type: MessageType.CALL,
      messageId: message.messageId,
      action: translated.action || message.action,
      // A mapper builds a JSON object; the message carries it as one.
      payload: translated.payload as ProxyPayload,
    };
  }

  public async translateCallResult(
    message: Extract<OCPPMessage, { type: MessageType.CALLRESULT }>,
    originalAction: string,
    context: TranslationContext,
  ): Promise<Extract<OCPPMessage, { type: MessageType.CALLRESULT }>> {
    const responseKey = `${context.targetProtocol}:${originalAction}Response`;
    const responses: ByKey<ResponseMapper<never>> | undefined =
      this.translationMap.responses;
    const responseMapper = responses?.[responseKey];

    if (responseMapper) {
      const translatedPayload = await responseMapper(
        message.payload as never,
        context,
      );
      return {
        type: MessageType.CALLRESULT,
        messageId: message.messageId,
        payload: translatedPayload as ProxyPayload,
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
    const errors: ByKey<ErrorMapper> | undefined = this.translationMap.errors;
    const errorMapper = errors?.[errorKey];

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
