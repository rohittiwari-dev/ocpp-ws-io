/**
 * A concurrency-limited async queue.
 * Enqueues async functions and executes them with a configurable concurrency limit.
 */
export class Queue {
  private _concurrency: number;
  private _running = 0;
  private _queue: Array<{
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];

  constructor(concurrency = 1) {
    this._concurrency = Math.max(1, concurrency);
  }

  get concurrency(): number {
    return this._concurrency;
  }

  get pending(): number {
    return this._queue.length;
  }

  get running(): number {
    return this._running;
  }

  get size(): number {
    return this._running + this._queue.length;
  }

  setConcurrency(concurrency: number): void {
    this._concurrency = Math.max(1, concurrency);
    this._drain();
  }

  push<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this._queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this._drain();
    });
  }

  /**
   * Reject everything still queued and clear it. Tasks already running are left
   * alone — they own a slot and will release it themselves.
   */
  clear(reason: unknown): number {
    const dropped = this._queue.splice(0);
    for (const item of dropped) item.reject(reason);
    return dropped.length;
  }

  private _drain(): void {
    while (this._running < this._concurrency && this._queue.length > 0) {
      const item = this._queue.shift();
      if (!item) break;
      this._running++;

      // `fn()` may throw synchronously instead of returning a rejected
      // promise. Calling it bare let that throw escape _drain() before
      // .finally() was attached, so the slot taken by `this._running++` was
      // never released — a handful of those and the queue deadlocks with
      // nothing running.
      //
      // The call stays synchronous (callers rely on a task starting in the
      // same tick it is dequeued); only the throw is converted.
      let running: Promise<unknown>;
      try {
        running = item.fn();
      } catch (err) {
        running = Promise.reject(err);
      }

      Promise.resolve(running)
        .then(item.resolve, item.reject)
        .finally(() => {
          this._running--;
          this._drain();
        });
    }
  }
}
