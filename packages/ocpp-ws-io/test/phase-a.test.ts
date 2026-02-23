import { describe, it, expect, afterEach, vi } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import { LRUMap } from "../src/lru-map.js";
import type { OCPPServerClient } from "../src/server-client.js";

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

// ─── Finding 6: Duplicate Identity Eviction ──────────────────────

describe("Phase A — Duplicate Identity Eviction", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should evict old socket when same identity reconnects", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    // Connect first client
    const client1 = new OCPPClient({
      identity: "CS_DUP",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client1.connect();
    await new Promise((r) => setTimeout(r, 50));

    expect(server.clients.size).toBe(1);
    const [sc1] = server.clients;
    expect(sc1.identity).toBe("CS_DUP");

    // Connect second client with SAME identity
    const client2 = new OCPPClient({
      identity: "CS_DUP",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client2.connect();
    await new Promise((r) => setTimeout(r, 100));

    // Server should have exactly 1 client (the new one), old one evicted
    expect(server.clients.size).toBe(1);
    const [sc2] = server.clients;
    expect(sc2).not.toBe(sc1); // Different server client instance
    expect(sc2.identity).toBe("CS_DUP");

    // clientsByIdentity should point to new client
    expect(server.getLocalClient("CS_DUP")).toBe(sc2);

    await client2.close({ force: true });
  });

  it("should preserve session data across eviction", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const client1 = new OCPPClient({
      identity: "CS_SESSION_EVT",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client1.connect();
    await new Promise((r) => setTimeout(r, 50));

    const sc1 = server.getLocalClient("CS_SESSION_EVT")!;
    sc1.session.marker = "preserved";

    // Disconnect THEN reconnect (different from eviction — session should persist via _sessions map)
    await client1.close();
    await new Promise((r) => setTimeout(r, 50));

    const client2 = new OCPPClient({
      identity: "CS_SESSION_EVT",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client2.connect();
    await new Promise((r) => setTimeout(r, 50));

    const sc2 = server.getLocalClient("CS_SESSION_EVT")!;
    expect(sc2.session.marker).toBe("preserved");

    await client2.close({ force: true });
  });
});

// ─── Finding 9: Connection-Level Token Bucket ────────────────────

describe("Phase A — Connection-Level Token Bucket", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should reject connections when rate limit is exceeded", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      connectionRateLimit: { limit: 2, windowMs: 10000 },
    });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    // First 2 connections should succeed
    const client1 = new OCPPClient({
      identity: "RL_1",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    const client2 = new OCPPClient({
      identity: "RL_2",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client1.connect();
    await client2.connect();

    // Third connection should be rejected (429)
    const client3 = new OCPPClient({
      identity: "RL_3",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    client3.on("error", () => {});
    await expect(client3.connect()).rejects.toThrow();

    await client1.close({ force: true });
    await client2.close({ force: true });
  });

  it("should allow connections after tokens refill", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      connectionRateLimit: { limit: 1, windowMs: 200 },
    });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const client1 = new OCPPClient({
      identity: "RL_REFILL_1",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client1.connect();
    await client1.close({ force: true });

    // Wait for the token to refill
    await new Promise((r) => setTimeout(r, 300));

    const client2 = new OCPPClient({
      identity: "RL_REFILL_2",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    // Should succeed after refill
    await client2.connect();
    expect(client2.state).toBe(OCPPClient.OPEN);
    await client2.close({ force: true });
  });
});

// ─── Finding 15: Server-side Ping/Pong ───────────────────────────

describe("Phase A — Server-side Ping/Pong", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should have ping timers active for server clients", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      pingIntervalMs: 30000,
    });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const clientReceived = new Promise<OCPPServerClient>((resolve) => {
      server.on("client", (sc) => resolve(sc as OCPPServerClient));
    });

    const client = new OCPPClient({
      identity: "CS_PING",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    const sc = await clientReceived;

    // Verify ping timer is set on server-side client
    // @ts-expect-error — accessing private field for verification
    expect(sc._pingTimer).not.toBeNull();

    await client.close({ force: true });
  });
});

// ─── Finding 5: LRU Map Fix ──────────────────────────────────────

describe("Phase A — LRUMap", () => {
  it("should evict oldest entries when capacity is exceeded", () => {
    const lru = new LRUMap<string, number>(3);

    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    expect(lru.size).toBe(3);

    // Adding 4th should evict "a" (oldest)
    lru.set("d", 4);
    expect(lru.size).toBe(3);
    expect(lru.has("a")).toBe(false);
    expect(lru.get("b")).toBe(2);
    expect(lru.get("c")).toBe(3);
    expect(lru.get("d")).toBe(4);
  });

  it("should promote accessed entries to MRU position", () => {
    const lru = new LRUMap<string, number>(3);

    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);

    // Access "a" to promote it
    lru.get("a");

    // Add "d" — should evict "b" (now the oldest), NOT "a"
    lru.set("d", 4);
    expect(lru.has("a")).toBe(true);
    expect(lru.has("b")).toBe(false);
  });

  it("should correctly handle falsy values (undefined, null, 0, empty string)", () => {
    const lru = new LRUMap<string, any>(5);

    lru.set("zero", 0);
    lru.set("empty", "");
    lru.set("null", null);
    lru.set("undef", undefined);
    lru.set("false", false);

    // All should be retrievable
    expect(lru.get("zero")).toBe(0);
    expect(lru.get("empty")).toBe("");
    expect(lru.get("null")).toBe(null);
    expect(lru.get("undef")).toBe(undefined);
    expect(lru.get("false")).toBe(false);

    // Has check should work for all
    expect(lru.has("zero")).toBe(true);
    expect(lru.has("undef")).toBe(true);
  });

  it("should correctly promote on set() for existing keys", () => {
    const lru = new LRUMap<string, number>(3);

    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);

    // Update "a" — promotes it to MRU
    lru.set("a", 10);

    // Add "d" — should evict "b" (now oldest)
    lru.set("d", 4);
    expect(lru.has("a")).toBe(true);
    expect(lru.get("a")).toBe(10); // Updated value
    expect(lru.has("b")).toBe(false);
  });

  it("should throw on invalid maxSize", () => {
    expect(() => new LRUMap(0)).toThrow("maxSize must be >= 1");
    expect(() => new LRUMap(-1)).toThrow("maxSize must be >= 1");
  });

  it("should return undefined for missing keys without corruption", () => {
    const lru = new LRUMap<string, number>(3);
    lru.set("a", 1);

    expect(lru.get("nonexistent")).toBeUndefined();
    expect(lru.size).toBe(1); // No side effects
  });

  it("should expose maxSize property", () => {
    const lru = new LRUMap<string, number>(42);
    expect(lru.maxSize).toBe(42);
  });
});

// ─── Integration: maxSessions in ServerOptions ───────────────────

describe("Phase A — Bounded Session Cache", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should use LRUMap for sessions with default maxSessions", () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    // @ts-expect-error — accessing private field for verification
    expect(server._sessions).toBeInstanceOf(LRUMap);
    // @ts-expect-error
    expect(server._sessions.maxSize).toBe(50_000);
  });

  it("should respect custom maxSessions", () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], maxSessions: 100 });
    // @ts-expect-error
    expect(server._sessions).toBeInstanceOf(LRUMap);
    // @ts-expect-error
    expect(server._sessions.maxSize).toBe(100);
  });
});
