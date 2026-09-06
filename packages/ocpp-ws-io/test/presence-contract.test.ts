import { afterEach, describe, expect, test, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import { InMemoryAdapter } from "../src/adapters/adapter.js";

describe("presence & adapter contract", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  });

  async function connectTo(port: number, identity: string) {
    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    client.on("error", () => {});
    clients.push(client);
    await client.connect();
    return client;
  }

  // Routing only ever called getPresence, so an adapter implementing just the
  // batch variant reported no owner for anybody and cross-node routing did
  // nothing — silently.
  test("an adapter with only getPresenceBatch can still route", async () => {
    const backing = new InMemoryAdapter();
    const batchOnly = {
      publish: backing.publish.bind(backing),
      publishBatch: backing.publishBatch.bind(backing),
      subscribe: backing.subscribe.bind(backing),
      unsubscribe: backing.unsubscribe.bind(backing),
      disconnect: backing.disconnect.bind(backing),
      setPresence: backing.setPresence.bind(backing),
      setPresenceBatch: backing.setPresenceBatch.bind(backing),
      removePresence: backing.removePresence.bind(backing),
      // Deliberately no getPresence.
      getPresenceBatch: backing.getPresenceBatch.bind(backing),
    };

    const a = new OCPPServer({ protocols: ["ocpp1.6"], callTimeoutMs: 2000 });
    const b = new OCPPServer({ protocols: ["ocpp1.6"], callTimeoutMs: 2000 });
    servers.push(a, b);
    await a.setAdapter(batchOnly as never);
    await b.setAdapter(batchOnly as never);

    const http = await b.listen(0);
    const port = (http.address() as AddressInfo).port;
    const cp = await connectTo(port, "CP-BATCH");
    cp.handle("ocpp1.6", "Heartbeat", async () => ({ currentTime: "ok" }));

    expect(await a.isClientConnected("CP-BATCH")).toBe(true);
    const res = (await a.sendToClient("CP-BATCH", "Heartbeat", {})) as {
      currentTime: string;
    };
    expect(res.currentTime).toBe("ok");
  }, 20000);

  // setAdapter overwrote the field, leaving the old adapter's subscriptions
  // live — its handlers kept driving this server and its resources were never
  // released.
  test("replacing the adapter unsubscribes the previous one", async () => {
    const first = new InMemoryAdapter();
    const unsub = vi.spyOn(first, "unsubscribe");
    const second = new InMemoryAdapter();

    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);
    await server.setAdapter(first);
    await server.setAdapter(second);

    const channels = unsub.mock.calls.map((c) => c[0]);
    expect(channels).toContain("ocpp:broadcast");
    expect(channels.some((c) => String(c).startsWith("ocpp:node:"))).toBe(true);
  });

  // Clients that connected before the adapter existed were invisible to the
  // cluster until the first heartbeat — a third of the TTL.
  test("attaching an adapter publishes presence for existing clients at once", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    await connectTo(port, "CP-EARLY");
    expect(server.hasLocalClient("CP-EARLY")).toBe(true);

    const adapter = new InMemoryAdapter();
    await server.setAdapter(adapter);

    // Immediately, without waiting for a heartbeat tick.
    expect(await adapter.getPresence("CP-EARLY")).toBeTruthy();
  }, 20000);

  test("attaching an adapter advertises this node's liveness at once", async () => {
    const adapter = new InMemoryAdapter();
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);
    await server.setAdapter(adapter);

    const nodeId = (server as unknown as { _nodeId: string })._nodeId;
    expect(await adapter.getPresence(`__node__:${nodeId}`)).toBe(nodeId);
  });

  // A crashed node left its clients in the registry for the full TTL, and every
  // call to them waited out callTimeoutMs before failing.
  test("a call to a charger on a dead node fails fast instead of timing out", async () => {
    const adapter = new InMemoryAdapter();
    const a = new OCPPServer({ protocols: ["ocpp1.6"], callTimeoutMs: 5000 });
    servers.push(a);
    await a.setAdapter(adapter);

    // A node that advertised itself, then vanished.
    await adapter.setPresence("__node__:ghost", "ghost", 300);
    await adapter.setPresence("CP-ORPHAN", "ghost", 300);
    await (
      a as unknown as { _isNodeAlive(n: string): Promise<boolean> }
    )._isNodeAlive("ghost");
    await adapter.removePresence("__node__:ghost");
    // Clear the short liveness cache so the next check re-reads.
    (a as unknown as { _nodeLiveness: Map<string, unknown> })._nodeLiveness.clear();

    const started = Date.now();
    await expect(a.sendToClient("CP-ORPHAN", "Heartbeat", {})).rejects.toThrow(
      "not found",
    );
    // Fast-fail, nowhere near callTimeoutMs.
    expect(Date.now() - started).toBeLessThan(1500);
    // The stale entry is cleaned up too.
    expect(await adapter.getPresence("CP-ORPHAN")).toBeNull();
  }, 20000);

  // Fail-safe: a node we have never seen advertise liveness may simply be
  // running a build that does not publish it. Declaring it dead would break
  // routing across a mixed-version cluster.
  test("a node that never advertised liveness is still treated as alive", async () => {
    const adapter = new InMemoryAdapter();
    const a = new OCPPServer({ protocols: ["ocpp1.6"], callTimeoutMs: 300 });
    servers.push(a);
    await a.setAdapter(adapter);

    await adapter.setPresence("CP-OLD", "legacy-node", 300);

    // Routed (and then times out for want of a real peer) rather than being
    // rejected outright as "not found".
    await expect(
      a.sendToClient("CP-OLD", "Heartbeat", {}),
    ).rejects.toThrow(/timed out/i);
  }, 20000);

  test("close() withdraws this node's liveness entry", async () => {
    const adapter = new InMemoryAdapter();
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    await server.setAdapter(adapter);
    const nodeId = (server as unknown as { _nodeId: string })._nodeId;
    expect(await adapter.getPresence(`__node__:${nodeId}`)).toBe(nodeId);

    await server.close();
    expect(await adapter.getPresence(`__node__:${nodeId}`)).toBeNull();
  });

  test("close() lets per-client presence deletions land before disconnecting", async () => {
    const adapter = new InMemoryAdapter();
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    await connectTo(port, "CP-DRAIN");
    expect(await adapter.getPresence("CP-DRAIN")).toBeTruthy();

    await server.close();
    // Not left behind for the full TTL with the owning node gone.
    expect(await adapter.getPresence("CP-DRAIN")).toBeNull();
  }, 20000);
});
