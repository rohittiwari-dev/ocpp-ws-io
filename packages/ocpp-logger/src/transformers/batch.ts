/**
 * @module voltlog
 * @description Batch wrapper — wraps any transformer with buffering and periodic flushing.
 *
 * @example
 * ```ts
 * import { createLogger, batchTransport, consoleTransport } from 'voltlog';
 *
 * // Batch console output: flush every 100 entries or every 2 seconds
 * const logger = createLogger({
 *   transports: [
 *     batchTransport(consoleTransport(), { batchSize: 100, flushIntervalMs: 2000 }),
 *   ],
 * });
 * ```
 */

import type { LogEntry, Transformer } from "../core/types.js";

export interface BatchTransportOptions {
  /** Number of entries to buffer before flushing (default: 100) */
  batchSize?: number;
  /** Max time in ms to wait before flushing a partial batch (default: 5000) */
  flushIntervalMs?: number;
}

/**
 * Wrap any transformer with batching. Entries are buffered and flushed
 * either when the batch is full or the timer fires.
 */
export function batchTransport(
  inner: Transformer,
  options: BatchTransportOptions = {},
): Transformer {
  const batchSize = options.batchSize ?? 100;
  const flushIntervalMs = options.flushIntervalMs ?? 5000;

  let buffer: LogEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

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
    for (const entry of batch) {
      try {
        const result = inner.transform(entry);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => {});
        }
      } catch {
        /* Swallowed */
      }
    }
  }

  return {
    name: `batch(${inner.name})`,
    level: inner.level,
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
      doFlush();
      await inner.flush?.();
    },
    async close(): Promise<void> {
      await this.flush!();
      await inner.close?.();
    },
  };
}
