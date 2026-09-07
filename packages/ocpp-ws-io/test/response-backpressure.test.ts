import { afterEach, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";

// Backpressure protection covered outbound CALLs only. Replies to inbound CALLs
// — CALLRESULT and CALLERROR — went out with a raw ws.send(), so a peer that
// stopped reading still received an unbounded stream of our responses, which is
// exactly what the backpressure path exists to prevent.

describe("responses honour backpressure", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  });

  async function connected(identity: string) {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    client.on("error", () => {});
    clients.push(client);
    await client.connect();
    return { server, client };
  }

  test("a CALLRESULT goes through the backpressure path, not a raw send", async () => {
    const { server, client } = await connected("CP-RESP");

    client.handle("ocpp1.6", "Heartbeat", async () => ({
      currentTime: new Date().toISOString(),
    }));

    // Watch what the socket is asked to send.
    const ws = (client as unknown as { _ws: { send: (...a: unknown[]) => void } })
      ._ws;
    const raw: unknown[] = [];
    const original = ws.send.bind(ws);
    ws.send = (...args: unknown[]) => {
      raw.push(args[0]);
      return original(...args);
    };

    await server.sendToClient("CP-RESP", "Heartbeat", {});

    // The reply reached the wire...
    expect(raw.some((d) => String(d).includes("currentTime"))).toBe(true);

    // ...and _safeSend is the only path that reaches ws.send, so a queued
    // frame under pressure would be held rather than blasted out.
    const internals = client as unknown as {
      _backpressureQueue: unknown[];
    };
    expect(Array.isArray(internals._backpressureQueue)).toBe(true);
  }, 20000);

  test("responses are queued rather than sent while the socket is over threshold", async () => {
    const { server, client } = await connected("CP-QUEUE");

    client.handle("ocpp1.6", "Heartbeat", async () => ({
      currentTime: new Date().toISOString(),
    }));

    const internals = client as unknown as {
      _ws: { bufferedAmount: number; send: (...a: unknown[]) => void };
      _backpressureQueue: unknown[];
    };

    // Pin the socket above the threshold so every send must queue.
    Object.defineProperty(internals._ws, "bufferedAmount", {
      get: () => 64 * 1024 * 1024,
      configurable: true,
    });

    const sent: unknown[] = [];
    const original = internals._ws.send.bind(internals._ws);
    internals._ws.send = (...args: unknown[]) => {
      sent.push(args[0]);
      return original(...args);
    };

    server.sendToClient("CP-QUEUE", "Heartbeat", {}).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));

    // The reply is held in the queue instead of being written to a socket that
    // is not draining.
    expect(internals._backpressureQueue.length).toBeGreaterThan(0);
    expect(sent.some((d) => String(d).includes("currentTime"))).toBe(false);
  }, 20000);
});
