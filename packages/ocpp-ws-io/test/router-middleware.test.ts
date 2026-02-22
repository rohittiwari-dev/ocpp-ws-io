import { describe, expect, it, afterEach, vi } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import http from "node:http";
import type { ConnectionContext } from "../src/types.js";

describe("OCPPRouter - Middleware & Multiplexing", () => {
  let server: OCPPServer;
  let httpServer: http.Server;
  let client1: OCPPClient;
  let client2: OCPPClient;

  afterEach(async () => {
    if (client1?.state !== 3) await client1?.close();
    if (client2?.state !== 3) await client2?.close();
    if (server) await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("should match strings, regex patterns, and execute middlewares in order", async () => {
    server = new OCPPServer({ logging: { level: "debug" } });
    httpServer = await server.listen(0);
    const port = (httpServer.address() as any).port;

    const mwOrder: string[] = [];
    const mw1 = async (ctx: ConnectionContext) => {
      mwOrder.push("mw1");
      ctx.state.tenant = ctx.handshake.params.tenant;
      await ctx.next();
      mwOrder.push("mw1-after");
    };

    const mw2 = async (ctx: ConnectionContext) => {
      mwOrder.push("mw2");
      expect(ctx.state.tenant).toBe("acme");
      await ctx.next();
    };

    const adminRoute = server
      .route(
        "/admin/:tenant/:identity",
        /^\/api\/v2\/(?<tenant>[^/]+)\/(?<identity>[^/]+)$/,
      )
      .use(mw1, mw2);

    const onClientSpy = vi.fn();
    adminRoute.on("client", (c) => onClientSpy(c.handshake.pathname));

    // Connect string route matches
    client1 = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}/admin/acme`,
    });
    await client1.connect();

    expect(onClientSpy).toHaveBeenCalledWith("/admin/acme/CP-1");
    expect(mwOrder).toEqual(["mw1", "mw2", "mw1-after"]);

    // Connect regex route matches
    client2 = new OCPPClient({
      identity: "CP-2",
      endpoint: `ws://localhost:${port}/api/v2/acme`,
    });
    await client2.connect();

    expect(onClientSpy).toHaveBeenCalledWith("/api/v2/acme/CP-2");
  });

  it("should reject connection if middleware throws", async () => {
    server = new OCPPServer({ logging: { level: "debug" } });
    httpServer = await server.listen(0);
    const port = (httpServer.address() as any).port;

    const blockingMw = async () => {
      const err = new Error("Blocked by Gatekeeper");
      (err as any).code = 403;
      throw err;
    };

    server.route("/secure/:id/:identity").use(blockingMw);

    client1 = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}/secure/123`,
    });

    client1.on("error", () => {});
    await expect(client1.connect()).rejects.toThrow("403");
  });

  it("should support a global catch-all router via server.use()", async () => {
    server = new OCPPServer({ logging: { level: "debug" } });
    httpServer = await server.listen(0);
    const port = (httpServer.address() as any).port;

    let useCalled = false;
    server
      .use(async (ctx) => {
        useCalled = true;
        await ctx.next();
      })
      .on("client", (client) => {
        client.handle("BootNotification", async ({ params }) => {
          return {
            currentTime: new Date().toISOString(),
            interval: 60,
            status: "Accepted",
          };
        });
      });

    client1 = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}/any/random/path`,
    });

    await client1.connect();
    expect(useCalled).toBe(true);
  });

  it("should securely reject connections using ctx.reject()", async () => {
    server = new OCPPServer({ logging: { level: "debug" } });
    httpServer = await server.listen(0);
    const port = (httpServer.address() as any).port;

    server.use(async (ctx) => {
      // Instantly abort connection natively
      ctx.reject(403, "Blocked by context reject");
    });

    client1 = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}/any/random/path`,
    });

    client1.on("error", () => {}); // Supress unhandled error log
    await expect(client1.connect()).rejects.toThrow("403");
  });

  it("should merge payload into ctx.state when using ctx.next(payload)", async () => {
    server = new OCPPServer({ logging: { level: "debug" } });
    httpServer = await server.listen(0);
    const port = (httpServer.address() as any).port;

    let finalState: any = null;

    server.use(
      async (ctx) => {
        // Setup initial state
        ctx.state.initial = "hello";
        await ctx.next({ injectedData: "world" });
      },
      async (ctx) => {
        // Data should be merged
        finalState = ctx.state;
        await ctx.next();
      },
    );

    client1 = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}/any/random/path`,
    });

    await client1.connect();
    expect(finalState).toBeDefined();
    expect(finalState.initial).toBe("hello");
    expect(finalState.injectedData).toBe("world");
  });

  it("should support defining handlers directly on the router via .handle()", async () => {
    server = new OCPPServer({ logging: false });
    httpServer = await server.listen(0);
    const port = (httpServer.address() as any).port;

    server
      .route("/direct/:id/:identity")
      .handle("BootNotification", async (ctx) => {
        return {
          currentTime: new Date().toISOString(),
          interval: 300,
          status: "Accepted",
        };
      });

    client1 = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}/direct/123`,
      protocols: ["ocpp1.6"],
    });

    await client1.connect();

    const response = await client1.call("ocpp1.6", "BootNotification", {
      chargePointVendor: "VendorX",
      chargePointModel: "ModelY",
    });

    expect(response.status).toBe("Accepted");
    expect((response as any).interval).toBe(300);
  });
});
