import { afterEach, describe, expect, it } from "vitest";
import { OCPPServer } from "../src/server.js";
import type { OCPPPlugin } from "../src/types.js";

/**
 * close() awaits every plugin's onClosing and then every onClose. Unbounded, a
 * plugin whose promise never settles hangs the shutdown indefinitely — not a
 * graceful shutdown that takes a while, one that never ends — and a supervisor
 * eventually sends SIGKILL, which is a worse ending than the one the plugin
 * was delaying.
 */

describe("a plugin that hangs during shutdown", () => {
  let server: OCPPServer | undefined;

  afterEach(async () => {
    await server?.close().catch(() => {});
    server = undefined;
  });

  it("does not block close() forever", async () => {
    const hanging: OCPPPlugin = {
      name: "hanging",
      // Never settles — a broker call with no timeout of its own.
      onClosing: () => new Promise<void>(() => {}),
      onClose: () => new Promise<void>(() => {}),
    };

    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      pluginShutdownTimeoutMs: 120,
    } as never);
    server.plugin(hanging);
    await server.listen(0);

    const started = Date.now();
    await server.close();
    const elapsed = Date.now() - started;

    // Two hooks, each bounded — not the unbounded wait it used to be.
    expect(elapsed).toBeLessThan(3000);
    server = undefined;
  }, 20000);

  it("still waits for a plugin that finishes in time", async () => {
    const order: string[] = [];
    const slow: OCPPPlugin = {
      name: "slow-but-finite",
      onClosing: async () => {
        await new Promise((r) => setTimeout(r, 40));
        order.push("onClosing done");
      },
      onClose: async () => {
        await new Promise((r) => setTimeout(r, 40));
        order.push("onClose done");
      },
    };

    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      pluginShutdownTimeoutMs: 2000,
    } as never);
    server.plugin(slow);
    await server.listen(0);
    await server.close();
    server = undefined;

    // Bounding must not mean abandoning work that was going to complete.
    expect(order).toEqual(["onClosing done", "onClose done"]);
  }, 20000);

  it("reports the plugin that overran", async () => {
    const warnings: string[] = [];
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      pluginShutdownTimeoutMs: 60,
      logging: {
        logger: {
          warn: (msg: string, meta?: Record<string, unknown>) =>
            warnings.push(`${msg}|${meta?.name}`),
          error: () => {},
          info: () => {},
          debug: () => {},
        },
      },
    } as never);
    server.plugin({
      name: "overrunner",
      onClosing: () => new Promise<void>(() => {}),
    });
    await server.listen(0);
    await server.close();
    server = undefined;

    expect(warnings.some((w) => w.includes("overrunner"))).toBe(true);
    expect(warnings.some((w) => w.includes("onClosing"))).toBe(true);
  }, 20000);

  it("does not turn an abandoned hook into an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);

    try {
      server = new OCPPServer({
        protocols: ["ocpp1.6"],
        pluginShutdownTimeoutMs: 50,
      } as never);
      server.plugin({
        name: "late-rejector",
        // Overruns the budget, then rejects after being abandoned.
        onClosing: () =>
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("too late")), 150),
          ),
      });
      await server.listen(0);
      await server.close();
      server = undefined;

      await new Promise((r) => setTimeout(r, 250));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  }, 20000);
});
