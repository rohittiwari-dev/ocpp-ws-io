import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

/**
 * A middleware that calls next() without awaiting or returning it used to
 * leave the rest of the chain running on a promise nobody held: a rejection
 * further down (an auth reject, a failed call) became an unhandled rejection
 * and ended the process, and a call resolved before its answer arrived. The
 * chain now awaits that promise itself, so forgetting `await` is harmless.
 */
describe("next() called without await", () => {
  const httpServers: Server[] = [];
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];
  const unhandled: string[] = [];
  const onUnhandled = (reason: Error | string) => {
    unhandled.push(reason instanceof Error ? reason.message : String(reason));
  };
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
  });

  afterEach(async () => {
    process.off("unhandledRejection", onUnhandled);
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
    for (const h of httpServers.splice(0)) {
      await new Promise<void>((r) => h.close(() => r()));
    }
  });

  describe("connection middleware (handshake)", () => {
    async function start(setup: (server: OCPPServer) => void) {
      const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
      servers.push(server);
      setup(server);
      const http = createServer();
      httpServers.push(http);
      http.on("upgrade", server.handleUpgrade);
      await new Promise<void>((r) => http.listen(0, () => r()));
      return (http.address() as AddressInfo).port;
    }

    /** Status of a raw upgrade: 101 when the connection opened. */
    function upgrade(port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        const req = request({
          port,
          path: "/CP-1",
          headers: {
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": "MDEyMzQ1Njc4OWFiY2RlZg==",
            "Sec-WebSocket-Protocol": "ocpp1.6",
          },
        });
        req.on("upgrade", (res, socket) => {
          socket.destroy();
          resolve(res.statusCode ?? 0);
        });
        req.on("response", (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
    }

    it("an auth rejection still answers its status, without crashing", async () => {
      const port = await start((s) => {
        s.use(({ next }) => {
          next();
        });
        s.auth((ctx) => ctx.reject(403, "Forbidden"));
      });
      expect(await upgrade(port)).toBe(403);
      await sleep(20);
      expect(unhandled).toEqual([]);
    });

    it("an auth error still answers 500, without crashing", async () => {
      const port = await start((s) => {
        s.use(({ next }) => {
          next();
        });
        s.auth(() => {
          throw new Error("database down");
        });
      });
      expect(await upgrade(port)).toBe(500);
      await sleep(20);
      expect(unhandled).toEqual([]);
    });

    it("a rejection while the middleware is still busy is handled too", async () => {
      const port = await start((s) => {
        s.use(async ({ next }) => {
          next();
          await sleep(50); // the auth below rejects before this returns
        });
        s.auth((ctx) => ctx.reject(403, "Forbidden"));
      });
      expect(await upgrade(port)).toBe(403);
      await sleep(80);
      expect(unhandled).toEqual([]);
    });

    it("an accepted charger still connects", async () => {
      const port = await start((s) => {
        s.use(({ next }) => {
          next();
        });
        s.auth((ctx) => ctx.accept());
      });
      expect(await upgrade(port)).toBe(101);
    });

    it("an awaited next() keeps its order: before, auth, after", async () => {
      const order: string[] = [];
      const port = await start((s) => {
        s.use(async ({ next }) => {
          order.push("before");
          await next();
          order.push("after");
        });
        s.auth(async (ctx) => {
          await sleep(10);
          order.push("auth");
          ctx.accept();
        });
      });
      expect(await upgrade(port)).toBe(101);
      expect(order).toEqual(["before", "auth", "after"]);
    });
  });

  describe("message middleware (calls)", () => {
    async function connect(
      middleware: Parameters<OCPPClient["use"]>[0],
    ): Promise<OCPPClient> {
      const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
      servers.push(server);
      server.on("client", (c) => c.handle("Ping", () => ({ pong: true })));
      const http = await server.listen(0);
      const client = new OCPPClient({
        identity: "CP-1",
        endpoint: `ws://localhost:${(http.address() as AddressInfo).port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
        logging: false,
      });
      clients.push(client);
      client.use(middleware);
      await client.connect();
      return client;
    }

    it("a call resolves with its real answer", async () => {
      const client = await connect(async (_ctx, next) => {
        next();
      });
      expect(await client.call("Ping", {})).toEqual({ pong: true });
    });

    it("a failing call rejects, without crashing", async () => {
      const client = await connect(async (_ctx, next) => {
        next();
      });
      await expect(client.call("NoSuchAction", {})).rejects.toThrow(
        "Requested method is not known",
      );
      await sleep(20);
      expect(unhandled).toEqual([]);
    });

    it("a failure while the middleware is still busy is handled too", async () => {
      const client = await connect(async (_ctx, next) => {
        next();
        await sleep(100); // the CALLERROR arrives before this returns
      });
      await expect(client.call("NoSuchAction", {})).rejects.toThrow(
        "Requested method is not known",
      );
      await sleep(20);
      expect(unhandled).toEqual([]);
    });
  });
});
