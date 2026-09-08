import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";
import type { OCPPPlugin } from "../src/types.js";

/**
 * Most plugin hooks are declared `void | Promise<void>`, so a plugin may
 * legitimately be async — but the dispatch sites wrapped the call in a bare
 * try/catch, which only ever sees a synchronous throw. An async hook that
 * rejected escaped it and became an unhandled rejection, and Node terminates
 * the process on those by default: one plugin whose backend blipped took down
 * the CSMS.
 */

const getPort = (s: Server) => {
  const a = s.address();
  return a && typeof a !== "string" ? a.port : 0;
};

/** Capture unhandled rejections for the duration of one test. */
function watchUnhandled() {
  const seen: unknown[] = [];
  const onUnhandled = (err: unknown) => seen.push(err);
  process.on("unhandledRejection", onUnhandled);
  return {
    seen,
    stop: () => process.off("unhandledRejection", onUnhandled),
  };
}

describe("an async plugin hook that rejects", () => {
  let server: OCPPServer | undefined;
  let client: OCPPClient | undefined;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close().catch(() => {});
    vi.restoreAllMocks();
    client = undefined;
    server = undefined;
  });

  it("is reported rather than crashing the process", async () => {
    const watcher = watchUnhandled();
    const errors: string[] = [];

    const exploding: OCPPPlugin = {
      name: "exploding",
      async onMessage() {
        throw new Error("plugin backend unreachable");
      },
    };

    try {
      server = new OCPPServer({
        protocols: ["ocpp1.6"],
        logging: {
          logger: {
            error: (msg: string, meta?: Record<string, unknown>) => {
              errors.push(`${msg}:${meta?.name}`);
            },
          },
        },
      } as never);
      server.plugin(exploding);
      server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
      server.on("client", (c) =>
        c.handle("ocpp1.6", "Heartbeat", () => ({
          currentTime: new Date().toISOString(),
        })),
      );
      const http = await server.listen(0);

      client = new OCPPClient({
        identity: "CP-BOOM",
        endpoint: `ws://127.0.0.1:${getPort(http)}`,
        protocols: ["ocpp1.6"],
      });
      await client.connect();

      // The exchange still completes — a broken plugin must not break OCPP.
      const res = await client.call("ocpp1.6", "Heartbeat", {});
      expect(res).toHaveProperty("currentTime");

      // Give the rejection a turn to surface if it is going to.
      await new Promise((r) => setTimeout(r, 50));

      expect(watcher.seen).toHaveLength(0);
      expect(errors.some((e) => e.includes("onMessage"))).toBe(true);
    } finally {
      watcher.stop();
    }
  }, 20000);

  it("still reports a synchronous throw from the same hook", async () => {
    const watcher = watchUnhandled();
    const errors: string[] = [];

    const exploding: OCPPPlugin = {
      name: "exploding-sync",
      onMessage() {
        throw new Error("boom");
      },
    };

    try {
      server = new OCPPServer({
        protocols: ["ocpp1.6"],
        logging: {
          logger: {
            error: (msg: string, meta?: Record<string, unknown>) => {
              errors.push(`${msg}:${meta?.name}`);
            },
          },
        },
      } as never);
      server.plugin(exploding);
      server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
      server.on("client", (c) =>
        c.handle("ocpp1.6", "Heartbeat", () => ({
          currentTime: new Date().toISOString(),
        })),
      );
      const http = await server.listen(0);

      client = new OCPPClient({
        identity: "CP-BOOM-SYNC",
        endpoint: `ws://127.0.0.1:${getPort(http)}`,
        protocols: ["ocpp1.6"],
      });
      await client.connect();
      await client.call("ocpp1.6", "Heartbeat", {});
      await new Promise((r) => setTimeout(r, 50));

      expect(watcher.seen).toHaveLength(0);
      expect(errors.some((e) => e.includes("onMessage"))).toBe(true);
    } finally {
      watcher.stop();
    }
  }, 20000);
});
