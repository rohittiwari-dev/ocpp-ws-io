import type { OCPPPlugin } from "../types.js";

/**
 * Minimal Redis interface for the Deduplication plugin.
 * Supports **both** ioredis positional-arg style and node-redis v4 options-object style.
 *
 * Users bring their own Redis client (e.g., ioredis, node-redis).
 */
export interface DedupRedisLike {
  /**
   * Sets a key with NX + PX semantics.
   *
   * **ioredis style:** `set(key, value, "PX", ms, "NX")` → `Promise<"OK" | null>`
   * **node-redis v4 style:** `set(key, value, { PX: ms, NX: true })` → `Promise<string | null>`
   */
  set(
    key: string,
    value: string,
    ...args: unknown[]
  ): Promise<"OK" | string | null> | ("OK" | string | null);

  /**
   * Fetch a cached value (used to replay responses for duplicate CALLs).
   * Optional — without it duplicates are silently dropped.
   */
  get?(key: string): Promise<string | null> | (string | null);
}

export interface MessageDedupOptions {
  /**
   * User-provided Redis instance.
   * Compatible with both `ioredis` and `node-redis` (v4+).
   */
  redis: DedupRedisLike;

  /**
   * Time-to-Live for the deduplication cache in milliseconds.
   * @default 300000 (5 minutes)
   */
  ttlMs?: number;

  /**
   * Prefix for Redis keys.
   * @default "ocpp:dedup:"
   */
  prefix?: string;

  /**
   * Which Redis calling convention to use:
   * - `"positional"` (ioredis): `set(key, val, "PX", ms, "NX")`
   * - `"options"` (node-redis v4): `set(key, val, { PX: ms, NX: true })`
   * @default "positional"
   */
  redisStyle?: "positional" | "options";

  /**
   * Optional logger. Falls back to silent no-op if not provided.
   */
  logger?: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Message Deduplication Plugin (Level 3: Interceptor)
 *
 * Prevents processing of duplicate messages from edge devices. When a bad
 * mobile network connection causes a charging station to send the SAME
 * message multiple times, this plugin catches and drops the duplicates
 * before the application logic processes them.
 *
 * It hooks into `onBeforeReceive` and returns `false` to block execution
 * if a message with the identical unique MessageID is found in Redis.
 *
 * @example ioredis (default)
 * ```ts
 * import Redis from 'ioredis';
 * const redis = new Redis();
 *
 * server.plugin(messageDedupPlugin({
 *   redis,
 *   ttlMs: 60 * 1000 // Remember messages for 1 minute
 * }));
 * ```
 *
 * @example node-redis v4
 * ```ts
 * import { createClient } from 'redis';
 * const redis = createClient();
 * await redis.connect();
 *
 * server.plugin(messageDedupPlugin({
 *   redis,
 *   redisStyle: 'options',
 *   ttlMs: 60 * 1000,
 * }));
 * ```
 */
export function messageDedupPlugin(options: MessageDedupOptions): OCPPPlugin {
  const redis = options.redis;
  const ttlMs = options.ttlMs ?? 300000;
  const prefix = options.prefix ?? "ocpp:dedup:";
  const style = options.redisStyle ?? "positional";
  const log = options.logger;

  /** Execute SET with NX+PX using the configured calling convention */
  async function setNX(key: string): Promise<boolean> {
    if (style === "options") {
      // node-redis v4 style: set(key, value, { PX: ms, NX: true })
      const result = await redis.set(key, "1", { PX: ttlMs, NX: true });
      return result !== null;
    }
    // ioredis style: set(key, value, "PX", ms, "NX")
    const result = await redis.set(key, "1", "PX", ttlMs, "NX");
    return result === "OK";
  }

  /** Plain SET with PX expiry, used to cache responses for replay */
  async function setPX(key: string, value: string): Promise<void> {
    if (style === "options") {
      await redis.set(key, value, { PX: ttlMs });
    } else {
      await redis.set(key, value, "PX", ttlMs);
    }
  }

  return {
    name: "message-dedup",

    /**
     * Intercepts CALL messages before they are parsed or routed.
     * Duplicates are dropped; if the original's response is already cached,
     * it is replayed so retrying chargers are not left to time out.
     */
    async onBeforeReceive(client, rawData) {
      let parsed: unknown;
      try {
        const str =
          typeof rawData === "string" ? rawData : rawData?.toString() || "";
        parsed = JSON.parse(str);
      } catch {
        // If it isn't valid JSON, let it pass through to the core validator
        // which will emit proper OCPP protocol errors.
        return undefined;
      }

      // Only CALLs are idempotency-checked — CALLRESULT/CALLERROR ids
      // legitimately repeat the CALL id they answer (report M11).
      if (
        !Array.isArray(parsed) ||
        parsed[0] !== 2 ||
        typeof parsed[1] !== "string"
      ) {
        return undefined;
      }
      const messageId = parsed[1];
      const key = `${prefix}${client.identity}:${messageId}`;

      try {
        const acquired = await setNX(key);
        if (!acquired) {
          // Duplicate. Replay the original response when available so the
          // retrying charger gets its answer (idempotent retry semantics).
          if (redis.get) {
            const cached = await redis.get(
              `${prefix}resp:${client.identity}:${messageId}`,
            );
            if (cached) {
              try {
                client.sendRaw(cached);
              } catch {
                // socket gone — nothing to replay to
              }
            }
          }
          log?.warn?.(`[message-dedup] Dropping duplicate message: ${key}`);
          return false;
        }
      } catch (err) {
        // If Redis is down, we must fail open to keep the charging station online.
        log?.error?.(`[message-dedup] Redis failure, falling through:`, err);
      }

      // Undefined strictly continues the middleware chain
      return undefined;
    },

    /**
     * Caches outbound CALLRESULT/CALLERROR frames keyed by message id so
     * duplicate CALL retries can be replayed.
     */
    onBeforeSend(client, message) {
      if (
        Array.isArray(message) &&
        (message[0] === 3 || message[0] === 4) &&
        typeof message[1] === "string" &&
        redis.get // replay only useful when reads are possible
      ) {
        const respKey = `${prefix}resp:${client.identity}:${message[1]}`;
        Promise.resolve(setPX(respKey, JSON.stringify(message))).catch(
          () => {},
        );
      }
      return true;
    },
  };
}
