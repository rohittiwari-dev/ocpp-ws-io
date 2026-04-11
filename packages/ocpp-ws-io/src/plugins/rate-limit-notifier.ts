import type { OCPPPlugin, SecurityEvent } from "../types.js";

/**
 * Destination for rate-limit alerts.
 */
export interface AlertSink {
  /** Send an alert payload. Returns a promise that resolves on success. */
  send(payload: RateLimitAlert): void | Promise<void>;
}

export interface RateLimitAlert {
  /** The event type that triggered the alert */
  eventType: "RATE_LIMIT_EXCEEDED" | "CONNECTION_RATE_LIMIT";
  /** Station identity (if known) */
  identity?: string;
  /** Remote IP address */
  ip?: string;
  /** ISO 8601 timestamp of the event */
  timestamp: string;
  /** Number of times the event occurred in the current window */
  count: number;
  /** Window duration in ms */
  windowMs: number;
}

export interface RateLimitNotifierOptions {
  /**
   * Where to send alerts. Can be a webhook URL (string), a Kafka-like sink
   * object, or any object with a `send(payload)` method.
   *
   * @example Webhook URL
   * ```ts
   * rateLimitNotifierPlugin({ sink: 'https://alerts.example.com/hook' })
   * ```
   *
   * @example Custom sink
   * ```ts
   * rateLimitNotifierPlugin({
   *   sink: {
   *     send: (alert) => kafka.send({ topic: 'rate-limits', messages: [{ value: JSON.stringify(alert) }] })
   *   }
   * })
   * ```
   */
  sink: string | AlertSink;

  /**
   * Minimum interval (ms) between alerts for the same identity.
   * Prevents alert storms.
   * @default 60000 (1 minute)
   */
  cooldownMs?: number;

  /**
   * Number of rate-limit events before an alert is sent.
   * @default 1
   */
  threshold?: number;

  /**
   * Sliding window in ms to count rate limit events.
   * @default 300000 (5 minutes)
   */
  windowMs?: number;

  /**
   * Custom HTTP headers for webhook sink.
   */
  headers?: Record<string, string>;

  /**
   * Optional logger.
   */
  logger?: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Rate Limit Notifier Plugin (Level 1: Passive Hook)
 *
 * Fires alerts to an external sink (webhook URL or custom sink) whenever a
 * client exceeds the server's rate limit. Implements per-identity cooldown
 * and threshold-based alerting to prevent alert storms.
 *
 * @example
 * ```ts
 * server.plugin(rateLimitNotifierPlugin({
 *   sink: 'https://slack.example.com/webhook',
 *   cooldownMs: 120_000,
 *   threshold: 3,
 * }));
 * ```
 */
export function rateLimitNotifierPlugin(
  options: RateLimitNotifierOptions,
): OCPPPlugin {
  const cooldownMs = options.cooldownMs ?? 60_000;
  const threshold = options.threshold ?? 1;
  const windowMs = options.windowMs ?? 300_000;
  const log = options.logger;

  // Per-identity sliding window of event timestamps
  const eventWindows = new Map<string, number[]>();
  // Per-identity cooldown tracker
  const lastAlerted = new Map<string, number>();

  function getSink(): AlertSink {
    if (typeof options.sink === "string") {
      return {
        async send(payload: RateLimitAlert) {
          await fetch(options.sink as string, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...options.headers,
            },
            body: JSON.stringify(payload),
          });
        },
      };
    }
    return options.sink;
  }

  function pruneWindow(key: string): number[] {
    const now = Date.now();
    const timestamps = eventWindows.get(key) ?? [];
    const valid = timestamps.filter((t) => now - t < windowMs);
    eventWindows.set(key, valid);
    return valid;
  }

  function trackAndAlert(
    identity: string | undefined,
    ip: string | undefined,
    eventType: RateLimitAlert["eventType"],
  ): void {
    const key = identity ?? ip ?? "unknown";
    const now = Date.now();

    // Add to sliding window
    const window = pruneWindow(key);
    window.push(now);

    // Check threshold
    if (window.length < threshold) return;

    // Check cooldown
    const lastTime = lastAlerted.get(key) ?? 0;
    if (now - lastTime < cooldownMs) return;

    // Fire alert
    lastAlerted.set(key, now);

    const sink = getSink();
    const alert: RateLimitAlert = {
      eventType,
      identity,
      ip,
      timestamp: new Date().toISOString(),
      count: window.length,
      windowMs,
    };

    Promise.resolve(sink.send(alert)).catch((err) => {
      log?.error?.("[rate-limit-notifier] Alert delivery failed:", err);
    });
  }

  return {
    name: "rate-limit-notifier",

    onRateLimitExceeded(client, _rawData) {
      trackAndAlert(
        client.identity,
        client.handshake.remoteAddress,
        "RATE_LIMIT_EXCEEDED",
      );
    },

    onSecurityEvent(event: SecurityEvent) {
      if (
        event.type === "RATE_LIMIT_EXCEEDED" ||
        event.type === "CONNECTION_RATE_LIMIT"
      ) {
        trackAndAlert(event.identity, event.ip, event.type);
      }
    },

    onClose() {
      eventWindows.clear();
      lastAlerted.clear();
    },
  };
}
