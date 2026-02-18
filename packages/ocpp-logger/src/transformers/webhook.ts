/**
 * @module voltlog
 * @description Webhook transformer — sends log entries to external HTTP endpoints.
 * Supports batching for performance.
 *
 * @example
 * ```ts
 * import { createLogger, webhookTransport } from 'voltlog';
 *
 * const logger = createLogger({
 *   transports: [
 *     webhookTransport({
 *       url: 'https://my-api.com/logs',
 *       headers: { Authorization: 'Bearer token123' },
 *       batchSize: 50,
 *       flushIntervalMs: 5000,
 *     }),
 *   ],
 * });
 * ```
 */

import type { LogEntry, LogLevelName, Transformer } from "../core/types.js";

export interface WebhookTransportOptions {
  /** Target URL to POST log entries to */
  url: string;
  /** HTTP method (default: POST) */
  method?: string;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
  /** Number of entries to batch before sending (default: 1 = no batching) */
  batchSize?: number;
  /** Max time in ms to wait before flushing a partial batch (default: 5000) */
  flushIntervalMs?: number;
  /** Per-transport level filter */
  level?: LogLevelName;
  /** Custom body serializer. Default: JSON.stringify({ entries: [...] }) */
  serializer?: (entries: LogEntry[]) => string;
  /** Retry failed requests (default: false) */
  retry?: boolean;
  /** Max retries (default: 3) */
  maxRetries?: number;
}

/**
 * Create a webhook transformer that POSTs log entries to an HTTP endpoint.
 */
export function webhookTransport(
  options: WebhookTransportOptions,
): Transformer {
  const {
    url,
    method = "POST",
    headers = {},
    batchSize = 1,
    flushIntervalMs = 5000,
    retry = false,
    maxRetries = 3,
  } = options;

  const serialize =
    options.serializer ??
    ((entries: LogEntry[]) =>
      JSON.stringify({
        entries,
        count: entries.length,
        timestamp: Date.now(),
      }));

  let buffer: LogEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  async function sendBatch(entries: LogEntry[], attempt = 0): Promise<void> {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: serialize(entries),
      });

      if (!response.ok && retry && attempt < maxRetries) {
        // Exponential backoff retry
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise((r) => setTimeout(r, delay));
        return sendBatch(entries, attempt + 1);
      }
    } catch {
      if (retry && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise((r) => setTimeout(r, delay));
        return sendBatch(entries, attempt + 1);
      }
      /* Final failure — swallowed to avoid crashing the app */
    }
  }

  function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      doFlush();
    }, flushIntervalMs);
  }

  function doFlush(): void {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    // Fire-and-forget
    sendBatch(batch).catch(() => {});
  }

  return {
    name: "webhook",
    level: options.level,
    transform(entry: LogEntry): void {
      buffer.push(entry);

      if (buffer.length >= batchSize) {
        doFlush();
      } else {
        scheduleFlush();
      }
    },
    async flush(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (buffer.length > 0) {
        const batch = buffer;
        buffer = [];
        await sendBatch(batch);
      }
    },
    async close(): Promise<void> {
      await this.flush!();
    },
  };
}
