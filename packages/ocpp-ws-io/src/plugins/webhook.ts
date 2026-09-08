import { createHmac, randomUUID } from "node:crypto";
import { Queue } from "../queue.js";
import type { OCPPPlugin } from "../types.js";

type WebhookEvent =
  | "init"
  | "connect"
  | "disconnect"
  | "close"
  | "security"
  | "auth_failed"
  | "eviction"
  | "closing"
  | "message";

/**
 * Options for the webhook plugin.
 */
export interface WebhookPluginOptions {
  /** Webhook HTTP endpoint URL. */
  url: string;
  /**
   * Which events to send.
   * @default ["init", "connect", "disconnect", "close"]
   *
   * `"message"` fires once per OCPP message in either direction. That is one
   * HTTP request per Heartbeat and per MeterValues, so at any real fleet size
   * it needs `maxConcurrent` set — see that option.
   */
  events?: WebhookEvent[];
  /** Custom HTTP headers to include (e.g. Authorization). */
  headers?: Record<string, string>;
  /**
   * HMAC-SHA256 secret for signing payloads.
   *
   * The signature is computed over `` `${timestamp}.${body}` ``, and that same
   * timestamp is sent as `X-Signature-Timestamp`. Verify by recomputing over
   * both — signing the body alone would let anyone replay a captured request
   * forever, since nothing in it would bind it to a moment in time.
   *
   * ```ts
   * const expected = createHmac("sha256", secret)
   *   .update(`${req.headers["x-signature-timestamp"]}.${rawBody}`)
   *   .digest("hex");
   * // then compare with timingSafeEqual, and reject a stale timestamp
   * ```
   */
  secret?: string;
  /** Fetch timeout in ms (default: 5000). */
  timeout?: number;
  /** Number of retries on failure (default: 1). */
  retries?: number;
  /**
   * Maximum webhook requests in flight at once.
   *
   * Unset means unbounded, which is the historical behaviour and fine for
   * lifecycle events on a small fleet. It does not survive a reconnect storm:
   * every charger reconnecting at once opens that many sockets simultaneously,
   * and the failures that follow — port exhaustion, `ECONNRESET`, `EMFILE` —
   * lose those webhooks outright rather than delaying them. A bound makes
   * delivery slower and more reliable.
   *
   * Requests beyond the bound queue in memory rather than being dropped, so
   * this trades latency and ordering for delivery, not the reverse.
   */
  maxConcurrent?: number;
  /**
   * Include the full OCPP message in `"message"` webhooks. (default: false)
   *
   * Off by default because payloads carry `idTag`s and credentials. Note that
   * `piiRedactorPlugin` covers inbound messages but **not** the responses this
   * server sends, which never enter the middleware chain.
   */
  includePayload?: boolean;
}

