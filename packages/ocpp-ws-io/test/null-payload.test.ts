import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { OCPPServer } from "../src/server.js";

/**
 * Every OCPP-J version allows a missing payload to be sent as `null`
 * (1.6J §4.2.1–4.2.2, 2.0.1 and 2.1 §4.1.5). It was rejected as a
 * FormationViolation and counted toward maxBadMessages, so a charger using
 * that notation was disconnected.
 */
describe("null payload", () => {
  const servers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const s of servers.splice(0)) {
      await s.close({ force: true }).catch(() => {});
    }
  });

  async function open(protocol: "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1") {
    const server = new OCPPServer({
      logging: false,
      protocols: [protocol],
      maxBadMessages: 2,
    });
    servers.push(server);
    const received: unknown[] = [];
    server.on("client", (c) =>
      c.handle("Heartbeat", ({ params }) => {
        received.push(params);
        return { currentTime: "2026-01-01T00:00:00Z" };
      }),
    );
    const { port } = (await server.listen(0)).address() as AddressInfo;
    const ws = new WebSocket(`ws://localhost:${port}/CP-NULL`, [protocol]);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const replies: unknown[][] = [];
    ws.on("message", (d) => replies.push(JSON.parse(d.toString())));
    return { server, ws, received, replies };
  }

  for (const protocol of ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"] as const) {
    it(`treats a null CALL payload as {} on ${protocol}`, async () => {
      const { ws, received, replies } = await open(protocol);

      for (let i = 0; i < 3; i++) {
        ws.send(JSON.stringify([2, `h${i}`, "Heartbeat", null]));
      }
      await new Promise((r) => setTimeout(r, 200));

      expect(received).toEqual([{}, {}, {}]);
      expect(replies.map((m) => m[0])).toEqual([3, 3, 3]);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });
  }

  it("resolves a call answered with a null CALLRESULT payload as {}", async () => {
    const { server, ws } = await open("ocpp1.6");
    ws.on("message", (d) => {
      const msg = JSON.parse(d.toString());
      if (msg[0] === 2) ws.send(JSON.stringify([3, msg[1], null]));
    });
    const client = server.getLocalClient("CP-NULL")!;

    await expect(client.call("ClearCache", {})).resolves.toEqual({});
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});
