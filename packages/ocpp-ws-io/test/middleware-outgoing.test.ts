import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OCPPClient } from "../src/client.js";
import { schemaVersioningPlugin } from "../src/plugins/schema-versioning.js";
import { OCPPServer } from "../src/server.js";
import type {
  MessageEventContext,
  MessageEventPayload,
  OCPPPlugin,
} from "../src/types.js";

/**
 * `MiddlewareContext` declares six context types. Four of them ran through the
 * chain and two — `outgoing_result` and `outgoing_error` — did not, so a plugin
 * branching on either could never fire. `schemaVersioningPlugin` was written
 * against `outgoing_result`, which meant it transformed requests but silently
 * never transformed the responses going back.
 *
 * `onBeforeSend` sees those messages too, but a CALLRESULT on the wire is
 * `[3, messageId, payload]` and a CALLERROR is `[4, id, code, description,
 * details]` — neither carries the action name, so a plugin there cannot make a
 * decision that depends on which request is being answered. Carrying `method`
 * is why these context types exist.
 */

const getPort = (s: Server) => {
  const a = s.address();
  return a && typeof a !== "string" ? a.port : 0;
};

describe("middleware on the outgoing response path", () => {
  let server: OCPPServer | undefined;
  let client: OCPPClient | undefined;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close().catch(() => {});
    server = undefined;
    client = undefined;
  });

  /** A server that answers Heartbeat, with the given plugins installed. */
  async function connect(plugins: OCPPPlugin[], respond?: () => unknown) {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    for (const p of plugins) server.plugin(p);
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    server.on("client", (c) =>
      c.handle(
        "ocpp1.6",
        "Heartbeat",
        (respond ?? (() => ({ currentTime: "2026-01-01T00:00:00Z" }))) as never,
      ),
    );
    const http = await server.listen(0);

    client = new OCPPClient({
      identity: "CP-MW",
      endpoint: `ws://127.0.0.1:${getPort(http)}`,
      protocols: ["ocpp1.6"],
    });
    await client.connect();
    return client;
  }

  it("lets schemaVersioningPlugin transform a response, which it never could", async () => {
    const plugin = schemaVersioningPlugin({
      sourceVersion: "1.6",
      targetVersion: "1.5",
      rules: [
        {
          method: "Heartbeat",
          transform: (payload, direction) =>
            direction === "down"
              ? { ...payload, adaptedFor: "1.5" }
              : payload,
        },
      ],
    });

    const c = await connect([plugin]);
    const res = (await c.call("ocpp1.6", "Heartbeat", {})) as Record<
      string,
      unknown
    >;

    // The charge point receives the transformed response.
    expect(res.adaptedFor).toBe("1.5");
    expect(res.currentTime).toBe("2026-01-01T00:00:00Z");
  }, 20000);

  it("gives the transform the action name the wire message lacks", async () => {
    const seen: string[] = [];
    const plugin: OCPPPlugin = {
      name: "method-spy",
      onConnection(conn) {
        conn.use(async (ctx, next) => {
          if (ctx.type === "outgoing_result") seen.push(ctx.method);
          return next();
        });
      },
    };

    const c = await connect([plugin]);
    await c.call("ocpp1.6", "Heartbeat", {});

    // A CALLRESULT is [3, id, payload] — this is only knowable from the context.
    expect(seen).toEqual(["Heartbeat"]);
  }, 20000);

  it("reports the transformed payload on the message event, not the handler's", async () => {
    const observed: MessageEventPayload[] = [];
    const plugin: OCPPPlugin = {
      name: "transformer",
      onConnection(conn) {
        conn.on("message", (p) => observed.push(p as MessageEventPayload));
        conn.use(async (ctx, next) => {
          if (ctx.type === "outgoing_result") {
            ctx.payload = { ...(ctx.payload as object), stamped: true };
          }
          return next();
        });
      },
    };

    const c = await connect([plugin]);
    await c.call("ocpp1.6", "Heartbeat", {});

    const sent = observed.find(
      (p) => p.direction === "OUT" && Array.isArray(p.message) && p.message[0] === 3,
    );
    // An observer must see what left, or it is reporting fiction.
    expect((sent?.message as unknown[])?.[2]).toMatchObject({ stamped: true });
  }, 20000);

  it("still answers the charge point when a middleware throws", async () => {
    const plugin: OCPPPlugin = {
      name: "exploding",
      onConnection(conn) {
        conn.use(async (ctx, next) => {
          if (ctx.type === "outgoing_result") throw new Error("middleware boom");
          return next();
        });
      },
    };

    const c = await connect([plugin]);
    // Fails open with what the handler produced — a broken middleware must not
    // leave a charger waiting for a CALLRESULT that never arrives.
    const res = (await c.call("ocpp1.6", "Heartbeat", {})) as Record<
      string,
      unknown
    >;
    expect(res.currentTime).toBe("2026-01-01T00:00:00Z");
  }, 20000);

  it("runs for outgoing_error and can rewrite the code", async () => {
    const seen: string[] = [];
    const plugin: OCPPPlugin = {
      name: "error-mapper",
      onConnection(conn) {
        conn.use(async (ctx, next) => {
          if (ctx.type === "outgoing_error") {
            seen.push(ctx.method);
            ctx.errorDescription = "rewritten by middleware";
          }
          return next();
        });
      },
    };

    const c = await connect([plugin], () => {
      throw new Error("handler failed");
    });

    await expect(c.call("ocpp1.6", "Heartbeat", {})).rejects.toThrow(
      /rewritten by middleware/,
    );
    // A CALLERROR carries no action name either.
    expect(seen).toEqual(["Heartbeat"]);
  }, 20000);

  it("reports the rewritten code on the message event, not the thrown one", async () => {
    const observed: MessageEventPayload[] = [];
    const plugin: OCPPPlugin = {
      name: "error-rewriter",
      onConnection(conn) {
        conn.on("message", (p) => observed.push(p as MessageEventPayload));
        conn.use(async (ctx, next) => {
          if (ctx.type === "outgoing_error") {
            ctx.errorCode = "SecurityError";
            ctx.errorDescription = "masked";
          }
          return next();
        });
      },
    };

    const c = await connect([plugin], () => {
      throw new Error("internal detail that must not leak");
    });
    await expect(c.call("ocpp1.6", "Heartbeat", {})).rejects.toThrow();

    const sent = observed.find(
      (p) =>
        p.direction === "OUT" && Array.isArray(p.message) && p.message[0] === 4,
    );
    // The wire carries the rewrite; the context an observer reads must agree
    // with it, or the audit log contradicts the message it describes.
    expect((sent?.message as unknown[])?.[2]).toBe("SecurityError");
    const ctx = sent?.ctx as Extract<
      MessageEventContext,
      { type: "outgoing_error" }
    >;
    expect(ctx.errorCode).toBe("SecurityError");
    expect(ctx.errorDescription).toBe("masked");
  }, 20000);

  it("still reports the error when a middleware throws on the error path", async () => {
    const plugin: OCPPPlugin = {
      name: "exploding-on-error",
      onConnection(conn) {
        conn.use(async (ctx, next) => {
          if (ctx.type === "outgoing_error") throw new Error("boom");
          return next();
        });
      },
    };

    const c = await connect([plugin], () => {
      throw new Error("handler failed");
    });

    // The original failure still reaches the caller.
    await expect(c.call("ocpp1.6", "Heartbeat", {})).rejects.toThrow();
  }, 20000);

  it("leaves the response untouched when no middleware acts on it", async () => {
    const plugin: OCPPPlugin = {
      name: "passive",
      onConnection(conn) {
        conn.use(async (_ctx, next) => next());
      },
    };

    const c = await connect([plugin]);
    const res = (await c.call("ocpp1.6", "Heartbeat", {})) as Record<
      string,
      unknown
    >;
    expect(res).toEqual({ currentTime: "2026-01-01T00:00:00Z" });
  }, 20000);

  it("sees the inbound request and its own response within one exchange", async () => {
    const order: string[] = [];
    const plugin: OCPPPlugin = {
      name: "order-spy",
      onConnection(conn) {
        conn.use(async (ctx, next) => {
          order.push(`in:${ctx.type}`);
          const r = await next();
          order.push(`out:${ctx.type}`);
          return r;
        });
      },
    };

    const c = await connect([plugin]);
    await c.call("ocpp1.6", "Heartbeat", {});

    // The response chain runs inside the request's, so a middleware written in
    // the wrapping style still sees its own exchange close last.
    expect(order).toEqual([
      "in:incoming_call",
      "in:outgoing_result",
      "out:outgoing_result",
      "out:incoming_call",
    ]);
  }, 20000);

  it("does not run the chain twice for one response", async () => {
    const hits = vi.fn();
    const plugin: OCPPPlugin = {
      name: "counter",
      onConnection(conn) {
        conn.use(async (ctx, next) => {
          if (ctx.type === "outgoing_result") hits();
          return next();
        });
      },
    };

    const c = await connect([plugin]);
    await c.call("ocpp1.6", "Heartbeat", {});
    await c.call("ocpp1.6", "Heartbeat", {});

    expect(hits).toHaveBeenCalledTimes(2);
  }, 20000);
});
