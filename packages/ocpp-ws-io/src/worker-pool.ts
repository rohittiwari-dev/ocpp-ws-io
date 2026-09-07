import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

// ─── Worker Pool for Off-Thread JSON Parsing ────────────────────
//
// Round-robin task distribution across N worker threads.
// Each task uses a unique ID for response correlation via a shared
// callback map. Workers are reused across many messages.

export interface WorkerPoolOptions {
  /** Number of worker threads (default: Math.max(2, cpus - 2)) */
  poolSize?: number;
  /** Max pending parse jobs before rejecting (default: 10000) */
  maxQueueSize?: number;
  /** Override the worker entry path (used by tests; defaults to parse-worker.cjs next to this file) */
  workerPath?: string;
  /**
   * Give up on a parse after this long (default: 10000, 0 disables).
   *
   * A task that never settles is not merely a lost message: the caller awaits
   * it inside the per-connection inbound chain, so that connection stops
   * processing anything, permanently and silently.
   */
  taskTimeoutMs?: number;
}

interface PendingTask {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  /** Index of the worker this task was dispatched to (for crash recovery). */
  workerIndex: number;
  /** Cleared when the task settles. */
  timer?: ReturnType<typeof setTimeout>;
}

export interface ParseResult {
  message: unknown;
  validationError?: { schemaId: string; errors: string };
}

export class WorkerPool {
  /** Stop respawning a slot that will not stay up. */
  private static readonly _MAX_RESPAWNS = 10;
  private _workers: Worker[] = [];
  private _nextWorker = 0;
  private _taskId = 0;
  private _pending = new Map<number, PendingTask>();
  private _maxQueueSize: number;
  private _terminated = false;
  private readonly _workerPath: string;
  private readonly _taskTimeoutMs: number;
  /** Per-slot liveness: postMessage() to an exited worker does not throw. */
  private _workerAlive: boolean[] = [];
  /** Consecutive respawns per slot, for backoff. */
  private _respawns: number[] = [];
  private _respawnTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(options: WorkerPoolOptions = {}) {
    const poolSize = options.poolSize ?? Math.max(2, cpus().length - 2);
    this._maxQueueSize = options.maxQueueSize ?? 10_000;
    this._taskTimeoutMs = options.taskTimeoutMs ?? 10_000;

    // Resolve the worker entry point path.
    // parse-worker.cjs ships as a plain CJS file (copied into dist/ by the
    // build) so the same relative path works from src/ (tests) and dist/.
    this._workerPath =
      options.workerPath ?? resolve(__dirname, "parse-worker.cjs");
    if (!existsSync(this._workerPath)) {
      throw new Error(
        `WorkerPool: worker entry not found at ${this._workerPath}`,
      );
    }

    for (let i = 0; i < poolSize; i++) {
      this._workers.push(this._createWorker(i));
    }
  }

  /**
   * Create (or recreate) a worker bound to a fixed pool index, wiring up
   * message/error/exit handlers. On a crash the worker is respawned at the
   * same index and any tasks it owned are rejected so callers never hang.
   */
  private _createWorker(index: number): Worker {
    const worker = new Worker(this._workerPath);

    worker.on(
      "message",
      (response: {
        id: number;
        message?: unknown;
        validationError?: unknown;
        error?: string;
      }) => {
        const task = this._pending.get(response.id);
        if (!task) return;
        if (task.timer) clearTimeout(task.timer);
        this._pending.delete(response.id);

        if (response.error) {
          task.reject(new Error(response.error));
        } else {
          task.resolve({
            message: response.message,
            validationError: response.validationError,
          } as ParseResult);
        }
      },
    );

    worker.on("error", (err) => {
      console.error(`[WorkerPool] Worker ${index} error:`, err.message);
      // Fail-fast the tasks this worker owned instead of letting them hang.
      this._failWorkerTasks(index, `Worker ${index} crashed: ${err.message}`);
    });

    worker.on("exit", (code) => {
      this._workerAlive[index] = false;
      if (this._terminated) return;
      // Abnormal exit (a crash, not shutdown) — reject any stragglers and
      // respawn a replacement at the same index so the pool self-heals.
      this._failWorkerTasks(index, `Worker ${index} exited (code ${code})`);
      if (this._workers[index] !== worker) return;

      // Back off before respawning. A worker that dies on startup — a missing
      // entry file, a syntax error, an OOM that recurs immediately — used to
      // respawn instantly and die again, spinning a tight fork loop that burns
      // a core and floods the logs. Doubling delay, capped, and the counter
      // resets once a worker survives long enough to take work.
      const attempt = (this._respawns[index] ?? 0) + 1;
      this._respawns[index] = attempt;
      if (attempt > WorkerPool._MAX_RESPAWNS) {
        // Leave the slot dead; parse() routes around it.
        return;
      }
      const delay = Math.min(30_000, 100 * 2 ** (attempt - 1));
      const timer = setTimeout(() => {
        this._respawnTimers.delete(timer);
        if (this._terminated) return;
        try {
          this._workers[index] = this._createWorker(index);
        } catch {
          // If respawn fails, leave the slot; parse() guards against it.
        }
      }, delay);
      timer.unref?.();
      this._respawnTimers.add(timer);
    });

    this._workerAlive[index] = true;
    return worker;
  }

