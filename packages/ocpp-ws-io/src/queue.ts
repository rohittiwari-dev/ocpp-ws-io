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

  private _drain(): void {
    while (this._running < this._concurrency && this._queue.length > 0) {
      const item = this._queue.shift()!;
      this._running++;

      item
        .fn()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this._running--;
          this._drain();
        });
    }
  }
}
