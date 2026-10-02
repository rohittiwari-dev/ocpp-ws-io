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
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client.js";
import { RPCInternalError, RPCSecurityError } from "../src/errors.js";
import { OCPPServer } from "../src/server.js";
import type { OCPPServerClient } from "../src/server-client.js";
import { createRPCError } from "../src/util.js";

/**
 * A middleware that throws before calling next(). On a received CALL the peer
 * is answered with a CALLERROR (OCPP-J: every CALL gets a CALLRESULT or a
 * CALLERROR); on a received CALLRESULT or CALLERROR the waiting call is
 * rejected with the error. Before, all three were dropped and the caller only
 * saw its timeout; in the browser client the error also escaped as an
 * unhandled rejection.
 */
describe("a middleware that throws before next()", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  async function start(reject?: Error) {
    const server = new OCPPServer({ protocols: ["ocpp2.0.1"], logging: false });
    servers.push(server);
    let handled = 0;
    server.on("client", (c) => {
      if (reject) {
        c.use(async (ctx, next) => {
          if (ctx.type === "incoming_call") throw reject;
          return next();
        });
      }
      c.handle("Heartbeat", () => {
        handled++;
        return { currentTime: new Date().toISOString() };
      });
    });
    const http = await server.listen(0);
    const { port } = http.address() as AddressInfo;
    return { port, handled: () => handled };
  }

  async function connect(port: number) {
    const client = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp2.0.1"],
      reconnect: false,
      logging: false,
      // Long enough that a timeout cannot pass for the answer.
      callTimeoutMs: 20_000,
    });
    clients.push(client);
    await client.connect();
    return client;
  }

  it("on a received CALL, answers with the error's RPC code", async () => {
    const { port, handled } = await start(
      createRPCError("SecurityError", "Signature does not verify"),
    );
    const client = await connect(port);

    const error = await client.call("Heartbeat", {}).catch((e: Error) => e);

    // Described with the code's standard text, as a handler's error is.
    expect(error).toBeInstanceOf(RPCSecurityError);
    expect(handled()).toBe(0);
  });

  it("on a received CALL, answers InternalError for an error without an RPC code", async () => {
    const { port } = await start(new Error("middleware broke"));
    const client = await connect(port);

    const error = await client.call("Heartbeat", {}).catch((e: Error) => e);

    expect(error).toBeInstanceOf(RPCInternalError);
  });

  it("on a received CALLRESULT, rejects the call with the error", async () => {
    const { port } = await start();
    const client = await connect(port);
    const rejected = new Error("reply rejected");
    client.use(async (ctx, next) => {
      if (ctx.type === "incoming_result") throw rejected;
      return next();
    });

    const error = await client.call("Heartbeat", {}).catch((e: Error) => e);

    expect(error).toBe(rejected);
  });

  it("on a received CALLERROR, rejects the call with the error", async () => {
    const { port } = await start();
    const client = await connect(port);
    const rejected = new Error("error rejected");
    client.use(async (ctx, next) => {
      if (ctx.type === "incoming_error") throw rejected;
      return next();
    });

    // No handler for it on the CSMS: answered with NotImplemented.
    const error = await client.call("DataTransfer", { vendorId: "V" }).catch(
      (e: Error) => e,
    );

    expect(error).toBe(rejected);
  });

  describe("browser client", () => {
    // The browser client uses the global WebSocket; `ws` stands in for it.
    const original = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
    const browsers: BrowserOCPPClient[] = [];
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
    afterEach(async () => {
      for (const b of browsers.splice(0)) await b.close({ force: true });
    });

    /** A browser charger, and the CSMS's connection to it. */
    async function connectBrowser(port: number) {
      const charger = new Promise<OCPPServerClient>((resolve) => {
        servers[servers.length - 1].once("client", resolve);
      });
      const client = new BrowserOCPPClient({
        identity: "CP-B",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp2.0.1"],
        reconnect: false,
        logging: false,
        callTimeoutMs: 20_000,
      });
      browsers.push(client);
      await client.connect();
      return { client, charger: await charger };
    }

    it("on a received CALL, answers with the error's RPC code", async () => {
      const { port } = await start();
      const { client, charger } = await connectBrowser(port);
      let handled = 0;
      client.handle("Reset", () => {
        handled++;
        return { status: "Accepted" };
      });
      client.use(async (ctx, next) => {
        if (ctx.type === "incoming_call") {
          throw createRPCError("SecurityError", "Signature does not verify");
        }
        return next();
      });

      const error = await charger
        .call("Reset", { type: "Immediate" })
        .catch((e: Error) => e);

      expect(error).toBeInstanceOf(RPCSecurityError);
      expect(handled).toBe(0);
    });

    it("on a received CALLRESULT, rejects the call with the error", async () => {
      const { port } = await start();
      const { client } = await connectBrowser(port);
      const rejected = new Error("reply rejected");
      client.use(async (ctx, next) => {
        if (ctx.type === "incoming_result") throw rejected;
        return next();
      });

      const error = await client.call("Heartbeat", {}).catch((e: Error) => e);

      expect(error).toBe(rejected);
    });

    it("on a received CALLERROR, rejects the call with the error", async () => {
      const { port } = await start();
      const { client } = await connectBrowser(port);
      const rejected = new Error("error rejected");
      client.use(async (ctx, next) => {
        if (ctx.type === "incoming_error") throw rejected;
        return next();
      });

      const error = await client
        .call("DataTransfer", { vendorId: "V" })
        .catch((e: Error) => e);

      expect(error).toBe(rejected);
    });

    it("after the answer was sent, logs the error instead of leaving it unhandled", async () => {
      const { port } = await start();
      const { client, charger } = await connectBrowser(port);
      client.handle("Reset", () => ({ status: "Accepted" }));
      client.use(async (ctx, next) => {
        await next();
        if (ctx.type === "incoming_call") throw new Error("after the answer");
      });

      // An unhandled rejection fails the test run.
      await expect(charger.call("Reset", { type: "Immediate" })).resolves.toEqual(
        { status: "Accepted" },
      );
    });
  });
});