interface WebhookPayload {
  event: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Sends HTTP POST webhooks on server lifecycle and security events.
 * Uses Node.js built-in `fetch` (Node 18+).
 *
 * @example
 * ```ts
 * import { webhookPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(webhookPlugin({
 *   url: 'https://api.example.com/ocpp-events',
 *   secret: process.env.WEBHOOK_SECRET,
 *   events: ['connect', 'disconnect', 'security', 'auth_failed'],
 *   headers: { Authorization: 'Bearer token123' },
 * }));
 * ```
 */
export function webhookPlugin(options: WebhookPluginOptions): OCPPPlugin {
  const allowedEvents = new Set<WebhookEvent>(
    options.events ?? ["init", "connect", "disconnect", "close"],
  );
  const timeout = options.timeout ?? 5000;
  const maxRetries = options.retries ?? 1;

  // Unset means unbounded, which is what this plugin has always done.
  const queue = options.maxConcurrent
    ? new Queue(options.maxConcurrent)
    : undefined;

  async function deliver(payload: WebhookPayload): Promise<void> {
    const body = JSON.stringify(payload);

    // Stable across retries of this event, distinct between events. Built from
    // event+timestamp it collided: fifty chargers connecting inside the same
    // millisecond share one key, and a receiver deduplicating on it would
    // discard forty-nine real events.
    const idempotencyKey = randomUUID();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
      ...options.headers,
    };

    if (options.secret) {
      // Sign timestamp and body together. Signing the body alone leaves
      // nothing binding the request to a moment, so a captured request
      // replays forever — and a timestamp sent outside the MAC is not
      // evidence of anything, since an attacker can rewrite it freely.
      const signedAt = Date.now().toString();
      headers["X-Signature"] = createHmac("sha256", options.secret)
        .update(`${signedAt}.${body}`)
        .digest("hex");
      headers["X-Signature-Timestamp"] = signedAt;
      headers["X-Signature-Algorithm"] = "HMAC-SHA256";
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(options.url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Webhook responded with HTTP ${res.status}`);
        }
        return; // Success
      } catch {
        if (attempt < maxRetries) {
          // Exponential backoff between attempts (250ms, 500ms, 1s, ...)
          await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        }
        // Final failure is swallowed — webhooks must never crash the server
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Drop events nobody asked for, then hand the rest to the queue when one is
   * configured. Queued requests wait rather than being discarded, so a bound
   * costs latency and ordering, never delivery.
   */
  function sendWebhook(payload: WebhookPayload): Promise<void> {
    if (!allowedEvents.has(payload.event as WebhookEvent)) {
      return Promise.resolve();
    }
    return queue ? queue.push(() => deliver(payload)) : deliver(payload);
  }

  return {
    name: "webhook",

    onInit(server) {
      if (allowedEvents.has("message") && !queue) {
        server.log.warn(
          'webhookPlugin: "message" events with no maxConcurrent set',
          {
            reason:
              "one HTTP request per OCPP message, unbounded — a busy fleet exhausts sockets and loses webhooks rather than delaying them",
            fix: "set maxConcurrent",
          },
        );
      }

      sendWebhook({
        event: "init",
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    },

    onConnection(client) {
      sendWebhook({
        event: "connect",
        timestamp: new Date().toISOString(),
        data: {
          identity: client.identity,
          ip: client.handshake.remoteAddress,
          protocol: client.protocol,
        },
      }).catch(() => {});
    },

    onDisconnect(client, code, reason) {
      sendWebhook({
        event: "disconnect",
        timestamp: new Date().toISOString(),
        data: {
          identity: client.identity,
          code,
          reason,
        },
      }).catch(() => {});
    },

    onSecurityEvent(event) {
      sendWebhook({
        event: "security",
        timestamp: event.timestamp,
        data: {
          type: event.type,
          identity: event.identity,
          ip: event.ip,
          details: event.details,
        },
      }).catch(() => {});
    },

    onAuthFailed(handshake, code, reason) {
      sendWebhook({
        event: "auth_failed",
        timestamp: new Date().toISOString(),
        data: {
          identity: handshake.identity,
          ip: handshake.remoteAddress,
          code,
          reason,
        },
      }).catch(() => {});
    },

    onEviction(evictedClient, newClient) {
      sendWebhook({
        event: "eviction",
        timestamp: new Date().toISOString(),
        data: {
          identity: evictedClient.identity,
          evictedIp: evictedClient.handshake.remoteAddress,
          newIp: newClient.handshake.remoteAddress,
        },
      }).catch(() => {});
    },

    onMessage(client, { message, direction, ctx }) {
      // Off unless "message" is in `events`; sendWebhook drops it otherwise.
      // The metadata alone is enough for latency and volume dashboards, so the
      // payload stays out unless asked for — it carries idTags and credentials,
      // and the redactor does not cover the responses this server sends.
      sendWebhook({
        event: "message",
        timestamp: ctx.timestamp,
        data: {
          identity: client.identity,
          direction,
          method: "method" in ctx ? ctx.method : undefined,
          messageId: "messageId" in ctx ? ctx.messageId : undefined,
          latencyMs: ctx.latencyMs,
          ...(options.includePayload ? { message } : {}),
        },
      }).catch(() => {});
    },

    onClosing() {
      // This is the only point a shutdown notification can be delivered: the
      // server awaits a promise returned from onClosing, while onClose() runs
      // after the drain and is synchronous. Returning the promise is what
      // makes the server wait instead of the request racing process exit.
      //
      // "close" is the name in the default event list; "closing" is honoured
      // for configs that named the hook instead. Previously this sent
      // "closing" unconditionally, which the default list does not allow, so
      // the shutdown webhook never fired at all.
      return sendWebhook({
        event: allowedEvents.has("closing") ? "closing" : "close",
        timestamp: new Date().toISOString(),
      });
    },

    onClose() {
      // Sync cleanup — no more webhooks. The shutdown notification is sent
      // from onClosing(), which the server awaits.
    },
  };
}
