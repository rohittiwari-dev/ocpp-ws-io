import type { AddressInfo } from "node:net";
import WebSocketModule from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { createRPCError } from "../src/core/util.js";
import { OCPPServer } from "../src/server/server.js";
import type { OCPPServerClient } from "../src/server/server-client.js";

/**
 * The code a thrown format violation goes out with (O29). OCPP-J 1.6 §4.2.3
 * names it FormationViolation, and the 1.6-J errata (v1.0, §5.2) keep that
 * name on the wire: "Do not fix, this is a message level change, might break
 * implementations". 2.0.1 and 2.1 name it FormatViolation. The validator and
 * the bad-message path already sent each version's name; a code a handler or
 * middleware threw went out as thrown.
 */

// The browser client uses the global WebSocket; Node 20 has none.
const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
beforeAll(() => {
  Object.defineProperty(globalThis, "WebSocket", {
    value: WebSocketModule,
    configurable: true,
    writable: true,
  });
});
afterAll(() => {
  if (originalWebSocket) Object.defineProperty(globalThis, "WebSocket", originalWebSocket);
  else Reflect.deleteProperty(globalThis, "WebSocket");
});

type Protocol = "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1";

const servers: OCPPServer[] = [];
const sockets: WebSocketModule[] = [];
const browserClients: BrowserOCPPClient<"ocpp1.6">[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const c of browserClients.splice(0)) await c.close({ force: true }).catch(() => {});
  for (const s of servers.splice(0)) await s.close({ force: true });
});

/** Throws `code` from the handler of Heartbeat, or from middleware for MeterValues. */
async function exchange(protocol: Protocol, code: string, method = "Heartbeat") {
  const server = new OCPPServer({ logging: false, protocols: [protocol] });
  servers.push(server);
  const seenByOutgoingMiddleware: string[] = [];
  server.on("client", (c) => {
    c.use(async (ctx, next) => {
      if (ctx.type === "incoming_call" && ctx.method === "MeterValues") {
        throw createRPCError(code, "thrown by middleware");
      }
      if (ctx.type === "outgoing_error") seenByOutgoingMiddleware.push(ctx.errorCode);
      return next();
    });
    c.handle("Heartbeat", () => {
      throw createRPCError(code, "thrown by the handler", { field: "currentTime" });
    });
  });
  const { port } = (await server.listen(0)).address() as AddressInfo;
  const ws = new WebSocketModule(`ws://localhost:${port}/CP-1`, [protocol]);
  sockets.push(ws);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const reply = new Promise<string>((resolve) =>
    ws.once("message", (d) => resolve(d.toString())),
  );
  ws.send(JSON.stringify([2, "m1", method, {}]));
  return { frame: JSON.parse(await reply), seenByOutgoingMiddleware };
}

describe("the code of a thrown format violation", () => {
  it("is FormationViolation on 1.6, with the error's message and details", async () => {
    const { frame } = await exchange("ocpp1.6", "FormatViolation");
    expect(frame).toEqual([
      4,
      "m1",
      "FormationViolation",
      "thrown by the handler",
      { field: "currentTime" },
    ]);
  });

  it.each(["ocpp2.0.1", "ocpp2.1"] as const)(
    "is FormatViolation on %s when the 1.6 name was thrown",
    async (protocol) => {
      const { frame } = await exchange(protocol, "FormationViolation");
      expect(frame[2]).toBe("FormatViolation");
      expect(frame[3]).toBe("thrown by the handler");
    },
  );

  it.each([
    ["ocpp1.6", "FormationViolation"],
    ["ocpp2.0.1", "FormatViolation"],
    ["ocpp2.1", "FormatViolation"],
  ] as const)("stays %s's own name when that was thrown (%s)", async (protocol, code) => {
    const { frame } = await exchange(protocol, code);
    expect(frame[2]).toBe(code);
  });

  it("leaves 1.6's OccurenceConstraintViolation as thrown (errata §5.1: do not fix)", async () => {
    const { frame } = await exchange("ocpp1.6", "OccurenceConstraintViolation");
    expect(frame[2]).toBe("OccurenceConstraintViolation");
  });

  it("is FormationViolation on 1.6 when incoming middleware throws it", async () => {
    const { frame } = await exchange("ocpp1.6", "FormatViolation", "MeterValues");
    expect(frame[2]).toBe("FormationViolation");
    expect(frame[3]).toBe("thrown by middleware");
  });

  it("is what outgoing_error middleware sees", async () => {
    const { seenByOutgoingMiddleware } = await exchange("ocpp1.6", "FormatViolation");
    expect(seenByOutgoingMiddleware).toEqual(["FormationViolation"]);
  });

  it("is FormationViolation from a 1.6 BrowserOCPPClient", async () => {
    const server = new OCPPServer({ logging: false, protocols: ["ocpp1.6"] });
    servers.push(server);
    let connection: OCPPServerClient<"ocpp1.6"> | undefined;
    server.on("client", (c) => {
      connection = c;
    });
    const { port } = (await server.listen(0)).address() as AddressInfo;
    const client = new BrowserOCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity: "CP-B",
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });
    browserClients.push(client);
    client.handle("Reset", () => {
      throw createRPCError("FormatViolation", "bad reset");
    });
    await client.connect();
    await vi.waitFor(() => expect(connection).toBeDefined());

    await expect(connection?.call("Reset", { type: "Soft" })).rejects.toMatchObject({
      rpcErrorCode: "FormationViolation",
      message: "bad reset",
    });
  });
});
