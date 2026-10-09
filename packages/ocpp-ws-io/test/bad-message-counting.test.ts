import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { OCPPServer } from "../src/server/server.js";

/**
 * maxBadMessages counts bad messages in a row: every valid message resets the
 * count. Counting over the whole connection slowly
 * disconnected working chargers that send an occasional odd frame. Empty
 * frames, which some charge point vendors send, are ignored outright.
 */
describe("bad-message counting", () => {
  const servers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const s of servers.splice(0)) {
      await s.close({ force: true }).catch(() => {});
    }
  });

  async function open(maxBadMessages: number) {
    const server = new OCPPServer({
      logging: false,
      protocols: ["ocpp1.6"],
      maxBadMessages,
    });
    servers.push(server);
    server.on("client", (c) =>
      c.handle("Heartbeat", () => ({ currentTime: "2026-01-01T00:00:00Z" })),
    );
    const { port } = (await server.listen(0)).address() as AddressInfo;
    const ws = new WebSocket(`ws://localhost:${port}/CP-BAD`, ["ocpp1.6"]);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const replies: unknown[][] = [];
    ws.on("message", (d) => replies.push(JSON.parse(d.toString())));
    let closeCode: number | undefined;
    ws.once("close", (code) => {
      closeCode = code;
    });
    return { ws, replies, closeCode: () => closeCode };
  }

  const settle = () => new Promise((r) => setTimeout(r, 200));
  const heartbeat = (id: string) => JSON.stringify([2, id, "Heartbeat", {}]);

  it("resets the count after a valid message", async () => {
    const { ws, closeCode } = await open(3);

    ws.send("bad-1");
    ws.send("bad-2");
    ws.send(heartbeat("h1"));
    ws.send("bad-3");
    ws.send("bad-4");
    await settle();

    expect(closeCode()).toBeUndefined();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it("still closes after maxBadMessages bad messages in a row", async () => {
    const { ws, closeCode } = await open(3);

    ws.send("bad-1");
    ws.send("bad-2");
    ws.send("bad-3");
    await settle();

    expect(closeCode()).toBe(1002);
  });

  it("ignores empty frames without replying or counting them", async () => {
    const { ws, replies, closeCode } = await open(2);

    for (let i = 0; i < 5; i++) ws.send("");
    ws.send(heartbeat("h1"));
    await settle();

    expect(closeCode()).toBeUndefined();
    expect(replies.map((m) => [m[0], m[1]])).toEqual([[3, "h1"]]);
  });
});
