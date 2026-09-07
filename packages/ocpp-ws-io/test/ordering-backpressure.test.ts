import { afterEach, describe, expect, test, vi } from "vitest";
import { resolve } from "node:path";
import { WorkerPool } from "../src/worker-pool.js";
import { cpuLimit, memoryUsage } from "../src/adaptive-limiter.js";

const WORKER_PATH = resolve(__dirname, "../src/parse-worker.cjs");

describe("worker pool robustness", () => {
  const pools: WorkerPool[] = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((p) => p.shutdown().catch(() => {})));
  });

  // A task that never settles is not just a lost message: the caller awaits it
  // inside the per-connection inbound chain, so that connection stops
  // processing anything at all, permanently and silently.
  test("a parse that never comes back is rejected rather than hanging", async () => {
    const pool = new WorkerPool({
      poolSize: 1,
      workerPath: WORKER_PATH,
      taskTimeoutMs: 150,
    });
    pools.push(pool);

    // Silence the worker so the reply never arrives.
    const worker = (pool as unknown as { _workers: { postMessage(): void }[] })
      ._workers[0];
    const noop = vi.fn();
    worker.postMessage = noop;

    const started = Date.now();
    await expect(pool.parse('[2,"1","Heartbeat",{}]')).rejects.toThrow(
      /timed out/i,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(pool.pendingTasks).toBe(0);
  }, 20000);

  test("a normal parse is unaffected by the timeout", async () => {
    const pool = new WorkerPool({
      poolSize: 1,
      workerPath: WORKER_PATH,
      taskTimeoutMs: 5000,
    });
    pools.push(pool);

    const result = await pool.parse('[2,"abc","Heartbeat",{}]');
    expect(Array.isArray(result.message)).toBe(true);
    expect(pool.pendingTasks).toBe(0);
  }, 20000);

  // postMessage() to a terminated worker is a silent no-op rather than a throw,
  // so the previous try/catch never fired and the task simply hung.
  test("a pool whose workers have all exited rejects instead of hanging", async () => {
    const pool = new WorkerPool({
      poolSize: 1,
      workerPath: WORKER_PATH,
      taskTimeoutMs: 5000,
    });
    pools.push(pool);

    // Mark the slot dead the way an 'exit' event would.
    (pool as unknown as { _workerAlive: boolean[] })._workerAlive[0] = false;

    await expect(pool.parse('[2,"1","Heartbeat",{}]')).rejects.toThrow(
      /no live workers/i,
    );
  }, 20000);
});

describe("adaptive limiter resource limits", () => {
  // os.cpus() and totalmem() describe the host. In a container with a quota
  // they are the wrong denominator: a small container on a big host never looks
  // busy, so the limiter never engages.
  test("cpuLimit returns a usable positive core count", () => {
    const n = cpuLimit();
    expect(n).toBeGreaterThan(0);
    expect(Number.isFinite(n)).toBe(true);
  });

  test("memoryUsage reports used within total", () => {
    const { used, total } = memoryUsage();
    expect(total).toBeGreaterThan(0);
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(total);
  });

  test("the derived percentage is in range", () => {
    const { used, total } = memoryUsage();
    const pct = (used / total) * 100;
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});
