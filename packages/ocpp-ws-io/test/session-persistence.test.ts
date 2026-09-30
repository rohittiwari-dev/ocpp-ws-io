import { describe, it, expect, afterEach, vi } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import { InMemoryAdapter } from "../src/adapters/adapter.js";
import type { EventAdapterInterface } from "../src/types.js";

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Extends InMemoryAdapter with session persistence methods,
 * simulating what RedisAdapter provides — backed by a plain Map.
 */
class SessionAdapter extends InMemoryAdapter {
  readonly store = new Map<string, { data: string; ttl: number }>();

  async setSession(
    identity: string,
    data: Record<string, unknown>,
    ttl: number,
  ): Promise<void> {
    this.store.set(identity, { data: JSON.stringify(data), ttl });
  }

  async getSession(
    identity: string,
  ): Promise<Record<string, unknown> | null> {
    const entry = this.store.get(identity);
    if (!entry) return null;
    return JSON.parse(entry.data) as Record<string, unknown>;
  }

  async removeSession(identity: string): Promise<void> {
    this.store.delete(identity);
  }
}

// ─── Session Persistence: Hybrid LRU + Adapter ─────────────────

describe("Session Persistence — adapter-backed hybrid", () => {
  let server: OCPPServer;
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const c of clients) await c.close({ force: true }).catch(() => {});
    clients.length = 0;
    if (server) await server.close({ force: true }).catch(() => {});
  });

  const connect = async (port: number, identity: string) => {
    const c = new OCPPClient({
      identity,
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    clients.push(c);
    await c.connect();
    await wait(50);
    return c;
  };

  // ── Write-through: session data reaches the adapter store ──

  it("should persist session to adapter on connect (force write)", async () => {
    const adapter = new SessionAdapter();
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = getPort(http);

    await connect(port, "CP-PERSIST");

    // The adapter store should have an entry for this identity.
    const stored = await adapter.getSession("CP-PERSIST");
    expect(stored).not.toBeNull();
    expect(typeof stored).toBe("object");
  });

  // ── Read-through: LRU miss → adapter hit ──

  it("should restore session from adapter when LRU has no entry", async () => {
    const adapter = new SessionAdapter();
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = getPort(http);

    // Step 1: connect, set session data, force-persist, then disconnect.
    const c1 = await connect(port, "CP-READTHROUGH");
    const sc1 = server.getLocalClient("CP-READTHROUGH")!;
    sc1.session.fleet = "alpha";
    sc1.session.priority = 5;

    // Mutating client.session does not auto-persist to adapter — explicitly
    // force-persist the updated data so the adapter store has it.
    // @ts-expect-error — accessing private method
    server._updateSessionActivity("CP-READTHROUGH", sc1.session, true);
    await wait(10);

    await c1.close();
    await wait(50);

    // Step 2: purge the LRU to simulate a different-node reconnect.
    // @ts-expect-error — accessing private _sessions for test
    server._sessions.delete("CP-READTHROUGH");

    // Step 3: reconnect — the server should read from adapter and merge.
    const c2 = await connect(port, "CP-READTHROUGH");
    const sc2 = server.getLocalClient("CP-READTHROUGH")!;

    // The session data set in step 1 is present via adapter read-through.
    expect(sc2.session.fleet).toBe("alpha");
    expect(sc2.session.priority).toBe(5);
  });

  // ── Without adapter: sessions stay purely in LRU ──

  it("should work without adapter session methods (plain InMemoryAdapter)", async () => {
    const adapter = new InMemoryAdapter(); // no session methods
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = getPort(http);

    const c1 = await connect(port, "CP-NOADAPTER");
    const sc1 = server.getLocalClient("CP-NOADAPTER")!;
    sc1.session.tag = "local-only";
    await c1.close();
    await wait(50);

    // LRU still holds the session on same node.
    const c2 = await connect(port, "CP-NOADAPTER");
    const sc2 = server.getLocalClient("CP-NOADAPTER")!;
    expect(sc2.session.tag).toBe("local-only");
  });

  // ── LRU miss + no adapter → empty session ──

  it("should start with empty session when LRU purged and no adapter sessions", async () => {
    const adapter = new InMemoryAdapter();
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = getPort(http);

    const c1 = await connect(port, "CP-EMPTY");
    const sc1 = server.getLocalClient("CP-EMPTY")!;
    sc1.session.data = "gone";
    await c1.close();
    await wait(50);

    // @ts-expect-error — purge LRU
    server._sessions.delete("CP-EMPTY");

    const c2 = await connect(port, "CP-EMPTY");
    const sc2 = server.getLocalClient("CP-EMPTY")!;
    // No adapter session, LRU purged → session is empty.
    expect(sc2.session.data).toBeUndefined();
  });

  // ── Debounce: activity writes are throttled ──

  it("should debounce adapter writes (no flood on high-frequency updates)", async () => {
    const adapter = new SessionAdapter();
    const setSpy = vi.spyOn(adapter, "setSession");
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = getPort(http);

    await connect(port, "CP-DEBOUNCE");

    // The connect path force-persists (1 call).
    const callsAfterConnect = setSpy.mock.calls.length;
    expect(callsAfterConnect).toBeGreaterThanOrEqual(1);

    // Trigger _updateSessionActivity multiple times via the server's internal
    // message path — we access the private method directly for isolation.
    // @ts-expect-error — accessing private method
    server._updateSessionActivity("CP-DEBOUNCE", { tick: 1 });
    // @ts-expect-error
    server._updateSessionActivity("CP-DEBOUNCE", { tick: 2 });
    // @ts-expect-error
    server._updateSessionActivity("CP-DEBOUNCE", { tick: 3 });

    // All three should have been debounced — no additional adapter calls.
    expect(setSpy.mock.calls.length).toBe(callsAfterConnect);
  });

  // ── Force bypass debounce ──

  it("should bypass debounce when force=true", async () => {
    const adapter = new SessionAdapter();
    const setSpy = vi.spyOn(adapter, "setSession");
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = getPort(http);

    await connect(port, "CP-FORCE");
    const afterConnect = setSpy.mock.calls.length;

    // @ts-expect-error
    server._updateSessionActivity("CP-FORCE", { forced: true }, true);
    expect(setSpy.mock.calls.length).toBe(afterConnect + 1);

    // @ts-expect-error
    server._updateSessionActivity("CP-FORCE", { forced: true }, true);
    expect(setSpy.mock.calls.length).toBe(afterConnect + 2);
  });

  // ── Session merge priority ──

  it("should merge session with correct priority: ctx.state < adapter < LRU < auth", async () => {
    const adapter = new SessionAdapter();

    // Pre-seed adapter with session data (simulating cross-node data).
    await adapter.setSession(
      "CP-MERGE",
      { fromAdapter: "yes", shared: "adapter-value" },
      300,
    );

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => {
      // Auth-supplied session has highest priority.
      ctx.accept({
        protocol: "ocpp1.6",
        session: { fromAuth: "yes", shared: "auth-wins" },
      } as never);
    });
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = getPort(http);

    const c = await connect(port, "CP-MERGE");
    const sc = server.getLocalClient("CP-MERGE")!;

    expect(sc.session.fromAdapter).toBe("yes");
    expect(sc.session.fromAuth).toBe("yes");
    // Auth overrides adapter for the shared key.
    expect(sc.session.shared).toBe("auth-wins");
  });

  // ── close() clears debounce tracker ──

  it("should clear debounce tracker on server close", async () => {
    const adapter = new SessionAdapter();
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = getPort(http);

    await connect(port, "CP-CLOSE");

    // @ts-expect-error — private field
    expect(server._sessionLastPersisted.size).toBeGreaterThan(0);

    await server.close({ force: true });

    // @ts-expect-error
    expect(server._sessionLastPersisted.size).toBe(0);
  });
});

