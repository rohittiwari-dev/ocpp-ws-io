import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { OCPPServer } from "../src/server/server.js";
import { createRPCError } from "../src/core/util.js";

type Protocol = "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1";

/**
 * The CALLERROR sent for a frame this side cannot process.
 *
 * - A frame whose message ID cannot be read is answered with message ID "-1"
 *   and RpcFrameworkError (2.0.1 / 2.1 §4.2.3).
 * - A call reusing the ID of one still being handled gets GenericError on
 *   1.6, whose error-code table has no RpcFrameworkError (1.6J Table 7).
 * - The error description is at most 255 characters on 2.0.1 and 2.1
 *   (Table 7, string[255]); 1.6 sets no limit.
 */
describe("RPC error replies", () => {
  const servers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const s of servers.splice(0)) {
      await s.close({ force: true }).catch(() => {});
    }
  });

  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  async function charger(protocol: Protocol) {
    const server = new OCPPServer({
      logging: false,
      protocols: [protocol],
      maxBadMessages: 20,
    });
    servers.push(server);
    server.on("client", (c) => {
      c.handle("Heartbeat", async () => {
        await settle(150);
        return { currentTime: "2026-01-01T00:00:00Z" };
      });
      c.handle("DataTransfer", () => {
        throw createRPCError("GenericError", "x".repeat(400));
      });
    });
    const { port } = (await server.listen(0)).address() as AddressInfo;
    const ws = new WebSocket(`ws://localhost:${port}/CP-ERR`, [protocol]);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const replies: unknown[][] = [];
    ws.on("message", (d) => replies.push(JSON.parse(d.toString())));
    return { ws, replies };
  }

  for (const protocol of ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"] as const) {
    it(`answers a frame whose message ID cannot be read with "-1" on ${protocol}`, async () => {
      const { ws, replies } = await charger(protocol);

      ws.send("not json");
      ws.send(JSON.stringify({ not: "an array" }));
      ws.send(JSON.stringify(["2", "x", "Heartbeat", {}]));
      ws.send(JSON.stringify([2, 123, "Heartbeat", {}]));
      ws.send('[2,"truncated","Heartbeat",{');
      await settle();

      expect(replies.map((m) => m.slice(0, 3))).toEqual(
        Array(5).fill([4, "-1", "RpcFrameworkError"]),
      );
    });
  }

  it("answers a duplicate in-flight message ID with GenericError on 1.6", async () => {
    const { ws, replies } = await charger("ocpp1.6");

    ws.send(JSON.stringify([2, "dup", "Heartbeat", {}]));
    ws.send(JSON.stringify([2, "dup", "Heartbeat", {}]));
    await settle(400);

    expect(replies.map((m) => m.slice(0, 3))).toContainEqual([
      4,
      "dup",
      "GenericError",
    ]);
  });

  for (const protocol of ["ocpp2.0.1", "ocpp2.1"] as const) {
    it(`keeps RpcFrameworkError for a duplicate in-flight message ID on ${protocol}`, async () => {
      const { ws, replies } = await charger(protocol);

      ws.send(JSON.stringify([2, "dup", "Heartbeat", {}]));
      ws.send(JSON.stringify([2, "dup", "Heartbeat", {}]));
      await settle(400);

      expect(replies.map((m) => m.slice(0, 3))).toContainEqual([
        4,
        "dup",
        "RpcFrameworkError",
      ]);
    });

    it(`limits the error description to 255 characters on ${protocol}`, async () => {
      const { ws, replies } = await charger(protocol);

      ws.send(JSON.stringify([2, "d1", "DataTransfer", { vendorId: "v" }]));
      await settle();

      expect(replies[0]?.[0]).toBe(4);
      expect(String(replies[0]?.[3])).toHaveLength(255);
    });
  }

  it("does not limit the error description on 1.6", async () => {
    const { ws, replies } = await charger("ocpp1.6");

    ws.send(JSON.stringify([2, "d1", "DataTransfer", { vendorId: "v" }]));
    await settle();

    expect(String(replies[0]?.[3])).toHaveLength(400);
  });
});
