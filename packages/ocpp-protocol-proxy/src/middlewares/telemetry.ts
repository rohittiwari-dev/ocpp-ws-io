import type {
  MiddlewareDirection,
  MiddlewarePhase,
  OCPPMessage,
  ProxyMiddleware,
  TranslationContext,
} from "../core/types.js";

/**
 * Example built-in middleware that tracks translation latency.
 * In production, push metrics to Datadog, Prometheus, or OpenTelemetry.
 */
export const TelemetryMiddleware: ProxyMiddleware = async (
  message: OCPPMessage,
  context: TranslationContext,
  _direction: MiddlewareDirection,
  phase: MiddlewarePhase,
): Promise<OCPPMessage | undefined> => {
  if (phase === "pre") {
    await context.session.set(
      context.identity,
      `telemetryStart_${message.messageId}`,
      Date.now(),
    );
  } else if (phase === "post") {
    const startTime = await context.session.get<number>(
      context.identity,
      `telemetryStart_${message.messageId}`,
    );
    if (startTime) {
      const _latency = Date.now() - startTime;
      await context.session.delete(
        context.identity,
        `telemetryStart_${message.messageId}`,
      );
      // Emit or log: console.log(`[TELEMETRY] ${_latency}ms`);
    }
  }
  return undefined;
};
