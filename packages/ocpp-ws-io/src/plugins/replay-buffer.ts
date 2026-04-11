import type { MiddlewareFunction } from "../middleware.js";
import type { MiddlewareContext, OCPPPlugin } from "../types.js";

export interface ReplayRedisLike {
  rpush(key: string, ...values: string[]): Promise<number>;
  lpop(key: string): Promise<string | null>;
}

export interface ReplayBufferOptions {
  /** User-provided Redis instance */
  redis: ReplayRedisLike;

  /**
   * Prefix for Redis keys
   * @default "ocpp:replay:"
   */
  prefix?: string;

  /**
   * If true, queued messages will return a synthetic response to the caller
   * immediately, rather than letting the caller timeout or fail.
   * @default true
   */
  syntheticResponse?: boolean;

  /**
   * Maximum number of messages to flush concurrently on reconnection.
   * Prevents overwhelming a freshly-connected client.
   * @default 5
   */
  flushConcurrency?: number;

  /**
   * Delay in ms between each flush batch to avoid overwhelming the client.
   * @default 200
   */
  flushDelayMs?: number;

  /**
   * Optional logger. Falls back to silent no-op if not provided.
   */
  logger?: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Replay Buffer Plugin (Level 3: Interceptor)
 *
 * Provides a persistent, distributed offline queue for backend-initiated
 * commands (like RemoteStopTransaction or UnlockConnector).
 *
 * If a call is made to an offline client, this plugin intercepts the error,
 * queues the message in Redis, and automatically flushes the queue when the
 * client reconnects (even if it reconnects to a different server node).
 *
 * @example
 * ```ts
 * server.plugin(replayBufferPlugin({
 *   redis,
 *   flushConcurrency: 3,
 *   logger: pino(),
 * }));
 * ```
 */
export function replayBufferPlugin(options: ReplayBufferOptions): OCPPPlugin {
  const redis = options.redis;
  const prefix = options.prefix ?? "ocpp:replay:";
  const synthetic = options.syntheticResponse ?? true;
  const flushConcurrency = options.flushConcurrency ?? 5;
  const flushDelayMs = options.flushDelayMs ?? 200;
  const log = options.logger;

  // Track active flush operations so we can wait on shutdown
  const activeFlushes = new Set<Promise<void>>();

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    name: "replay-buffer",

    onConnection(client) {
      const queueKey = `${prefix}${client.identity}`;

      // 1. Inject middleware to intercept OUTGOING calls to offline clients
      const interceptor: MiddlewareFunction<MiddlewareContext> = async (
        ctx,
        next,
      ) => {
        if (ctx.type !== "outgoing_call") {
          return next();
        }

        try {
          return await next();
        } catch (err: unknown) {
          // Check if this is an offline/socket-closed error
          const message = err instanceof Error ? err.message : String(err);
          const isOffline =
            message.includes("WebSocket is not open") ||
            message.includes("offline") ||
            message.includes("CLOSED") ||
            message.includes("CLOSING");

          if (!isOffline) {
            throw err;
          }

          // Queue the message in Redis for later replay
          const payload = JSON.stringify([
            2,
            ctx.messageId,
            ctx.method,
            ctx.params,
          ]);

          try {
            await redis.rpush(queueKey, payload);
            log?.warn?.(
              `[replay-buffer] Queued offline command: ${ctx.method} for ${client.identity}`,
            );
          } catch (redisErr) {
            log?.error?.(
              `[replay-buffer] Redis rpush failed for ${client.identity}:`,
              redisErr,
            );
            throw err; // Re-throw the original error if Redis fails too
          }

          if (synthetic) {
            // Return a fake success so the caller's Promise resolves
            return {
              status: "Accepted",
              note: "Queued offline (ReplayBuffer)",
            };
          }

          // If not synthetic, throw so the caller knows it failed (but it's queued)
          throw err;
        }
      };

      client.use(interceptor);

      // 2. Flush any pending messages with bounded concurrency
      const flushPromise = (async () => {
        try {
          let inflight = 0;

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const msg = await redis.lpop(queueKey);
            if (!msg) break;

            let parsed: unknown;
            try {
              parsed = JSON.parse(msg);
            } catch {
              log?.warn?.(
                `[replay-buffer] Skipping unparseable queued message for ${client.identity}`,
              );
              continue;
            }

            if (!Array.isArray(parsed) || parsed[0] !== 2) continue;

            // Send through the client's call() — it will assign a fresh MessageID
            client.call(parsed[2], parsed[3]).catch((callErr) => {
              log?.warn?.(
                `[replay-buffer] Flush call failed for ${client.identity}/${parsed[2]}:`,
                callErr,
              );
              // The interceptor middleware will re-queue if the client disconnected again
            });

            inflight++;

            // Throttle: wait between batches to respect callConcurrency
            if (inflight >= flushConcurrency) {
              await sleep(flushDelayMs);
              inflight = 0;
            }
          }
        } catch (err) {
          log?.error?.(
            `[replay-buffer] Error flushing queue for ${client.identity}:`,
            err,
          );
        }
      })();

      activeFlushes.add(flushPromise);
      flushPromise.finally(() => activeFlushes.delete(flushPromise));
    },

    async onClosing() {
      // Wait for any active flush operations to complete before shutdown
      if (activeFlushes.size > 0) {
        await Promise.allSettled([...activeFlushes]);
      }
    },

    onClose() {
      activeFlushes.clear();
    },
  };
}
