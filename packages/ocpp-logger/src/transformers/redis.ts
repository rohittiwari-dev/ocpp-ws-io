/**
 * @module voltlog
 * @description Redis Streams transformer — publishes log entries to a Redis Stream.
 * Users can then subscribe (XREAD/XREADGROUP) for real-time dashboards, monitoring, etc.
 *
 * Requires `ioredis` — user brings their own client instance (no hard dep).
 *
 * @example Basic
 * ```ts
 * import Redis from 'ioredis';
 * import { createLogger, redisTransport } from 'voltlog';
 *
 * const redis = new Redis();
 * const logger = createLogger({
 *   transports: [
 *     redisTransport({ client: redis, streamKey: 'logs:ocpp' }),
 *   ],
 * });
 *
 * logger.info('CP connected', { chargePointId: 'CP-101' });
 * // → XADD logs:ocpp * level INFO message "CP connected" ...
 * ```
 *
 * @example With TTL and max stream length
 * ```ts
 * redisTransport({
 *   client: redis,
 *   streamKey: 'logs:ocpp',
 *   maxLen: 10_000,        // keep last 10k entries (approximate trim)
 * })
 * ```
 *
 * @example Subscribing (consumer side)
 * ```ts
 * // In your dashboard / monitoring service:
 * const redis = new Redis();
 *
 * // Read new entries from the stream
 * const entries = await redis.xread('BLOCK', 0, 'STREAMS', 'logs:ocpp', '$');
 *
 * // Or use consumer groups for at-least-once delivery:
 * await redis.xgroup('CREATE', 'logs:ocpp', 'dashboard', '$', 'MKSTREAM');
 * const entries = await redis.xreadgroup(
 *   'GROUP', 'dashboard', 'worker-1',
 *   'BLOCK', 0, 'STREAMS', 'logs:ocpp', '>'
 * );
 * ```
 */

import type { LogEntry, LogLevelName, Transformer } from "../core/types.js";

/**
 * Minimal interface for the Redis client methods we need.
 * Compatible with `ioredis` — user provides their own instance.
 */
export interface RedisClient {
  xadd(...args: (string | number)[]): Promise<string | null>;
  quit?(): Promise<void>;
}

export interface RedisTransportOptions {
  /** Redis client instance (e.g. `new Redis()` from ioredis) */
  client: RedisClient;
  /** Redis Stream key to publish to (default: 'logs') */
  streamKey?: string;
  /**
   * Max approximate stream length — older entries are trimmed.
   * Uses MAXLEN ~ (approximate) to keep the stream bounded.
   * Default: no limit.
   */
  maxLen?: number;
  /** Per-transport level filter */
  level?: LogLevelName;
  /**
   * Custom field mapper — convert LogEntry to flat key-value pairs for Redis.
   * Default: serializes the entire entry as JSON under a single 'data' field.
   */
  fieldMapper?: (entry: LogEntry) => Record<string, string>;
}

/**
 * Create a Redis Streams transformer.
 *
 * Publishes each log entry via XADD to a Redis Stream.
 * Fire-and-forget — errors are silently swallowed to avoid blocking.
 */
export function redisTransport(options: RedisTransportOptions): Transformer {
  const { client, streamKey = "logs", maxLen, level } = options;

  const fieldMapper = options.fieldMapper ?? defaultFieldMapper;

  function defaultFieldMapper(entry: LogEntry): Record<string, string> {
    return {
      id: entry.id,
      level: String(entry.level),
      levelName: entry.levelName,
      message: entry.message,
      timestamp: String(entry.timestamp),
      data: JSON.stringify({
        meta: entry.meta,
        context: entry.context,
        correlationId: entry.correlationId,
        error: entry.error,
      }),
    };
  }

  return {
    name: "redis",
    level,
    transform(entry: LogEntry): void {
      const fields = fieldMapper(entry);
      const args: (string | number)[] = [streamKey];

      // Approximate trimming to bound stream length
      if (maxLen) {
        args.push("MAXLEN", "~", maxLen);
      }

      args.push("*"); // auto-generate stream entry ID

      // Flatten fields into [key, value, key, value, ...]
      for (const [key, value] of Object.entries(fields)) {
        args.push(key, value);
      }

      // Fire-and-forget
      client.xadd(...args).catch(() => {
        /* Swallowed — never crash the app */
      });
    },
    async close(): Promise<void> {
      // Don't close the user's Redis client — they own it
    },
  };
}
