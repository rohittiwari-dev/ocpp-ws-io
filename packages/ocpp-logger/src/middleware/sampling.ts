/**
 * @module voltlog
 * @description Sampling middleware — rate-limits logs per key to avoid flooding.
 *
 * @example
 * ```ts
 * import { createLogger, consoleTransport, samplingMiddleware } from 'voltlog';
 *
 * const logger = createLogger({
 *   transports: [consoleTransport()],
 *   middleware: [
 *     samplingMiddleware({
 *       keyFn: (entry) => `${entry.meta.action}:${entry.meta.chargePointId}`,
 *       maxPerWindow: 10,
 *       windowMs: 60_000, // 10 logs per minute per action+CP combo
 *     }),
 *   ],
 * });
 * ```
 */

import type { LogMiddleware, LogEntry } from "../core/types.js";

export interface SamplingOptions<TMeta = Record<string, unknown>> {
  /**
   * Function to extract a sampling key from a log entry.
   * Entries with the same key share a rate limit.
   * Default: uses `entry.message`
   */
  keyFn?: (entry: LogEntry<TMeta>) => string;
  /** Maximum entries allowed per key per window (default: 100) */
  maxPerWindow?: number;
  /** Time window in ms (default: 60000 = 1 minute) */
  windowMs?: number;
}

interface BucketEntry {
  count: number;
  windowStart: number;
}

/**
 * Create a sampling middleware that drops logs exceeding the rate limit.
 */
export function samplingMiddleware<TMeta = Record<string, unknown>>(
  options: SamplingOptions<TMeta> = {},
): LogMiddleware<TMeta> {
  const keyFn = options.keyFn ?? ((entry: LogEntry<TMeta>) => entry.message);
  const maxPerWindow = options.maxPerWindow ?? 100;
  const windowMs = options.windowMs ?? 60_000;
  const buckets = new Map<string, BucketEntry>();

  return (entry: LogEntry<TMeta>, next) => {
    const key = keyFn(entry);
    const now = entry.timestamp;

    let bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now };
      buckets.set(key, bucket);
    }

    bucket.count++;

    if (bucket.count <= maxPerWindow) {
      next(entry);
    }
    // else: entry is dropped (sampled out)

    // Periodic cleanup: remove stale buckets
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) {
        if (now - b.windowStart >= windowMs * 2) {
          buckets.delete(k);
        }
      }
    }
  };
}
