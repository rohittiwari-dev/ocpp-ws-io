import { describe, expect, test, vi } from "vitest";
import { Queue } from "../src/queue.js";

describe("Queue robustness", () => {
  // `item?.fn()` was called bare. A task that throws synchronously — rather
  // than returning a rejected promise — escaped _drain() before .finally() was
  // attached, so `_running` was incremented and never decremented. A few of
  // those and the queue deadlocks with nothing running and nothing draining.
  test("a synchronously throwing task releases its concurrency slot", async () => {
    const q = new Queue(1);

    await expect(
      q.push(() => {
        throw new Error("sync boom");
      }),
    ).rejects.toThrow("sync boom");

    expect(q.running).toBe(0);
    expect(q.pending).toBe(0);

    // The queue must still work afterwards.
    await expect(q.push(async () => "ok")).resolves.toBe("ok");
  });

  test("repeated synchronous throws do not deadlock the queue", async () => {
    const q = new Queue(2);

    for (let i = 0; i < 5; i++) {
      await expect(
        q.push(() => {
          throw new Error(`boom-${i}`);
        }),
      ).rejects.toThrow(`boom-${i}`);
    }

    expect(q.running).toBe(0);
    await expect(q.push(async () => "still alive")).resolves.toBe(
      "still alive",
    );
  });

  test("a task still starts in the tick it is dequeued", () => {
    const q = new Queue(1);
    const started = vi.fn();
    q.push(async () => {
      started();
    });
    // Synchronous start is part of the contract — deferring it to a microtask
    // would change ordering for every caller.
    expect(started).toHaveBeenCalledTimes(1);
    expect(q.running).toBe(1);
  });

  test("clear() rejects queued tasks and leaves running ones alone", async () => {
    const q = new Queue(1);
    let release!: () => void;
    const running = q.push(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const queued1 = q.push(async () => "a");
    const queued2 = q.push(async () => "b");

    expect(q.running).toBe(1);
    expect(q.pending).toBe(2);

    const dropped = q.clear(new Error("closed"));
    expect(dropped).toBe(2);
    await expect(queued1).rejects.toThrow("closed");
    await expect(queued2).rejects.toThrow("closed");

    // The in-flight task owns its slot and finishes normally.
    release();
    await expect(running).resolves.toBeUndefined();
    expect(q.running).toBe(0);
  });
});
