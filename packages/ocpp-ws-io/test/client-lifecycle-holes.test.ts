import { afterEach, describe, expect, test, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";

describe("client lifecycle holes", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  });

  async function startServer() {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);
    const http = await server.listen(0);
    return (http.address() as AddressInfo).port;
  }

  // A post-open socket error was re-emitted with no listener guard. Node throws
  // when 'error' is emitted with nothing listening, so any socket error after
  // the connection opened crashed a process that had not attached a handler.
  test("a socket error after open does not throw when nothing is listening", async () => {
    const port = await startServer();
    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity: "CP001",
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    clients.push(client);
    await client.connect();

    expect(client.listenerCount("error")).toBe(0);

    const ws = (client as unknown as { _ws: { emit(e: string, a: unknown): void } })
      ._ws;
    expect(() => ws.emit("error", new Error("socket blew up"))).not.toThrow();
  });

  test("a socket error after open still reaches a registered listener", async () => {
    const port = await startServer();
    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity: "CP002",
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    clients.push(client);
    await client.connect();

    const seen = vi.fn();
    client.on("error", seen);

    const ws = (client as unknown as { _ws: { emit(e: string, a: unknown): void } })
      ._ws;
    ws.emit("error", new Error("socket blew up"));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  // addEventListener('abort') never fires for a signal that already aborted, so
  // a call aborted while queued was transmitted anyway and only the timeout
  // ever settled it.
  test("a call whose signal already aborted is rejected and never sent", async () => {
    const port = await startServer();
    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity: "CP003",
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    clients.push(client);
    await client.connect();

    const ws = (client as unknown as { _ws: { send: (d: unknown) => void } })._ws;
    const sent: unknown[] = [];
    const originalSend = ws.send.bind(ws);
    ws.send = (data: unknown) => {
      sent.push(data);
      return originalSend(data);
    };

    const ac = new AbortController();
    ac.abort(new Error("caller gave up"));

    await expect(
      client.call("Heartbeat", {}, { signal: ac.signal }),
    ).rejects.toThrow("caller gave up");

    expect(sent).toHaveLength(0);
  });

  // close() clears a *pending* reconnect timer, but once the timer has fired
  // there is nothing left to clear — the attempt used to reconnect anyway and
  // leave the client alive in CONNECTING.
  test("close() during an in-flight reconnect does not resurrect the client", async () => {
    const port = await startServer();
    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity: "CP004",
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 10,
      backoffMin: 10,
      backoffMax: 20,
    });
    clients.push(client);
    await client.connect();

    // Hold the reconnect attempt open so close() lands while it is in flight.
    // Cancelling the timer is not enough once the timer has already fired.
    const internals = client as unknown as {
      _ws: { terminate(): void };
      _connectInternal(): Promise<unknown>;
    };
    const realConnect = internals._connectInternal.bind(internals);
    let release: (() => void) | null = null;
    internals._connectInternal = () =>
      new Promise((resolve, reject) => {
        release = () => realConnect().then(resolve, reject);
      });

    internals._ws.terminate();
    // Let the backoff timer fire and enter the stubbed attempt.
    await new Promise((r) => setTimeout(r, 60));
    expect(release).not.toBeNull();

    await client.close();

    // Now let the connection actually complete, after close() has returned.
    release?.();
    await new Promise((r) => setTimeout(r, 200));

    expect(client.state).toBe(OCPPClient.CLOSED);
    expect(server0Connected(servers[0])).toBe(false);
  });
});

function server0Connected(server: OCPPServer): boolean {
  return server.stats().connectedClients > 0;
}
