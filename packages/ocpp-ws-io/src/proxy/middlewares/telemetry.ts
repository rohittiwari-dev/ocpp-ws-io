import {
  MessageType,
  type ProxyMiddleware,
  type TelemetryOptions,
} from "../core/types.js";

/** When a translation step began, kept from its `pre` middleware to its `post`. */
type StepStart = { at: number; action?: string };

/**
 * A middleware that measures each translation step, from its `pre`
 * middleware to its `post`, and passes the latency to `onLatency`: push it to
 * Datadog, Prometheus or OpenTelemetry there.
 */
export function createTelemetryMiddleware(
  options: TelemetryOptions = {},
): ProxyMiddleware {
  return async (message, context, direction, phase) => {
    const key = `telemetryStart_${message.messageId}`;
    if (phase === "pre") {
      const start: StepStart = {
        at: Date.now(),
        ...(message.type === MessageType.CALL && { action: message.action }),
      };
      await context.session.set(context.identity, key, start);
    } else if (phase === "post") {
      const start = await context.session.get<StepStart>(context.identity, key);
      if (start) {
        await context.session.delete(context.identity, key);
        options.onLatency?.(
          start.action,
          Date.now() - start.at,
          context,
          direction,
        );
      }
    }
    return undefined;
  };
}

/**
 * Measures each translation step but reports it nowhere. Use
 * `createTelemetryMiddleware({ onLatency })` to receive the latencies.
 */
export const TelemetryMiddleware: ProxyMiddleware = createTelemetryMiddleware();
