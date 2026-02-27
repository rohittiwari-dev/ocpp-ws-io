import { createHmac } from "node:crypto";
import type { OCPPPlugin } from "../types.js";

/**
 * Options for the webhook plugin.
 */
export interface WebhookPluginOptions {
  /** Webhook HTTP endpoint URL. */
  url: string;
  /** Which lifecycle events to send (default: all). */
  events?: Array<"init" | "connect" | "disconnect" | "close">;
  /** Custom HTTP headers to include (e.g. Authorization). */
  headers?: Record<string, string>;
  /** HMAC-SHA256 secret for signing payloads (sent as `X-Signature` header). */
  secret?: string;
  /** Fetch timeout in ms (default: 5000). */
  timeout?: number;
  /** Number of retries on failure (default: 1). */
  retries?: number;
}

interface WebhookPayload {
  event: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Sends HTTP POST webhooks on server lifecycle events.
 * Uses Node.js built-in `fetch` (Node 18+).
 *
 * @example
 * ```ts
 * import { webhookPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(webhookPlugin({
 *   url: 'https://api.example.com/ocpp-events',
 *   secret: process.env.WEBHOOK_SECRET,
 *   events: ['connect', 'disconnect'],
 *   headers: { Authorization: 'Bearer token123' },
 * }));
 * ```
 */
export function webhookPlugin(options: WebhookPluginOptions): OCPPPlugin {
  const allowedEvents = new Set(
    options.events ?? ["init", "connect", "disconnect", "close"],
  );
  const timeout = options.timeout ?? 5000;
  const maxRetries = options.retries ?? 1;

  async function sendWebhook(payload: WebhookPayload): Promise<void> {
    if (!allowedEvents.has(payload.event as any)) return;

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    // HMAC-SHA256 signature
    if (options.secret) {
      const signature = createHmac("sha256", options.secret)
        .update(body)
        .digest("hex");
      headers["X-Signature"] = signature;
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        await fetch(options.url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);
        return; // Success
      } catch {
        if (attempt === maxRetries) {
          // Silently fail — webhooks should not crash the server
        }
      }
    }
  }

  return {
    name: "webhook",

    onInit() {
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

    onClose() {
      // Fire-and-forget — don't block server shutdown
      sendWebhook({
        event: "close",
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    },
  };
}
