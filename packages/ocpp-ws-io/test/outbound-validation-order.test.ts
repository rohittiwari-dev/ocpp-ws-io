import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import WebSocketModule from "ws";
import {
  type AnyBrowserOCPPClient,
  BrowserOCPPClient,
} from "../src/browser/client.js";
import { type AnyOCPPClient, OCPPClient } from "../src/client/client.js";
import {
  piiRedactorPlugin,
  schemaVersioningPlugin,
} from "../src/plugins/index.js";
import { OCPPServer } from "../src/server/server.js";
import type { OCPPServerClient } from "../src/server/server-client.js";
import type { JsonValue, LoggerLike, OCPPPlugin } from "../src/types.js";
import { unchecked } from "../src/core/unchecked.js";

/**
 * Strict mode checks an outgoing call after the middleware, as it goes on the
 * wire: a call a middleware converted (schemaVersioningPlugin) is checked as
 * converted, and one a middleware made invalid is not sent. An envelope such
 * as a signature is not part of that: a middleware sets `wrap`, which runs
 * after the check, and the reply is checked against the plain action. Outgoing
 * results take a `wrap` too, applied after every middleware.
 */
describe("strict mode, middleware and wrap on outgoing messages", () => {
  const servers: OCPPServer[] = [];
  const clients: Array<AnyOCPPClient | AnyBrowserOCPPClient> = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  /**
   * A CSMS recording the frames it receives; its handlers answer `answer`
   * (an invalid HeartbeatResponse unless given).
   */
  async function start(
    protocol: "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1",
    options: { strictMode?: boolean; plugins?: OCPPPlugin[] } = {},
  ) {
    const errors: string[] = [];
    const logger: LoggerLike = {
      debug() {},
      info() {},
      warn() {},
      error(message) {
        errors.push(message);
      },
    };
    const server = new OCPPServer({
      protocols: [protocol],
      strictMode: options.strictMode,
      logging: { logger },
    });
    servers.push(server);
    const received: JsonValue[] = [];
    server.plugin({
      name: "recorder",
      onBeforeReceive(_client, raw) {
        received.push(JSON.parse(String(raw)));
        return undefined;
      },
    });
    for (const plugin of options.plugins ?? []) server.plugin(plugin);
    const connected = new Promise<OCPPServerClient>((resolve) => {
      server.on("client", (c) => {
        c.handle(() => ({}));
        resolve(c);
      });
    });
    const http = await server.listen(0);
    const { port } = http.address() as AddressInfo;
    return { port, received, connected, errors };
  }

  async function connect(
    port: number,
    protocol: "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1",
  ) {
    const client = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}`,
      protocols: [protocol],
      strictMode: true,
      reconnect: false,
      logging: false,
    });
    clients.push(client);
    const failures: string[] = [];
    client.on("strictValidationFailure", ({ error }) => {
      failures.push(error.message);
    });
    await client.connect();
    return { client, failures };
  }

  describe("strict mode checks the call as middleware left it", () => {
    it("sends a call schemaVersioningPlugin converted for the charger's version", async () => {
      const versioning = schemaVersioningPlugin({
        sourceVersion: "ocpp1.6",
        targetVersion: "ocpp2.0.1",
        rules: [
          {
            method: "ChangeAvailability",
            transform: (p, direction) =>
              direction === "down"
                ? {
                    connectorId: (p.evse as { id: number }).id,
                    type: p.operationalStatus,
                  }
                : p,
          },
        ],
      });
      const { port, connected } = await start("ocpp1.6", {
        strictMode: true,
        plugins: [versioning],
      });
      const { client } = await connect(port, "ocpp1.6");
      const received: object[] = [];
      client.handle("ChangeAvailability", ({ params }) => {
        received.push(params);
        return { status: "Accepted" };
      });

      // A 2.0.1-shaped command for a 1.6 charger.
      const csms = await connected;
      const answer = await csms.call("ChangeAvailability", {
        operationalStatus: "Operative",
        evse: { id: 1 },
      });

      expect(answer).toEqual({ status: "Accepted" });
      expect(received).toEqual([{ connectorId: 1, type: "Operative" }]);
    });

    it("does not send a call a middleware made invalid", async () => {
      const redactor = piiRedactorPlugin({
        sensitiveKeys: ["idTag"],
        replacement: "X".repeat(30),
        outgoing: true,
      });
      const { port, connected } = await start("ocpp1.6", {
        strictMode: true,
        plugins: [redactor],
      });
      const { client } = await connect(port, "ocpp1.6");
      const received: object[] = [];
      client.handle("RemoteStartTransaction", ({ params }) => {
        received.push(params);
        return { status: "Accepted" };
      });

      // idTag is at most 20 characters in 1.6.
      const csms = await connected;
      await expect(
        csms.call("RemoteStartTransaction", { idTag: "ABC" }),
      ).rejects.toThrow(/20 characters/);
      expect(received).toEqual([]);
    });
  });

  describe("wrap on an outgoing call", () => {
    /** Wraps every call as "<action>-Wrapped" with the params inside. */
    function wrapping(client: AnyOCPPClient | AnyBrowserOCPPClient) {
      const wrapped: string[] = [];
      const resultMethods: string[] = [];
      client.use(async (ctx, next) => {
        if (ctx.type === "outgoing_call") {
          ctx.wrap = (call) => {
            wrapped.push(call.method);
            return {
              method: `${call.method}-Wrapped`,
              params: { inner: call.params },
            };
          };
        }
        if (ctx.type === "incoming_result") resultMethods.push(ctx.method);
        return next();
      });
      return { wrapped, resultMethods };
    }

    it("runs after strict mode, and the reply is checked against the plain action", async () => {
      const { port, received } = await start("ocpp2.0.1");
      const { client, failures } = await connect(port, "ocpp2.0.1");
      const { wrapped, resultMethods } = wrapping(client);

      // The CSMS answers {}, an invalid HeartbeatResponse.
      await expect(client.call("Heartbeat", {})).rejects.toThrow(
        /currentTime/,
      );

      expect(wrapped).toEqual(["Heartbeat"]);
      expect(received).toEqual([
        [2, expect.any(String), "Heartbeat-Wrapped", { inner: {} }],
      ]);
      expect(resultMethods).toEqual(["Heartbeat"]);
      expect(failures).toHaveLength(1);
    });

    it("is not called for a call strict mode rejects", async () => {
      const { port, received } = await start("ocpp2.0.1");
      const { client, failures } = await connect(port, "ocpp2.0.1");
      const { wrapped } = wrapping(client);

      // BootNotification needs reason and chargingStation.
      await expect(client.call(unchecked("BootNotification"), {})).rejects.toThrow();

      expect(failures).toHaveLength(1);
      expect(wrapped).toEqual([]);
      expect(received).toEqual([]);
    });

    it("applies to a SEND the same way", async () => {
      const { port, received } = await start("ocpp2.1");
      const { client, failures } = await connect(port, "ocpp2.1");
      const { wrapped } = wrapping(client);
      const stream = {
        id: 1,
        pending: 0,
        basetime: new Date().toISOString(),
        data: [{ t: 0, v: "1" }],
      };

      await expect(
        client.send(unchecked("NotifyPeriodicEventStream"), {}),
      ).rejects.toThrow();
      await client.send("NotifyPeriodicEventStream", stream);
      await expect.poll(() => received.length).toBe(1);

      expect(failures).toHaveLength(1);
      expect(wrapped).toEqual(["NotifyPeriodicEventStream"]);
      expect(received[0]).toEqual([
        6,
        expect.any(String),
        "NotifyPeriodicEventStream-Wrapped",
        { inner: stream },
      ]);
    });

    it("composes: a wrap set later goes around the earlier one", async () => {
      const { port, received } = await start("ocpp2.0.1");
      const { client } = await connect(port, "ocpp2.0.1");
      wrapping(client);
      client.use(async (ctx, next) => {
        if (ctx.type === "outgoing_call") {
          const inner = ctx.wrap;
          ctx.wrap = async (call) => {
            const once = inner ? await inner(call) : call;
            return { method: `${once.method}-Outer`, params: once.params };
          };
        }
        return next();
      });

      await client.call("Heartbeat", {}).catch(() => {});

      expect(received[0]).toEqual([
        2,
        expect.any(String),
        "Heartbeat-Wrapped-Outer",
        { inner: {} },
      ]);
    });

    describe("browser client", () => {
      // The browser client uses the global WebSocket; `ws` stands in for it.
      const original = Object.getOwnPropertyDescriptor(
        globalThis,
        "WebSocket",
      );
      beforeAll(() => {
        Object.defineProperty(globalThis, "WebSocket", {
          value: WebSocketModule,
          configurable: true,
          writable: true,
        });
      });
      afterAll(() => {
        if (original) Object.defineProperty(globalThis, "WebSocket", original);
        else Reflect.deleteProperty(globalThis, "WebSocket");
      });

      it("sends what wrap returns", async () => {
        const { port, received } = await start("ocpp2.0.1");
        const client = new BrowserOCPPClient({
          identity: "CP-B",
          endpoint: `ws://localhost:${port}`,
          protocols: ["ocpp2.0.1"],
          reconnect: false,
          logging: false,
        });
        clients.push(client);
        await client.connect();
        const { resultMethods } = wrapping(client);

        await client.call("Heartbeat", {});

        expect(received[0]).toEqual([
          2,
          expect.any(String),
          "Heartbeat-Wrapped",
          { inner: {} },
        ]);
        expect(resultMethods).toEqual(["Heartbeat"]);
      });
    });
  });

  describe("wrap on an outgoing result", () => {
    it("goes around the reply every middleware has finished with", async () => {
      const { port, connected } = await start("ocpp2.0.1");
      const { client } = await connect(port, "ocpp2.0.1");
      client.handle("Reset", () => ({ status: "Accepted" }));
      client.use(async (ctx, next) => {
        if (ctx.type === "outgoing_result") {
          ctx.wrap = (payload) => ({ wrapped: payload });
        }
        return next();
      });
      // Registered after the wrap, and still inside it.
      client.use(async (ctx, next) => {
        if (ctx.type === "outgoing_result") {
          ctx.payload = { status: "Scheduled" };
        }
        return next();
      });

      const csms = await connected;
      const answer = await csms.call("Reset", { type: "Immediate" });

      expect(answer).toEqual({ wrapped: { status: "Scheduled" } });
    });

    it("if it fails, sends the reply without it and logs the failure", async () => {
      const { port, connected } = await start("ocpp2.0.1");
      const errors: string[] = [];
      const client = new OCPPClient({
        identity: "CP-1",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp2.0.1"],
        reconnect: false,
        logging: {
          logger: {
            debug() {},
            info() {},
            warn() {},
            error(message) {
              errors.push(message);
            },
          },
        },
      });
      clients.push(client);
      await client.connect();
      client.handle("Reset", () => ({ status: "Accepted" }));
      client.use(async (ctx, next) => {
        if (ctx.type === "outgoing_result") {
          ctx.wrap = () => {
            throw new Error("no key");
          };
        }
        return next();
      });

      const csms = await connected;
      const answer = await csms.call("Reset", { type: "Immediate" });

      expect(answer).toEqual({ status: "Accepted" });
      expect(errors).toContain("Middleware failed on outgoing result");
    });
  });
});