  /** Reject every pending task that was dispatched to the given worker index. */
  private _failWorkerTasks(index: number, reason: string): void {
    for (const [id, task] of this._pending) {
      if (task.workerIndex === index) {
        if (task.timer) clearTimeout(task.timer);
        task.reject(new Error(reason));
        this._pending.delete(id);
      }
    }
  }

  /** Number of worker threads in the pool */
  get size(): number {
    return this._workers.length;
  }

  /** Number of pending (unresolved) parse tasks */
  get pendingTasks(): number {
    return this._pending.size;
  }

  /**
   * Send raw data to a worker for JSON parsing + optional validation.
   * Uses round-robin worker selection.
   */
  parse(
    data: Buffer | string,
    schemaInfo?: { protocol: string; schemas: Record<string, unknown> },
  ): Promise<ParseResult> {
    if (this._terminated) {
      return Promise.reject(new Error("WorkerPool has been shut down"));
    }

    if (this._pending.size >= this._maxQueueSize) {
      return Promise.reject(
        new Error(
          `WorkerPool queue full (${this._maxQueueSize} pending tasks)`,
        ),
      );
    }

    // Round-robin, but skip slots whose worker has exited. postMessage() to a
    // terminated worker is a silent no-op rather than a throw, so the previous
    // try/catch never fired and the task simply hung — and the caller awaits it
    // inside the connection's inbound chain.
    let workerIndex = -1;
    for (let i = 0; i < this._workers.length; i++) {
      const candidate = (this._nextWorker + i) % this._workers.length;
      if (this._workerAlive[candidate]) {
        workerIndex = candidate;
        break;
      }
    }
    if (workerIndex === -1) {
      return Promise.reject(new Error("WorkerPool has no live workers"));
    }
    this._nextWorker = (workerIndex + 1) % this._workers.length;
    const worker = this._workers[workerIndex];

    return new Promise<ParseResult>((resolve, reject) => {
      const id = this._taskId++;

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (this._taskTimeoutMs > 0) {
        timer = setTimeout(() => {
          // Without this the task simply never settles, and the caller is
          // awaiting it inside the connection's inbound chain — so that
          // connection stops processing messages, permanently and silently.
          if (!this._pending.delete(id)) return;
          reject(
            new Error(
              `WorkerPool parse timed out after ${this._taskTimeoutMs}ms`,
            ),
          );
        }, this._taskTimeoutMs);
        timer.unref?.();
      }

      this._pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        workerIndex,
        timer,
      });

      try {
        worker.postMessage({ id, buffer: data, schemaInfo });
      } catch (err) {
        if (timer) clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  /** Gracefully terminate all workers */
  async shutdown(): Promise<void> {
    if (this._terminated) return;
    this._terminated = true;

    // Reject all pending tasks
    for (const [id, task] of this._pending) {
      task.reject(new Error("WorkerPool shutting down"));
      this._pending.delete(id);
    }

    // Terminate workers with a timeout
    const terminatePromises = this._workers.map(async (worker) => {
      try {
        await Promise.race([
          worker.terminate(),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      } catch {
        // Already terminated
      }
    });

    await Promise.allSettled(terminatePromises);
    this._workers = [];
  }
}

/**
 * Create a WorkerPool if worker_threads is available, otherwise return null.
 * Graceful fallback for environments where worker_threads is unavailable.
 */
export function createWorkerPool(
  options: WorkerPoolOptions = {},
): WorkerPool | null {
  try {
    return new WorkerPool(options);
  } catch {
    return null;
  }
}
