import type {
  CallMapper,
  ErrorMapper,
  ProxyPayload,
  ResponseMapper,
  TranslatedError,
  TranslationContext,
} from "../../src/proxy/core/types.js";

/**
 * A test's view of a preset's mappers. Tests call mappers by key with partial
 * or out-of-schema payloads on purpose (an unknown status passes through),
 * which the typed params refuse. This view calls each mapper by key, as the
 * translator does at runtime. A test names the type it expects back (the
 * request or response of the other protocol); left out, it is plain JSON.
 */
type CallView = Record<
  string,
  <Out extends object = ProxyPayload>(
    params: ProxyPayload,
    context: TranslationContext,
  ) => Promise<{ action?: string; payload: Out }>
>;
type ResponseView = Record<
  string,
  <Out extends object = ProxyPayload>(
    params: ProxyPayload,
    context: TranslationContext,
  ) => Promise<Out>
>;
type ErrorView = Record<
  string,
  (
    errorCode: string,
    errorDescription: string,
    errorDetails: ProxyPayload,
    context: TranslationContext,
  ) => Promise<TranslatedError>
>;

export function calls(
  map: Record<string, CallMapper<never> | undefined> | undefined,
): CallView {
  const view: CallView = {};
  for (const [key, mapper] of Object.entries(map ?? {})) {
    if (!mapper) continue;
    view[key] = async <Out extends object>(
      params: ProxyPayload,
      context: TranslationContext,
    ) => {
      const result = await mapper(params as never, context);
      return { ...result, payload: result.payload as Out };
    };
  }
  return view;
}

export function responses(
  map: Record<string, ResponseMapper<never> | undefined> | undefined,
): ResponseView {
  const view: ResponseView = {};
  for (const [key, mapper] of Object.entries(map ?? {})) {
    if (!mapper) continue;
    view[key] = async <Out extends object>(
      params: ProxyPayload,
      context: TranslationContext,
    ) => (await mapper(params as never, context)) as Out;
  }
  return view;
}

export function errors(
  map: Record<string, ErrorMapper | undefined> | undefined,
): ErrorView {
  const view: ErrorView = {};
  for (const [key, mapper] of Object.entries(map ?? {})) {
    if (!mapper) continue;
    view[key] = async (...args) => mapper(...args);
  }
  return view;
}
