import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { describe, expect, test } from "vitest";
import { WorkerPool } from "../src/worker-pool.js";

const workerPath = fileURLToPath(
  new URL("../src/parse-worker.cjs", import.meta.url),
);

describe("WorkerPool", () => {
  test("parses a Buffer OCPP frame off-thread", async () => {
    const pool = new WorkerPool({ poolSize: 1, workerPath });
    const result = await pool.parse(Buffer.from('[2,"id1","Heartbeat",{}]'));
    expect(result.message).toEqual([2, "id1", "Heartbeat", {}]);
    await pool.shutdown();
  });

  test("parses a string frame", async () => {
    const pool = new WorkerPool({ poolSize: 1, workerPath });
    const result = await pool.parse('[3,"id2",{"ok":true}]');
    expect(result.message).toEqual([3, "id2", { ok: true }]);
    await pool.shutdown();
  });

  test("rejects on invalid JSON", async () => {
    const pool = new WorkerPool({ poolSize: 1, workerPath });
    await expect(pool.parse(Buffer.from("not-json"))).rejects.toThrow();
    await pool.shutdown();
  });

  test("constructor throws when the worker file does not exist", () => {
    expect(
      () => new WorkerPool({ poolSize: 1, workerPath: "Z:/nope/missing.cjs" }),
    ).toThrow(/worker/i);
  });

  test("worker parses off-thread and returns the decoded message", async () => {
    const worker = new Worker(workerPath);
    try {
      const result = await new Promise<any>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.postMessage({ id: 1, buffer: '[2,"id9","Heartbeat",{}]' });
      });
      expect(result.id).toBe(1);
      expect(result.message).toEqual([2, "id9", "Heartbeat", {}]);
      expect(result.error).toBeUndefined();
    } finally {
      await worker.terminate();
    }
  });

  test("worker decodes a Buffer payload, not just a string", async () => {
    const worker = new Worker(workerPath);
    try {
      const result = await new Promise<any>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.postMessage({
          id: 2,
          buffer: Buffer.from('[2,"id10","BootNotification",{"a":"b"}]'),
        });
      });
      expect(result.message).toEqual([
        2,
        "id10",
        "BootNotification",
        { a: "b" },
      ]);
    } finally {
      await worker.terminate();
    }
  });
});
