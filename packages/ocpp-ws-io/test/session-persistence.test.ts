import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../src/adapters/adapter.js";
import { OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";
import type { PersistedSession } from "../src/types/index.js";

const getPort = (srv: Server): number => {
  const addr = srv.address();
  return addr && typeof addr !== "string" ? addr.port : 0;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** InMemoryAdapter plus a Map-backed session store, standing in for Redis. */
class SessionAdapter extends InMemoryAdapter {
  readonly store = new Map<string, string>();
  writes = 0;

  async setSession(identity: string, data: PersistedSession): Promise<void> {
    this.writes++;
    this.store.set(identity, JSON.stringify(data));
  }

  async getSession(identity: string): Promise<PersistedSession | null> {
    const raw = this.store.get(identity);
    return raw ? (JSON.parse(raw) as PersistedSession) : null;
  }

  stored(identity: string): PersistedSession | null {
    const raw = this.store.get(identity);
    return raw ? (JSON.parse(raw) as PersistedSession) : null;
  }
}

interface ServerInternals {
  _sessions: { has(identity: string): boolean; size: number };
  _sessionLastPersisted: Map<string, number>;
  _sweepSessionPersistMarks(now: number): void;
}
const internals = (s: OCPPServer): ServerInternals => s as never;

const servers: OCPPServer[] = [];
const clients: OCPPClient[] = [];

afterEach(async () => {
  for (const c of clients) await c.close({ force: true }).catch(() => {});
  for (const s of servers) await s.close({ force: true }).catch(() => {});
  clients.length = 0;
  servers.length = 0;
});

async function startServer(
  adapter?: InMemoryAdapter,
  options: { maxSessions?: number } = {},
) {
  const server = new OCPPServer({
    protocols: ["ocpp1.6"],
    logging: false,
    ...options,
  });
  servers.push(server);
  server.on("client", (c) =>
    c.handle("Heartbeat", () => ({ currentTime: new Date().toISOString() })),
  );
  if (adapter) await server.setAdapter(adapter);
  const port = getPort(await server.listen(0));
  return { server, port };
}

async function connect(port: number, identity: string) {
  const c = new OCPPClient({
    identity,
    endpoint: `ws://localhost:${port}`,
    protocols: ["ocpp1.6"],
    reconnect: false,
    logging: false,
  });
  clients.push(c);
  await c.connect();
  await wait(30);
  return c;
}

async function disconnect(c: OCPPClient) {
  await c.close();
  await wait(30);
}

describe("Session persistence — adapter with session support", () => {
  it("stores the session when a charger connects", async () => {
    const adapter = new SessionAdapter();
    const { port } = await startServer(adapter);

    await connect(port, "CP-CONNECT");

    expect(adapter.stored("CP-CONNECT")).toEqual({});
  });

  // Message-driven writes are debounced, so changes made shortly before a
  // disconnect used to be lost for the next node.
  it("stores the latest session when a charger disconnects", async () => {
    const adapter = new SessionAdapter();
    const { server, port } = await startServer(adapter);

    const c = await connect(port, "CP-FLUSH");
    server.getLocalClient("CP-FLUSH")!.session.tx = "active-42";
    await c.call("Heartbeat", {});
    await disconnect(c);

    expect(adapter.stored("CP-FLUSH")).toEqual({ tx: "active-42" });
  });

  it("restores the session on another node", async () => {
    const adapter = new SessionAdapter();
    const a = await startServer(adapter);
    const b = await startServer(adapter);

    const c1 = await connect(a.port, "CP-MOVE");
    a.server.getLocalClient("CP-MOVE")!.session.fleet = "alpha";
    await disconnect(c1);

    await connect(b.port, "CP-MOVE");
    expect(b.server.getLocalClient("CP-MOVE")!.session.fleet).toBe("alpha");
  });

  // Node A kept its old copy in the LRU and preferred it, then its connect
  // write pushed that old copy over node B's newer one in the store.
  it("prefers the stored session over an older local copy", async () => {
    const adapter = new SessionAdapter();
    const a = await startServer(adapter);
    const b = await startServer(adapter);

    const c1 = await connect(a.port, "CP-PING");
    a.server.getLocalClient("CP-PING")!.session.v = 1;
    await disconnect(c1);

    const c2 = await connect(b.port, "CP-PING");
    b.server.getLocalClient("CP-PING")!.session.v = 2;
    await disconnect(c2);

    await connect(a.port, "CP-PING");
    expect(a.server.getLocalClient("CP-PING")!.session.v).toBe(2);
    expect(adapter.stored("CP-PING")).toEqual({ v: 2 });
  });

  // The lookup ran on the raw URL identity, before the auth callback's
  // override, so a namespaced charger read another tenant's entry.
  it("looks sessions up by the identity auth settled on", async () => {
    const adapter = new SessionAdapter();
    await adapter.setSession("CP1", { owner: "other-tenant" });
    await adapter.setSession("tenantA:CP1", { owner: "tenant-a" });
    const { server, port } = await startServer(adapter);
    server.auth((ctx) =>
      ctx.accept({ protocol: "ocpp1.6", identity: "tenantA:CP1" }),
    );

    await connect(port, "CP1");

    expect(server.getLocalClient("tenantA:CP1")!.session.owner).toBe(
      "tenant-a",
    );
  });

  it("uses the live local session when the charger is still connected here", async () => {
    const adapter = new SessionAdapter();
    const { server, port } = await startServer(adapter);
    const getSpy = vi.spyOn(adapter, "getSession");

    await connect(port, "CP-DUP");
    server.getLocalClient("CP-DUP")!.session.live = true;
    const fetchesBefore = getSpy.mock.calls.length;

    await connect(port, "CP-DUP"); // duplicate identity replaces the first socket

    expect(getSpy.mock.calls.length).toBe(fetchesBefore);
    expect(server.getLocalClient("CP-DUP")!.session.live).toBe(true);
  });

  // With no time limit, an unreachable store stopped every charger connecting.
  it("still accepts chargers when the store does not answer", async () => {
    const adapter = new SessionAdapter();
    await adapter.setSession("CP-HANG", { v: "remote" });
    adapter.getSession = () => new Promise<PersistedSession | null>(() => {});
    const { server, port } = await startServer(adapter);

    const started = Date.now();
    await connect(port, "CP-HANG");

    expect(server.getLocalClient("CP-HANG")).toBeDefined();
    expect(Date.now() - started).toBeLessThan(3000);
    // The local guess must not overwrite what the store may hold.
    expect(adapter.stored("CP-HANG")).toEqual({ v: "remote" });
  });

  it("writes on messages at most once per debounce window", async () => {
    const adapter = new SessionAdapter();
    const { server, port } = await startServer(adapter);

    const c = await connect(port, "CP-DEBOUNCE");
    const afterConnect = adapter.writes;
    await c.call("Heartbeat", {});
    await c.call("Heartbeat", {});
    expect(adapter.writes).toBe(afterConnect);

    // Age the mark past the window: the next message writes again.
    internals(server)._sessionLastPersisted.set(
      "CP-DEBOUNCE",
      Date.now() - 31_000,
    );
    await c.call("Heartbeat", {});
    expect(adapter.writes).toBe(afterConnect + 1);
  });

  // Marks were only cleared alongside LRU entries, so identities the LRU
  // evicted kept theirs forever.
  it("sweeps debounce marks by age, independent of the LRU", async () => {
    const adapter = new SessionAdapter();
    const { server, port } = await startServer(adapter, { maxSessions: 2 });

    for (let i = 0; i < 5; i++) {
      await disconnect(await connect(port, `CP-G${i}`));
    }
    expect(internals(server)._sessions.size).toBe(2);
    expect(internals(server)._sessionLastPersisted.size).toBe(5);

    internals(server)._sweepSessionPersistMarks(Date.now() + 30_000);
    expect(internals(server)._sessionLastPersisted.size).toBe(0);
  });

  it("recovers a session the LRU evicted", async () => {
    const adapter = new SessionAdapter();
    const { server, port } = await startServer(adapter, { maxSessions: 2 });

    const c1 = await connect(port, "CP-A");
    server.getLocalClient("CP-A")!.session.region = "EU";
    await disconnect(c1);
    await disconnect(await connect(port, "CP-B"));
    await disconnect(await connect(port, "CP-C"));
    expect(internals(server)._sessions.has("CP-A")).toBe(false);

    await connect(port, "CP-A");
    expect(server.getLocalClient("CP-A")!.session.region).toBe("EU");
  });

  it("lets final session writes land before close() disconnects the adapter", async () => {
    const adapter = new SessionAdapter();
    const write = adapter.setSession.bind(adapter);
    adapter.setSession = async (identity, data) => {
      await wait(100);
      await write(identity, data);
    };
    const { server, port } = await startServer(adapter);

    await connect(port, "CP-SHUTDOWN");
    server.getLocalClient("CP-SHUTDOWN")!.session.last = "state";
    await server.close();

    expect(adapter.stored("CP-SHUTDOWN")).toEqual({ last: "state" });
  });

  it("gives auth-supplied session data precedence over the stored copy", async () => {
    const adapter = new SessionAdapter();
    await adapter.setSession("CP-MERGE", { fromStore: "yes", shared: "store" });
    const { server, port } = await startServer(adapter);
    server.auth((ctx) =>
      ctx.accept({
        protocol: "ocpp1.6",
        session: { fromAuth: "yes", shared: "auth" },
      }),
    );

    await connect(port, "CP-MERGE");

    expect(server.getLocalClient("CP-MERGE")!.session).toEqual({
      fromStore: "yes",
      fromAuth: "yes",
      shared: "auth",
    });
  });
});

describe("Session persistence — no session support (LRU only)", () => {
  it("keeps the session across a reconnect to the same node", async () => {
    const { server, port } = await startServer(new InMemoryAdapter());

    const c1 = await connect(port, "CP-LRU");
    server.getLocalClient("CP-LRU")!.session.role = "charger";
    await disconnect(c1);

    await connect(port, "CP-LRU");
    expect(server.getLocalClient("CP-LRU")!.session.role).toBe("charger");
  });

  it("loses a session the LRU evicted", async () => {
    const { server, port } = await startServer(undefined, { maxSessions: 2 });

    const c1 = await connect(port, "CP-A");
    server.getLocalClient("CP-A")!.session.id = "A";
    await disconnect(c1);
    await disconnect(await connect(port, "CP-B"));
    await disconnect(await connect(port, "CP-C"));

    await connect(port, "CP-A");
    expect(server.getLocalClient("CP-A")!.session.id).toBeUndefined();
  });
});