// ─── Session Persistence: No Adapter (pure LRU) ────────────────

describe("Session Persistence — no adapter (pure LRU)", () => {
  let server: OCPPServer;
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const c of clients) await c.close({ force: true }).catch(() => {});
    clients.length = 0;
    if (server) await server.close({ force: true }).catch(() => {});
  });

  const connect = async (port: number, identity: string) => {
    const c = new OCPPClient({
      identity,
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    clients.push(c);
    await c.connect();
    await wait(50);
    return c;
  };

  it("should preserve session in LRU across disconnect/reconnect on same node", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const http = await server.listen(0);
    const port = getPort(http);

    const c1 = await connect(port, "CP-LRU");
    const sc1 = server.getLocalClient("CP-LRU")!;
    sc1.session.role = "charger";
    await c1.close();
    await wait(50);

    const c2 = await connect(port, "CP-LRU");
    const sc2 = server.getLocalClient("CP-LRU")!;
    expect(sc2.session.role).toBe("charger");
  });

  it("should lose session when LRU evicts (no adapter fallback)", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], maxSessions: 2 });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const http = await server.listen(0);
    const port = getPort(http);

    // Fill LRU to capacity.
    const c1 = await connect(port, "CP-A");
    server.getLocalClient("CP-A")!.session.id = "A";
    const c2 = await connect(port, "CP-B");
    server.getLocalClient("CP-B")!.session.id = "B";

    // Third connection evicts the oldest (CP-A) from LRU.
    const c3 = await connect(port, "CP-C");

    await c1.close();
    await wait(50);

    // @ts-expect-error — verify LRU no longer has CP-A
    const hasA = server._sessions.has("CP-A");
    expect(hasA).toBe(false);
  });

  it("should recover from LRU eviction when adapter has session", async () => {
    const adapter = new SessionAdapter();
    server = new OCPPServer({ protocols: ["ocpp1.6"], maxSessions: 2 });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = getPort(http);

    // Connect CP-A — written to both LRU and adapter.
    const c1 = await connect(port, "CP-A");
    server.getLocalClient("CP-A")!.session.region = "EU";

    // Force-persist the updated session data to adapter.
    // @ts-expect-error
    server._updateSessionActivity(
      "CP-A",
      server.getLocalClient("CP-A")!.session,
      true,
    );
    await wait(10);

    await c1.close();
    await wait(50);

    // Fill LRU to push CP-A out.
    await connect(port, "CP-B");
    await connect(port, "CP-C");

    // @ts-expect-error — CP-A should be evicted from LRU
    expect(server._sessions.has("CP-A")).toBe(false);
    // But adapter still has it.
    expect(await adapter.getSession("CP-A")).not.toBeNull();

    // Reconnect CP-A — adapter read-through should restore session.
    const c4 = await connect(port, "CP-A");
    const sc = server.getLocalClient("CP-A")!;
    expect(sc.session.region).toBe("EU");
  });
});
