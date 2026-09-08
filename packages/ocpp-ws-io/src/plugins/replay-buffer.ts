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

/**
 * Actions whose meaning does not depend on when they arrive.
 *
 * A starting point for {@link ReplayBufferOptions.replayable}, not a rule —
 * these read state or ask the charger to report something, so replaying one
 * late is at worst redundant. Everything absent from this list acts on the
 * connector's *current* situation, which is precisely what has changed while
 * the charger was away:
 *
 * - `RemoteStartTransaction` starts a charge for the driver it was queued for,
 *   on a connector where somebody else may now be plugged in.
 * - `RemoteStopTransaction` carries a `transactionId` the charger may have
 *   reused, so it can stop an unrelated session.
 * - `UnlockConnector` releases whichever cable is in the connector now.
 * - `Reset` and `ChangeAvailability` interrupt whatever is running.
 *
 * Spread it and add back what your deployment can justify:
 *
 * ```ts
 * replayBufferPlugin({
 *   redis,
 *   replayable: [...SAFE_TO_REPLAY, "RemoteStopTransaction"],
 * })
 * ```
 */
export const SAFE_TO_REPLAY: readonly string[] = [
  "GetConfiguration",
  "GetCompositeSchedule",
  "GetDiagnostics",
  "GetLocalListVersion",
  "GetLog",
  "GetInstalledCertificateIds",
  "TriggerMessage",
  "ExtendedTriggerMessage",
  "DataTransfer",
  "GetBaseReport",
  "GetReport",
  "GetVariables",
  "GetMonitoringReport",
  "GetChargingProfiles",
  "GetTransactionStatus",
];

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
   * How old a queued command may be when the charger reconnects, before it is
   * discarded instead of replayed. (default: 300000 — five minutes)
   *
   * **This is the safety mechanism of this plugin, not a tuning knob.** These
   * commands act on whatever the connector is doing at the moment they arrive,
   * not on the situation that prompted them. A `RemoteStartTransaction` queued
   * for one driver and delivered an hour later reaches a connector where a
   * different driver has since started a session with an offline RFID tag —
   * and starts, or bills, the wrong person. `UnlockConnector` releases a cable
   * that now belongs to someone else. `RemoteStopTransaction` carries a
   * `transactionId` that a charger may well have reused by then.
   *
   * The offline window this plugin is for is a network blip of seconds to
   * minutes. Past that the world has moved on and the command is not merely
   * late, it is wrong. Expired entries are dropped with a warning.
   *
   * Set `0` to disable expiry and replay regardless of age — only when every
   * queued command is genuinely time-independent.
   */
  maxQueueAgeMs?: number;

  /**
   * Which commands may still be replayed. Unset replays everything that is
   * within `maxQueueAgeMs`.
   *
   * Give an array to allow only those actions — an allow-list, not a
   * deny-list, so an action nobody anticipated is dropped rather than replayed
   * by default:
   *
   * ```ts
   * replayable: [...SAFE_TO_REPLAY, "RemoteStopTransaction"],
   * ```
   *
   * Give a function when the decision depends on more than the action — how
   * long it has waited, say, since a `GetConfiguration` is safe whenever it
   * lands and a `RemoteStartTransaction` stops being safe quickly:
   *
   * ```ts
   * replayable: (action, ageMs) =>
   *   action.startsWith("Get") || ageMs < 30_000,
   * ```
   *
   * See {@link SAFE_TO_REPLAY} for a starting point.
   */
  replayable?: string[] | ((action: string, ageMs: number) => boolean);

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
 * ⚠️ **A queued command acts on whatever the connector is doing when it
 * arrives, not on the situation that prompted it.** That is only safe while
 * the gap is short. A `RemoteStartTransaction` queued for one driver and
 * delivered an hour later reaches a connector where a different driver has
 * since started a session with an offline RFID tag, and starts or bills the
 * wrong person; `UnlockConnector` releases a cable that is now somebody
 * else's; `RemoteStopTransaction` carries a `transactionId` the charger may
 * have reused. `maxQueueAgeMs` (default five minutes) exists for exactly this
 * and is the safety mechanism of the plugin, not a tuning knob — use
 * `replayable` for finer control per action.
 *
 * ⚠️ **`syntheticResponse` is on by default and returns
 * `{ status: "Accepted" }`**, which in OCPP is the charger's own answer
 * meaning it will carry the command out. A caller cannot distinguish a
 * delivered command from a parked one, so a CSMS will tell the driver the
 * session is starting when nothing has reached the charger. Set it to `false`
 * if the caller needs to know the difference.
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
  const maxQueueAgeMs = options.maxQueueAgeMs ?? 300_000;
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

  // An array is an allow-list, so an action nobody anticipated is dropped
  // rather than replayed. Resolved once here rather than per command.
  const allowed = Array.isArray(options.replayable)
    ? new Set(options.replayable)
    : null;

  function isReplayable(action: string, ageMs: number): boolean {
    if (allowed) return allowed.has(action);
    if (typeof options.replayable === "function") {
      return options.replayable(action, ageMs);
    }
    return true;
  }

  /**
   * How long this command has been queued, or null when it predates the
   * timestamp. Entries with no stamp are replayed rather than discarded —
   * dropping a queue on upgrade would be its own kind of loss.
   */
  function readAgeMs(parsed: unknown[]): number | null {
    const queuedAt = parsed[5];
    if (typeof queuedAt !== "number" || !Number.isFinite(queuedAt)) return null;
    return Math.max(0, Date.now() - queuedAt);
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
          // Slots five and six carry the replay attempt count and the moment
          // this was queued. Entries written before those existed have four
          // and read as no attempts and unknown age.
          const payload = JSON.stringify([
            2,
            ctx.messageId,
            ctx.method,
            ctx.params,
            0,
            Date.now(),
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

            const action = String(parsed[2]);
            const ageMs = readAgeMs(parsed);

            // These commands act on whatever the connector is doing when they
            // arrive, not on the situation that prompted them. Replayed late
            // enough, a RemoteStartTransaction reaches a connector where a
            // different driver has since started a session with an offline
            // tag, and starts or bills the wrong person; UnlockConnector
            // releases a cable that is now somebody else's.
            if (maxQueueAgeMs > 0 && ageMs !== null && ageMs > maxQueueAgeMs) {
              log?.warn?.(
                `[replay-buffer] Discarding ${action} for ${client.identity}: queued ${Math.round(ageMs / 1000)}s ago, past the ${Math.round(maxQueueAgeMs / 1000)}s limit`,
              );
              continue;
            }

            if (!isReplayable(action, ageMs ?? 0)) {
              log?.warn?.(
                `[replay-buffer] Discarding ${action} for ${client.identity}: not in the replayable set`,
              );
              continue;
            }

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
                      // The original queue time is kept deliberately. Stamping
                      // it afresh on each retry would let a command outlive
                      // the age limit indefinitely by being retried.
                      parsed[5],
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
