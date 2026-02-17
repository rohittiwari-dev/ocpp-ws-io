import { describe, it, expect, vi } from "vitest";
import { Queue } from "../src/queue.js";

describe("Queue", () => {
  it("should initialize with concurrency of 1", () => {
    const q = new Queue();
    expect(q.concurrency).toBe(1);
    expect(q.pending).toBe(0);
    expect(q.running).toBe(0);
    expect(q.size).toBe(0);
  });

  it("should accept a custom concurrency", () => {
    const q = new Queue(5);
    expect(q.concurrency).toBe(5);
  });

  it("should enforce minimum concurrency of 1", () => {
    const q = new Queue(0);
    expect(q.concurrency).toBe(1);
    const q2 = new Queue(-5);
    expect(q2.concurrency).toBe(1);
  });

  it("should execute a single task", async () => {
    const q = new Queue();
    const result = await q.push(async () => 42);
    expect(result).toBe(42);
  });

  it("should execute tasks in order with concurrency 1", async () => {
    const q = new Queue(1);
    const order: number[] = [];

    const results = await Promise.all([
      q.push(async () => {
        order.push(1);
        return "a";
      }),
      q.push(async () => {
        order.push(2);
        return "b";
      }),
      q.push(async () => {
        order.push(3);
        return "c";
      }),
    ]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("should limit concurrent execution", async () => {
    const q = new Queue(2);
    let maxConcurrent = 0;
    let current = 0;

    const makeTask = () => async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 10));
      current--;
      return true;
    };

    await Promise.all([
      q.push(makeTask()),
      q.push(makeTask()),
      q.push(makeTask()),
      q.push(makeTask()),
    ]);

    expect(maxConcurrent).toBe(2);
  });

  it("should reject with task errors", async () => {
    const q = new Queue();
    await expect(
      q.push(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
  });

  it("should continue after task rejections", async () => {
    const q = new Queue(1);

    const p1 = q
      .push(async () => {
        throw new Error("first fails");
      })
      .catch(() => "caught");

    const p2 = q.push(async () => "second ok");

    const results = await Promise.all([p1, p2]);
    expect(results).toEqual(["caught", "second ok"]);
  });

  it("should update concurrency dynamically", async () => {
    const q = new Queue(1);
    expect(q.concurrency).toBe(1);

    q.setConcurrency(5);
    expect(q.concurrency).toBe(5);
  });

  it("should track size correctly", async () => {
    const q = new Queue(1);
    let resolveFirst!: () => void;

    const p1 = q.push(
      () =>
        new Promise<void>((r) => {
          resolveFirst = r;
        }),
    );
    const p2 = q.push(async () => "b");

    // p1 is running, p2 is pending
    expect(q.running).toBe(1);
    expect(q.pending).toBe(1);
    expect(q.size).toBe(2);

    resolveFirst();
    await Promise.all([p1, p2]);

    // After resolution, allow microtask queue to drain
    await new Promise((r) => setTimeout(r, 0));
    expect(q.size).toBe(0);
  });
});
