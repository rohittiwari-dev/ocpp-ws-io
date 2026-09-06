import { afterEach, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";

// Identity defaults to the last path segment, so two chargers sharing a station
// id under different prefixes — /tenant-a/CP001 and /tenant-b/CP001 — collided:
// same _clientsByIdentity entry, same cluster presence key, and the second
// connection evicted the first. An auth callback can now namespace it.

describe("auth identity override", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  });

  async function connect(port: number, base: string, identity: string) {
    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}${base}`,
      identity,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    clients.push(client);
    await client.connect();
    return client;
  }

  test("two tenants with the same station id stay separate connections", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);

    server.route("/:tenant/:identity").auth((ctx) => {
      ctx.accept({
        identity: `${ctx.handshake.params.tenant}:${ctx.handshake.params.identity}`,
      });
    });

    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    await connect(port, "/tenant-a", "CP001");
    await connect(port, "/tenant-b", "CP001");

    // Without the override the second connection would evict the first.
    expect(server.hasLocalClient("tenant-a:CP001")).toBe(true);
    expect(server.hasLocalClient("tenant-b:CP001")).toBe(true);
    expect(server.stats().connectedClients).toBe(2);
  });

  test("without an override the raw identity still collides", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);

    server.route("/:tenant/:identity").auth((ctx) => ctx.accept());

    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    await connect(port, "/tenant-a", "CP001");
    await connect(port, "/tenant-b", "CP001");

    // Documents the default: one identity, so the second evicts the first.
    expect(server.stats().connectedClients).toBe(1);
    expect(server.hasLocalClient("CP001")).toBe(true);
  });

  test("the overridden identity is what routing and lookup use", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);

    server.route("/:tenant/:identity").auth((ctx) => {
      ctx.accept({ identity: `${ctx.handshake.params.tenant}:${ctx.handshake.params.identity}` });
    });

    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;
    await connect(port, "/acme", "CP001");

    expect(server.getLocalClient("acme:CP001")).toBeDefined();
    expect(server.getLocalClient("CP001")).toBeUndefined();
    expect(await server.isClientConnected("acme:CP001")).toBe(true);
  });
});
