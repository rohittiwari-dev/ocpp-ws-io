import { describe, it, expect, afterEach } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

describe("Phase F4 — sendBatch()", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should pipeline multiple calls to a client concurrently", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CP_BATCH_1",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    client.handle("GetConfiguration", async () => ({
      configurationKey: [{ key: "test", value: "v1", readonly: false }],
      unknownKey: [],
    }));

    client.handle("ChangeConfiguration", async () => ({
      status: "Accepted",
    }));

    await client.connect();
    await new Promise((r) => setTimeout(r, 100));

    const results = await server.sendBatch("CP_BATCH_1", [
      { method: "GetConfiguration", params: { key: ["test"] } },
      { method: "ChangeConfiguration", params: { key: "test", value: "v2" } },
    ]);

    expect(results).toHaveLength(2);
    // sendBatch returns the value on success, undefined on failure
    // Both calls should succeed
    for (const r of results) {
      expect(r).toBeDefined();
    }

    await client.close({ force: true });
  });

  it("should return empty array when calls array is empty", async () => {
    server = new OCPPServer();
    server.auth((ctx) => ctx.accept());

    const results = await server.sendBatch("nonexistent", []);
    expect(results).toEqual([]);
  });

  it("should return undefined for each call when client is not connected", async () => {
    server = new OCPPServer();
    server.auth((ctx) => ctx.accept());

    await server.listen(0);

    // No client connected with this identity
    const results = await server.sendBatch("UNKNOWN_CP", [
      { method: "GetConfiguration", params: {} },
    ]);

    expect(results).toHaveLength(1);
    // Unknown client → returns undefined for each call
    expect(results[0]).toBeUndefined();
  });

  it("should restore original concurrency after batch completes", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CP_BATCH_CONC",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      callConcurrency: 2,
    });

    client.handle("Heartbeat", async () => ({
      currentTime: new Date().toISOString(),
    }));

    await client.connect();
    await new Promise((r) => setTimeout(r, 100));

    // Get the server-side client
    // @ts-expect-error — accessing private field for test
    const serverClient = server._clientsByIdentity.get("CP_BATCH_CONC");
    expect(serverClient).toBeDefined();

    const originalConc = serverClient!.options.callConcurrency;

    await server.sendBatch("CP_BATCH_CONC", [
      { method: "Heartbeat", params: {} },
      { method: "Heartbeat", params: {} },
      { method: "Heartbeat", params: {} },
    ]);

    // After batch, concurrency should be restored
    expect(serverClient!.options.callConcurrency).toBe(originalConc);

    await client.close({ force: true });
  });
});
