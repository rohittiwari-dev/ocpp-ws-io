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
}

interface PendingTask {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  /** Index of the worker this task was dispatched to (for crash recovery). */
  workerIndex: number;
}

export interface ParseResult {
  message: unknown;
  validationError?: { schemaId: string; errors: string };
}

export class WorkerPool {
  private _workers: Worker[] = [];
  private _nextWorker = 0;
  private _taskId = 0;
  private _pending = new Map<number, PendingTask>();
  private _maxQueueSize: number;
  private _terminated = false;
  private readonly _workerPath: string;

  constructor(options: WorkerPoolOptions = {}) {
    const poolSize = options.poolSize ?? Math.max(2, cpus().length - 2);
    this._maxQueueSize = options.maxQueueSize ?? 10_000;

    // Resolve the worker entry point path
    // In production (dist/), the worker is compiled alongside the pool
    this._workerPath = resolve(__dirname, "parse-worker.js");

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
      if (this._terminated) return;
      // Abnormal exit (a crash, not shutdown) — reject any stragglers and
      // respawn a replacement at the same index so the pool self-heals.
      this._failWorkerTasks(index, `Worker ${index} exited (code ${code})`);
      if (this._workers[index] === worker) {
        try {
          this._workers[index] = this._createWorker(index);
        } catch {
          // If respawn fails, leave the slot; parse() guards against a dead worker.
        }
      }
    });

    return worker;
  }

  /** Reject every pending task that was dispatched to the given worker index. */
  private _failWorkerTasks(index: number, reason: string): void {
    for (const [id, task] of this._pending) {
      if (task.workerIndex === index) {
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

    return new Promise<ParseResult>((resolve, reject) => {
      const id = this._taskId++;

      // Round-robin worker selection
      const workerIndex = this._nextWorker % this._workers.length;
      const worker = this._workers[workerIndex];
      this._nextWorker = (this._nextWorker + 1) % this._workers.length;

      this._pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        workerIndex,
      });

      try {
        worker.postMessage({ id, buffer: data, schemaInfo });
      } catch (err) {
        // Dead/closed worker — fail fast rather than hang.
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
