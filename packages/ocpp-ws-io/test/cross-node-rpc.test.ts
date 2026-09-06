import { afterEach, describe, expect, test, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import { InMemoryAdapter } from "../src/adapters/adapter.js";
import { TimeoutError } from "../src/errors.js";

/**
 * A two-node harness on one InMemoryAdapter: both servers share the adapter, so
 * presence and unicast behave like a real cluster without Redis.
 */
async function twoNodes() {
  const adapter = new InMemoryAdapter();
  const a = new OCPPServer({ protocols: ["ocpp1.6"], callTimeoutMs: 1000 });
  const b = new OCPPServer({ protocols: ["ocpp1.6"], callTimeoutMs: 1000 });
  await a.setAdapter(adapter);
  await b.setAdapter(adapter);
  const httpB = await b.listen(0);
  const portB = (httpB.address() as AddressInfo).port;
  return { adapter, a, b, portB };
}

describe("cross-node RPC", () => {
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

  // sendBatch returned `calls.map(() => undefined)` for any charger not on this
  // node, with a "future enhancement" comment — indistinguishable from "every
  // call failed", and silent.
  test("sendBatch reaches a charger owned by another node", async () => {
    const { a, b, portB } = await twoNodes();
    servers.push(a, b);

    const cp = await connectTo(portB, "CP-REMOTE");
    cp.handle("ocpp1.6", "Heartbeat", async () => ({
      currentTime: new Date().toISOString(),
    }));

    // `a` does not hold CP-REMOTE; `b` does.
    expect(a.hasLocalClient("CP-REMOTE")).toBe(false);
    expect(b.hasLocalClient("CP-REMOTE")).toBe(true);

    const results = await a.sendBatch("CP-REMOTE", [
      { method: "Heartbeat", params: {} },
      { method: "Heartbeat", params: {} },
    ]);

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r).toBeDefined();
      expect((r as { currentTime: string }).currentTime).toBeTruthy();
    }
  });

  // A remote timeout arrived as GenericError because the publisher reported
  // `rpcErrorCode`, which TimeoutError does not carry.
  test("a remote timeout arrives as TimeoutError, not GenericError", async () => {
    const { a, b, portB } = await twoNodes();
    servers.push(a, b);

    const cp = await connectTo(portB, "CP-SLOW");
    // Never answer, so the owning node's local call times out.
    cp.handle("ocpp1.6", "Heartbeat", () => new Promise(() => {}));

    await expect(a.sendToClient("CP-SLOW", "Heartbeat", {})).rejects.toBeInstanceOf(
      TimeoutError,
    );
  }, 20000);

  test("broadcast reports local delivery instead of swallowing it", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"], callTimeoutMs: 500 });
    servers.push(server);
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const ok = await connectTo(port, "CP-OK");
    ok.handle("ocpp1.6", "Heartbeat", async () => ({
      currentTime: new Date().toISOString(),
    }));
    const bad = await connectTo(port, "CP-BAD");
    bad.handle("ocpp1.6", "Heartbeat", async () => {
      throw new Error("charger refused");
    });

    const result = await server.broadcast("Heartbeat", {});

    expect(result.localDelivered).toBe(1);
    expect(result.localFailed).toHaveLength(1);
    expect(result.localFailed[0].identity).toBe("CP-BAD");
    // No adapter attached, so nothing was published.
    expect(result.remotePublished).toBe(false);
  }, 20000);

  // close() disconnected the adapter but left it attached, so a later listen()
  // looked clustered while cross-node RPC was dead.
  test("close() detaches the adapter and listen() warns about it", async () => {
    const warn = vi.fn();
    const adapter = new InMemoryAdapter();
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: {
        logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
      } as never,
    });
    servers.push(server);
    await server.setAdapter(adapter);
    await server.listen(0);

    const internals = server as unknown as { _adapter: unknown };
    expect(internals._adapter).not.toBeNull();

    await server.close();
    expect(internals._adapter).toBeNull();

    await server.listen(0);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("Restarting without an event adapter"),
      ),
    ).toBe(true);
  });

  test("an adapter without getPresence warns that routing is disabled", async () => {
    const warn = vi.fn();
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: {
        logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
      } as never,
    });
    servers.push(server);

    await server.setAdapter({
      publish: async () => {},
      subscribe: async () => {},
      unsubscribe: async () => {},
      disconnect: async () => {},
    });

    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("no getPresence()")),
    ).toBe(true);
  });

  test("a result from an unexpected node is discarded", async () => {
    const { a, b, portB } = await twoNodes();
    servers.push(a, b);
    const cp = await connectTo(portB, "CP-FENCE");
    // Slow enough that the call is still pending when we forge a reply —
    // InMemoryAdapter delivers synchronously, so a fast handler completes the
    // whole round trip before we can look.
    cp.handle("ocpp1.6", "Heartbeat", async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { currentTime: "genuine" };
    });

    const internals = a as unknown as {
      _pendingRemoteCalls: Map<string, { targetNode?: string }>;
      _onUnicast(msg: unknown): void;
    };

    const call = a.sendToClient("CP-FENCE", "Heartbeat", {});
    await new Promise((r) => setTimeout(r, 50));

    const [correlationId, pending] = [
      ...internals._pendingRemoteCalls.entries(),
    ][0] ?? [undefined, undefined];
    expect(correlationId).toBeDefined();
    expect(pending?.targetNode).toBeTruthy();

    // Forge a result claiming to be from a different node.
    internals._onUnicast({
      __type: "callResult",
      correlationId,
      source: "some-impostor-node",
      ok: true,
      result: { currentTime: "forged" },
    });

    // The forged result must not settle it; the genuine one still does.
    const real = (await call) as { currentTime: string };
    expect(real.currentTime).toBe("genuine");
  }, 20000);
});
