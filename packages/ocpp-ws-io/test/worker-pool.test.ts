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

  test("worker validates CALL payloads via schemaInfo (C2 worker path)", async () => {
    const worker = new Worker(workerPath);
    try {
      const result = await new Promise<any>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.postMessage({
          id: 1,
          buffer: '[2,"id9","Heartbeat",{"bogus":true}]',
          schemaInfo: {
            schemas: {
              "urn:Heartbeat.req": {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          },
        });
      });
      expect(result.validationError).toBeDefined();
      expect(result.validationError.schemaId).toBe("urn:Heartbeat.req");
    } finally {
      await worker.terminate();
    }
  });
});
