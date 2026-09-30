import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { OCPPServer } from "../src/server.js";

/**
 * OCPP 2.1 adds CALLRESULTERROR (5) and SEND (6). They were counted as bad
 * messages, so once maxBadMessages defaulted to 50 a 2.1 charger streaming
 * NotifyPeriodicEventStream was disconnected, after being sent a CALLERROR for
 * every frame — which the spec forbids.
 */
describe("OCPP 2.1 message types 5 and 6", () => {
  const servers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const s of servers.splice(0)) {
      await s.close({ force: true }).catch(() => {});
    }
  });

  async function open(protocol: string, maxBadMessages?: number) {
    const server = new OCPPServer({
      logging: false,
      protocols: [protocol as "ocpp2.1"],
      ...(maxBadMessages !== undefined ? { maxBadMessages } : {}),
    });
    servers.push(server);
    const { port } = (await server.listen(0)).address() as AddressInfo;
    const ws = new WebSocket(`ws://localhost:${port}/CP21`, [protocol]);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const replies: string[] = [];
    ws.on("message", (data) => replies.push(data.toString()));
    let closeCode: number | undefined;
    ws.once("close", (code) => {
      closeCode = code;
    });
    return { ws, replies, closeCode: () => closeCode };
  }

  const sendFrame = (id: string) =>
    JSON.stringify([
      6,
      id,
      "NotifyPeriodicEventStream",
      { id: 1, pending: 0, basetime: "2026-01-01T00:00:00Z", data: [] },
    ]);

  it("drops them on a 2.1 connection without replying or disconnecting", async () => {
    const { ws, replies, closeCode } = await open("ocpp2.1");

    for (let i = 0; i < 60; i++) ws.send(sendFrame(`s${i}`));
    ws.send(JSON.stringify([5, "r1", "InternalError", "boom", {}]));
    // A CALL afterwards is still processed on the same connection.
    ws.send(JSON.stringify([2, "call-1", "Heartbeat", {}]));
    await new Promise((r) => setTimeout(r, 300));

    expect(closeCode()).toBeUndefined();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(replies).toHaveLength(1);
    expect(JSON.parse(replies[0])[1]).toBe("call-1");
  });

  it("still treats them as bad messages on other protocols", async () => {
    const { ws, closeCode } = await open("ocpp1.6", 3);

    for (let i = 0; i < 3; i++) ws.send(sendFrame(`s${i}`));
    await new Promise((r) => setTimeout(r, 300));

    expect(closeCode()).toBe(1002);
  });
});
