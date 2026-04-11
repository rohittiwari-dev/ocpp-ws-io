import { createHmac } from "node:crypto";
import type { OCPPPlugin } from "../types.js";

type WebhookEvent =
  | "init"
  | "connect"
  | "disconnect"
  | "close"
  | "security"
  | "auth_failed"
  | "eviction"
  | "closing";

/**
 * Options for the webhook plugin.
 */
export interface WebhookPluginOptions {
  /** Webhook HTTP endpoint URL. */
  url: string;
  /** Which lifecycle events to send (default: lifecycle events only). */
  events?: WebhookEvent[];
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

  async function sendWebhook(payload: WebhookPayload): Promise<void> {
    if (!allowedEvents.has(payload.event as WebhookEvent)) return;

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

    onClosing() {
      sendWebhook({
        event: "closing",
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    },

    onClose() {
      // Sync cleanup — no more webhooks. Shutdown notification
      // was already sent via onClosing() which is properly awaited.
    },
  };
}
