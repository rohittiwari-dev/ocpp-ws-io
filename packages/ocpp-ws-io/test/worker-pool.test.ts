import { fileURLToPath } from "node:url";
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
});
