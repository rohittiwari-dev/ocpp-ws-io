import type { AddressInfo } from "node:net";
import WebSocketModule from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { RPCInternalError } from "../src/core/errors.js";
import { OCPPServer } from "../src/server/server.js";

/**
 * Strict mode: when a handler's own answer fails the schema, the peer gets
 * InternalError with the code's standard text (O33). It used to get the
 * validation error's code and text, which say its request was malformed:
 * OCPP-J's error codes describe the payload received. strictValidationFailure
 * and handlerError keep the schema error.
 */

const STANDARD_INTERNAL_ERROR = new RPCInternalError().rpcErrorMessage;

const servers: OCPPServer[] = [];
const sockets: WebSocketModule[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const s of servers.splice(0)) await s.close({ force: true });
});

async function exchange(protocol: "ocpp1.6" | "ocpp2.0.1", frame: unknown[]) {
  const server = new OCPPServer({ logging: false, protocols: [protocol], strictMode: true });
  servers.push(server);
  const failures: Array<{ message: unknown; error: Error }> = [];
  const handlerErrors: Error[] = [];
  server.on("client", (c) => {
    c.on("strictValidationFailure", (f) => failures.push(f));
    c.on("handlerError", ({ error }) => handlerErrors.push(error));
    // An answer without the required currentTime.
    c.handle(() => ({}));
  });
  const { port } = (await server.listen(0)).address() as AddressInfo;
  const ws = new WebSocketModule(`ws://localhost:${port}/CP-1`, [protocol]);
  sockets.push(ws);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const reply = new Promise<string>((resolve) => ws.once("message", (d) => resolve(d.toString())));
  ws.send(JSON.stringify(frame));
  return { frame: JSON.parse(await reply), failures, handlerErrors };
}

describe("strict mode: our own answer breaks the schema", () => {
  it.each(["ocpp1.6", "ocpp2.0.1"] as const)(
    "%s: the peer gets InternalError with the standard text",
    async (protocol) => {
      const { frame } = await exchange(protocol, [2, "s1", "Heartbeat", {}]);
      expect(frame).toEqual([4, "s1", "InternalError", STANDARD_INTERNAL_ERROR, {}]);
    },
  );

  it("reports the schema error to strictValidationFailure and handlerError", async () => {
    const { failures, handlerErrors } = await exchange("ocpp1.6", [2, "s1", "Heartbeat", {}]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error.message).toMatch(/currentTime/);
    expect(handlerErrors).toHaveLength(1);
    expect(handlerErrors[0]?.message).toMatch(/currentTime/);
    expect((handlerErrors[0]?.cause as { rpcErrorCode?: string }).rpcErrorCode).toBe(
      "OccurenceConstraintViolation",
    );
  });

  it("still answers a request that breaks the schema with the validation code", async () => {
    const { frame } = await exchange("ocpp1.6", [
      2,
      "b1",
      "BootNotification",
      { chargePointVendor: "Acme" },
    ]);
    expect(frame[2]).toBe("OccurenceConstraintViolation");
  });
});
