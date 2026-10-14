import type { AddressInfo } from "node:net";
import WebSocketModule from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { OCPPServerClient } from "../src/server/server-client.js";
import { OCPPServer } from "../src/server/server.js";
import type { MessageEventPayload } from "../src/types/events.js";

/**
 * server.on("message") fires for every frame of every connection, both
 * directions, with the connection as the second argument (O35). It was typed
 * but never emitted, so a listener type-checked and received nothing.
 */

const servers: OCPPServer[] = [];
const sockets: WebSocketModule[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const s of servers.splice(0)) await s.close({ force: true });
});

async function start() {
  const server = new OCPPServer({ logging: false, protocols: ["ocpp1.6"] });
  servers.push(server);
  const seen: Array<{ payload: MessageEventPayload; client: OCPPServerClient }> = [];
  server.on("message", (payload, client) => seen.push({ payload, client }));
  const clients = new Map<string, OCPPServerClient>();
  server.on("client", (c) => {
    clients.set(c.identity, c);
    c.handle("Heartbeat", () => ({ currentTime: "2026-10-14T00:00:00.000Z" }));
  });
  const { port } = (await server.listen(0)).address() as AddressInfo;
  return { server, port, seen, clients };
}

/** A charger on a bare socket that answers every call with an empty configuration. */
async function charger(port: number, identity: string) {
  const ws = new WebSocketModule(`ws://localhost:${port}/${identity}`, ["ocpp1.6"]);
  sockets.push(ws);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.on("message", (data) => {
    const frame = JSON.parse(data.toString()) as [number, string, ...unknown[]];
    if (frame[0] === 2) ws.send(JSON.stringify([3, frame[1], { configurationKey: [] }]));
  });
  const heartbeat = (id: string) =>
    new Promise<void>((resolve) => {
      const onReply = (data: WebSocketModule.RawData) => {
        const frame = JSON.parse(data.toString()) as [number, string];
        if (frame[0] === 3 && frame[1] === id) {
          ws.off("message", onReply);
          resolve();
        }
      };
      ws.on("message", onReply);
      ws.send(JSON.stringify([2, id, "Heartbeat", {}]));
    });
  return { ws, heartbeat };
}

describe('server.on("message")', () => {
  it("fires for a call each way, with direction and the connection", async () => {
    const { port, seen, clients } = await start();
    const cp = await charger(port, "CP-1");

    await cp.heartbeat("h1");
    const client = clients.get("CP-1");
    expect(client).toBeDefined();
    await client?.call("GetConfiguration", {});

    expect(
      seen.map(({ payload, client: c }) => [c.identity, payload.direction, payload.message[0]]),
    ).toEqual([
      ["CP-1", "IN", 2],
      ["CP-1", "OUT", 3],
      ["CP-1", "OUT", 2],
      ["CP-1", "IN", 3],
    ]);
    expect(seen[0]?.payload.message).toEqual([2, "h1", "Heartbeat", {}]);
    for (const { client: c } of seen) expect(c).toBe(client);
  });

  it("names the right connection when several chargers are connected", async () => {
    const { port, seen, clients } = await start();
    const one = await charger(port, "CP-1");
    const two = await charger(port, "CP-2");

    await Promise.all([one.heartbeat("from-1"), two.heartbeat("from-2")]);

    const calls = seen.filter(({ payload }) => payload.direction === "IN");
    expect(calls).toHaveLength(2);
    for (const { payload, client } of calls) {
      expect(payload.message[1]).toBe(client.identity === "CP-1" ? "from-1" : "from-2");
      expect(client).toBe(clients.get(client.identity));
    }
  });

  it("still accepts a one-parameter listener", async () => {
    const { server, port } = await start();
    const payloads: MessageEventPayload[] = [];
    server.on("message", (payload) => payloads.push(payload));
    const cp = await charger(port, "CP-1");

    await cp.heartbeat("h1");

    expect(payloads.map((p) => p.direction)).toEqual(["IN", "OUT"]);
  });
});
