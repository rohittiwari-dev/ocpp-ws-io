import type { MiddlewareFunction } from "../middleware.js";
import type { MiddlewareContext, OCPPPlugin } from "../types.js";

export interface ReplayRedisLike {
  rpush(key: string, ...values: string[]): Promise<number>;
  lpop(key: string): Promise<string | null>;
  /**
   * Push back onto the head of the queue.
   *
   * Optional so an existing client object keeps working, but without it a
   * command whose replay fails cannot be returned to the queue and is dropped
   * — see `maxReplayAttempts`. Both ioredis and node-redis provide it.
   */
  lpush?(key: string, ...values: string[]): Promise<number>;
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
   * How many times one queued command may be replayed before it is dropped.
   * @default 3
   *
   * A command is removed from Redis before it is replayed, and the interceptor
   * only re-queues errors that look like a closed socket. Anything else — a
   * timeout, a CALLERROR from the charger, a rejection from another plugin —
   * used to lose the command outright, in a plugin whose whole purpose is not
   * losing them. A failed replay is now returned to the head of the queue
   * until this many attempts have been made, then dropped with an error.
   *
   * Requires `lpush` on the Redis client. Set `0` for the previous
   * behaviour of one attempt and no return to the queue.
   */
  maxReplayAttempts?: number;

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
  const maxReplayAttempts = options.maxReplayAttempts ?? 3;
  const log = options.logger;

  // Track active flush operations so we can wait on shutdown
  const activeFlushes = new Set<Promise<void>>();

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * How many times this command has already been replayed.
   *
   * The count rides in a fifth slot appended to the queued frame. Entries
   * written before this existed have four, and read as zero attempts.
   */
  function readAttempts(parsed: unknown[]): number {
    const n = parsed[4];
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
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
          // Replays are fired without awaiting, so failures are collected here
          // and returned to the queue once the drain has finished. Pushing back
          // inside the loop would hand the very next lpop the same message.
          const pending: Promise<void>[] = [];
          const requeue: string[] = [];

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
            pending.push(
              client.call(parsed[2], parsed[3]).then(
                () => {},
                (callErr) => {
                  // The interceptor re-queues a closed socket. Every other
                  // failure reaches here having already been lpop'd, so
                  // without this the command is simply gone.
                  const attempts = readAttempts(parsed) + 1;
                  const exhausted =
                    maxReplayAttempts <= 0 || attempts >= maxReplayAttempts;

                  if (exhausted || !redis.lpush) {
                    log?.error?.(
                      `[replay-buffer] Dropping queued ${parsed[2]} for ${client.identity} after ${attempts} attempt(s):`,
                      callErr,
                    );
                    return;
                  }

                  log?.warn?.(
                    `[replay-buffer] Replay of ${parsed[2]} for ${client.identity} failed (attempt ${attempts}), returning it to the queue:`,
                    callErr,
                  );
                  requeue.push(
                    JSON.stringify([
                      2,
                      parsed[1],
                      parsed[2],
                      parsed[3],
                      attempts,
                    ]),
                  );
                },
              ),
            );

            inflight++;

            // Throttle: wait between batches to respect callConcurrency
            if (inflight >= flushConcurrency) {
              await sleep(flushDelayMs);
              inflight = 0;
            }
          }

          // Wait for the replays before deciding what survived, then restore
          // the failures at the head so their order relative to each other is
          // kept and they are tried first on the next flush.
          await Promise.allSettled(pending);
          if (requeue.length > 0 && redis.lpush) {
            await redis
              .lpush(queueKey, ...requeue.reverse())
              .catch((pushErr: unknown) => {
                log?.error?.(
                  `[replay-buffer] Could not return ${requeue.length} command(s) to the queue for ${client.identity}:`,
                  pushErr,
                );
              });
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
