import type { OCPPPlugin } from "../types.js";

/**
 * Options for the async worker plugin.
 */
export interface AsyncWorkerOptions {
  /**
   * Maximum number of concurrent tasks.
   * @default 10
   */
  concurrency?: number;

  /**
   * Maximum queue depth. When exceeded, tasks are handled per `overflowStrategy`.
   * @default 1000
   */
  maxQueueSize?: number;

  /**
   * What to do when queue is full.
   * - `"drop-oldest"`: Remove oldest queued task (default)
   * - `"drop-newest"`: Reject the incoming task
   * @default "drop-oldest"
   */
  overflowStrategy?: "drop-oldest" | "drop-newest";

  /**
   * Error handler for failed tasks.
   */
  onError?: (error: Error, taskName: string) => void;

  /**
   * Logger for queue warnings (overflow, drain).
   */
  logger?: { warn: (...args: unknown[]) => void };

  /**
   * Drain timeout during shutdown (ms).
   * The worker will attempt to complete in-flight tasks before force-closing.
   * @default 5000
   */
  drainTimeoutMs?: number;
}

interface QueueEntry {
  name: string;
  fn: () => Promise<void>;
}

/**
 * Extended OCPPPlugin exposing `enqueue()`, `queueSize()`, and `activeCount()`.
 */
export interface AsyncWorkerPlugin extends OCPPPlugin {
  /**
   * Enqueue a task for non-blocking background execution.
   * Returns immediately — the task runs asynchronously.
   * @returns `true` if enqueued, `false` if dropped due to overflow.
   */
  enqueue(taskName: string, fn: () => Promise<void>): boolean;

  /** Current number of tasks waiting in the queue. */
  queueSize(): number;

  /** Number of currently executing tasks. */
  activeCount(): number;

  /** Total number of tasks dropped due to overflow since init. */
  droppedCount(): number;
}

/**
 * Background task queue for non-blocking plugin I/O.
 *
 * Provides a bounded, concurrent work queue that plugins can use to offload
 * slow operations (MQTT publish, DB write, HTTP call) without blocking the
 * OCPP message processing loop.
 *
 * @example
 * ```ts
 * import { asyncWorkerPlugin } from 'ocpp-ws-io/plugins';
 *
 * const worker = asyncWorkerPlugin({ concurrency: 20, maxQueueSize: 5000 });
 * server.plugin(worker);
 *
 * // From any hook:
 * worker.enqueue("db-write", async () => {
 *   await db.insert({ ... });
 * });
 * ```
 */
export function asyncWorkerPlugin(
  options?: AsyncWorkerOptions,
): AsyncWorkerPlugin {
  const concurrency = options?.concurrency ?? 10;
  const maxQueueSize = options?.maxQueueSize ?? 1000;
  const overflowStrategy = options?.overflowStrategy ?? "drop-oldest";
  const drainTimeoutMs = options?.drainTimeoutMs ?? 5000;

  const queue: QueueEntry[] = [];
  let active = 0;
  let dropped = 0;
  let accepting = true;
  let drainResolve: (() => void) | null = null;

  function tryFlush(): void {
    while (active < concurrency && queue.length > 0) {
      const entry = queue.shift()!;
      active++;
      entry
        .fn()
        .catch((err) => {
          if (options?.onError) {
            try {
              options.onError(
                err instanceof Error ? err : new Error(String(err)),
                entry.name,
              );
            } catch {
              // onError itself should never crash
            }
          }
        })
        .finally(() => {
          active--;
          // If draining and nothing left, resolve the drain promise
          if (
            !accepting &&
            active === 0 &&
            queue.length === 0 &&
            drainResolve
          ) {
            drainResolve();
            drainResolve = null;
          }
          // Continue processing queue
          tryFlush();
        });
    }
  }

  function enqueue(taskName: string, fn: () => Promise<void>): boolean {
    if (!accepting) return false;

    if (queue.length >= maxQueueSize) {
      if (overflowStrategy === "drop-newest") {
        dropped++;
        options?.logger?.warn?.(
          `[async-worker] Queue full (${maxQueueSize}), dropping task: ${taskName}`,
        );
        return false;
      }
      // drop-oldest
      const oldest = queue.shift();
      dropped++;
      options?.logger?.warn?.(
        `[async-worker] Queue full (${maxQueueSize}), dropping oldest task: ${oldest?.name ?? "unknown"}`,
      );
    }

    queue.push({ name: taskName, fn });
    tryFlush();
    return true;
  }

  const plugin: AsyncWorkerPlugin = {
    name: "async-worker",

    enqueue,
    queueSize: () => queue.length,
    activeCount: () => active,
    droppedCount: () => dropped,

    getCustomMetrics() {
      return [
        `# HELP ocpp_async_worker_queue_size Current tasks waiting in the background queue`,
        `# TYPE ocpp_async_worker_queue_size gauge`,
        `ocpp_async_worker_queue_size ${queue.length}`,
        `# HELP ocpp_async_worker_active_tasks Currently executing background tasks`,
        `# TYPE ocpp_async_worker_active_tasks gauge`,
        `ocpp_async_worker_active_tasks ${active}`,
        `# HELP ocpp_async_worker_dropped_total Tasks dropped due to queue overflow`,
        `# TYPE ocpp_async_worker_dropped_total counter`,
        `ocpp_async_worker_dropped_total ${dropped}`,
      ];
    },

    onClosing() {
      accepting = false;

      // If nothing in-flight, resolve immediately
      if (active === 0 && queue.length === 0) {
        return Promise.resolve();
      }

      // Wait for drain or timeout
      return new Promise<void>((resolve) => {
        drainResolve = resolve;

        // Force-resolve after timeout
        const timer = setTimeout(() => {
          options?.logger?.warn?.(
            `[async-worker] Drain timeout (${drainTimeoutMs}ms), ${active} tasks still active, ${queue.length} queued`,
          );
          // Clear remaining queue
          queue.length = 0;
          drainResolve = null;
          resolve();
        }, drainTimeoutMs);

        // Don't block process exit
        if (timer && typeof timer === "object" && "unref" in timer) {
          timer.unref();
        }
      });
    },

    onClose() {
      accepting = false;
      queue.length = 0;
      drainResolve = null;
    },
  };

  return plugin;
}
