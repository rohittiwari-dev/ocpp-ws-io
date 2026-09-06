import { afterEach, describe, expect, test } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";

// A global `server.use()` middleware must not make unmatched paths reachable.
//
// Global middleware routers always match but never mark a terminal route, so
// when the unknown-path 404 was gated behind an `else` on the auth branch, any
// global middleware made that branch unreachable — and an unmatched path has no
// route auth callback, so the socket was upgraded unauthenticated.

describe("unknown routes vs global middleware", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  });

  // The client appends `/<identity>` to the endpoint, so `base` is the
  // prefix and the resulting pathname is `${base}/CP001`.
  async function connectTo(port: number, base: string) {
    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}${base}`,
      identity: "CP001",
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    clients.push(client);
    return client.connect();
  }

  test("rejects an unmatched path even when a global middleware is registered", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);

    let authCalls = 0;
    server.use(async (ctx) => {
      await ctx.next();
    });
    server.route("/ocpp/:identity").auth((ctx) => {
      authCalls++;
      ctx.accept();
    });

    const httpServer = await server.listen(0);
    const port = (httpServer.address() as { port: number }).port;

    await expect(connectTo(port, "/totally/unknown")).rejects.toThrow();
    expect(authCalls).toBe(0);
    expect(server.hasLocalClient("CP001")).toBe(false);
  });

  test("still accepts the matched route when a global middleware is registered", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);

    let authCalls = 0;
    server.use(async (ctx) => {
      await ctx.next();
    });
    server.route("/ocpp/:identity").auth((ctx) => {
      authCalls++;
      ctx.accept();
    });

    const httpServer = await server.listen(0);
    const port = (httpServer.address() as { port: number }).port;

    await connectTo(port, "/ocpp");
    expect(authCalls).toBe(1);
    expect(server.hasLocalClient("CP001")).toBe(true);
  });

  test("a server with no routes at all still accepts any path", async () => {
    // The new gate is conditional on `hasPatternRouters`, so a server that
    // registered no routes must stay wide open exactly as before.
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);

    const httpServer = await server.listen(0);
    const port = (httpServer.address() as { port: number }).port;

    await connectTo(port, "/anything");
    expect(server.hasLocalClient("CP001")).toBe(true);
  });
});
