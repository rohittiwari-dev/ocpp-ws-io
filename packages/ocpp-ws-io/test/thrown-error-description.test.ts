import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRPCError } from "../src/core/util.js";
import { OCPPServer } from "../src/server/server.js";

/**
 * What a CALLERROR says when a handler or middleware throws (O26). A thrown
 * RPC error says what the peer reads: its code, its own message and the
 * details it carries. Any other error is an InternalError described by that
 * code's standard text, so its message (a stack, a password) stays here.
 */
describe("the CALLERROR for a thrown error", () => {
  const servers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  async function exchange(frame: [number, string, string, object]) {
    const server = new OCPPServer({
      logging: false,
      protocols: ["ocpp2.0.1"],
    });
    servers.push(server);
    server.on("client", (c) => {
      c.use(async (ctx, next) => {
        if (ctx.type === "incoming_call" && ctx.method === "MeterValues") {
          throw createRPCError("SecurityError", "Signature does not verify");
        }
        return next();
      });
      c.handle("Authorize", () => {
        throw createRPCError("NotSupported", "No local list on this CSMS", {
          hint: "use the CSMS's list",
        });
      });
      c.handle("StatusNotification", () => {
        throw new Error("db password is hunter2");
      });
    });
    const { port } = (await server.listen(0)).address() as AddressInfo;
    const ws = new WebSocket(`ws://localhost:${port}/CP-1`, ["ocpp2.0.1"]);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const reply = new Promise<string>((resolve) =>
      ws.once("message", (d) => resolve(d.toString())),
    );
    ws.send(JSON.stringify(frame));
    return JSON.parse(await reply);
  }

  it("sends a handler's RPC error with its own message and details", async () => {
    expect(await exchange([2, "a1", "Authorize", {}])).toEqual([
      4,
      "a1",
      "NotSupported",
      "No local list on this CSMS",
      { hint: "use the CSMS's list" },
    ]);
  });

  it("sends a middleware's RPC error with its own message", async () => {
    expect(await exchange([2, "m1", "MeterValues", {}])).toEqual([
      4,
      "m1",
      "SecurityError",
      "Signature does not verify",
      {},
    ]);
  });

  it("keeps another error's message here, behind InternalError's text", async () => {
    const reply = await exchange([2, "s1", "StatusNotification", {}]);

    expect(reply.slice(0, 3)).toEqual([4, "s1", "InternalError"]);
    expect(reply[3]).toBe(createRPCError("InternalError").rpcErrorMessage);
    expect(JSON.stringify(reply)).not.toContain("hunter2");
  });
});
