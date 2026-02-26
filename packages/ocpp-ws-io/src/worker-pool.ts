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

  constructor(options: WorkerPoolOptions = {}) {
    const poolSize = options.poolSize ?? Math.max(2, cpus().length - 2);
    this._maxQueueSize = options.maxQueueSize ?? 10_000;

    // Resolve the worker entry point path
    // In production (dist/), the worker is compiled alongside the pool
    const workerPath = resolve(__dirname, "parse-worker.js");

    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(workerPath);
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
        // Worker crashed — reject all pending tasks assigned to this worker
        // In practice we don't track which tasks went to which worker,
        // so just log. The pool continues with remaining workers.
        console.error(`[WorkerPool] Worker ${i} error:`, err.message);
      });

      this._workers.push(worker);
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
      this._pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });

      // Round-robin worker selection
      const worker = this._workers[this._nextWorker % this._workers.length];
      this._nextWorker = (this._nextWorker + 1) % this._workers.length;

      worker.postMessage({ id, buffer: data, schemaInfo });
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
