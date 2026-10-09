import { expectTypeOf } from "vitest";
import { OCPPServer } from "../../src/server/server.js";
import type { JsonObject } from "../../src/types.js";
import { NOREPLY } from "../../src/types.js";
import { unchecked } from "../../src/core/unchecked.js";

/**
 * T3b: on the server, sendToClient, safeSendToClient, broadcast,
 * broadcastBatch, sendBatch and route handlers take only the actions the
 * server's protocols define, with exact params and responses; unchecked() is
 * the explicit way to use any other. Compiled by `typecheck`; never run.
 */

export async function sendToClient() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });

  const res = await csms.sendToClient("CP1", "Reset", { type: "Hard" });
  expectTypeOf(res).toEqualTypeOf<{ status: "Accepted" | "Rejected" } | undefined>();
  await csms.sendToClient("CP1", "ocpp1.6", "Reset", { type: "Hard" });
  await csms.sendToClient("CP1", "Reset", { type: "Hard" }, { timeoutMs: 1000 });

  // @ts-expect-error no such action
  await csms.sendToClient("CP1", "Rest", { type: "Hard" });
  // @ts-expect-error a 2.0.1 action on a 1.6 server
  await csms.sendToClient("CP1", "TransactionEvent", {});
  // @ts-expect-error Reset needs a type
  await csms.sendToClient("CP1", "Reset", {});
  const extra = { type: "Hard" as const, bogus: 1 };
  // @ts-expect-error a key 1.6 does not define
  await csms.sendToClient("CP1", "Reset", extra);
  // @ts-expect-error the version-named form too
  await csms.sendToClient("CP1", "ocpp1.6", "Reset", extra);
  // @ts-expect-error a type argument names the action now
  await csms.sendToClient<{ status: string }>("CP1", "Reset", { type: "Hard" });

  const vendor = await csms.sendToClient("CP1", unchecked("VendorPing"), { n: 1 });
  expectTypeOf(vendor).toEqualTypeOf<JsonObject | undefined>();
  await csms.sendToClient("CP1", "ocpp1.6", unchecked("VendorPing"), {});
  // @ts-expect-error not one of the server's protocols
  await csms.sendToClient("CP1", "ocpp2.0.1", unchecked("VendorPing"), {});

  // safeSendToClient: the same checks.
  // @ts-expect-error no such action
  await csms.safeSendToClient("CP1", "Rest", { type: "Hard" });
  // @ts-expect-error a key 1.6 does not define
  await csms.safeSendToClient("CP1", "Reset", extra);
  await csms.safeSendToClient("CP1", unchecked("VendorPing"), {});
}

export async function broadcasts() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });
  await csms.broadcast("Reset", { type: "Soft" });
  await csms.broadcastBatch(["CP1", "CP2"], "Reset", { type: "Soft" });
  await csms.broadcast(unchecked("VendorPing"), { n: 1 });
  const extra = { type: "Soft" as const, bogus: 1 };
  // @ts-expect-error no such action
  await csms.broadcast("Rest", { type: "Soft" });
  // @ts-expect-error a key 1.6 does not define
  await csms.broadcast("Reset", extra);
  // @ts-expect-error a key 1.6 does not define
  await csms.broadcastBatch(["CP1"], "Reset", extra);
}

export async function sendBatch() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });
  const results = await csms.sendBatch("CP1", [
    { method: "GetConfiguration", params: { key: ["MeterInterval"] } },
    { method: "ChangeAvailability", params: { connectorId: 0, type: "Operative" } },
    { method: unchecked("VendorPing"), params: { n: 1 } },
  ]);
  expectTypeOf(results).toBeArray();

  await csms.sendBatch("CP1", [
    // @ts-expect-error no such action
    { method: "GetConfig", params: {} },
  ]);
  await csms.sendBatch("CP1", [
    // @ts-expect-error ChangeAvailability needs connectorId and type
    { method: "ChangeAvailability", params: {} },
  ]);
  const extra = { method: "Reset" as const, params: { type: "Hard" as const, bogus: 1 } };
  // @ts-expect-error a key 1.6 does not define, from a variable
  await csms.sendBatch("CP1", [extra]);
}

export function routeHandlers() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });
  const route = csms.route("/ocpp/:id");

  route.handle("Heartbeat", () => ({ currentTime: "" }));
  route.handle("ocpp1.6", "Heartbeat", () => ({ currentTime: "" }));
  // B8: NOREPLY is a typed answer on a route too.
  route.handle("Heartbeat", () => NOREPLY);
  route.handle("Heartbeat", async () => (Math.random() > 0.5 ? { currentTime: "" } : NOREPLY));
  route.handle("Heartbeat", async () => NOREPLY);
  route.handle("StatusNotification", async () => ({}));
  route.handle("Heartbeat", () => new Promise((resolve) => resolve({ currentTime: "" })));

  // @ts-expect-error no such action
  route.handle("Hartbeat", () => ({ currentTime: "" }));
  // @ts-expect-error a response needs its required fields
  route.handle("Heartbeat", () => ({}));
  // @ts-expect-error a key 1.6 does not define
  route.handle("Heartbeat", () => ({ currentTime: "", bogus: 1 }));
  // @ts-expect-error async too
  route.handle("Heartbeat", async () => ({ currentTime: "", bogus: 1 }));

  route.handle(unchecked("VendorPing"), ({ params }) => {
    expectTypeOf(params).toEqualTypeOf<JsonObject>();
    return { pong: true };
  });
  route.handle("ocpp1.6", unchecked("VendorPing"), () => ({}));

  // B8: typed SEND handlers on an OCPP 2.1 route.
  const v21 = new OCPPServer({ protocols: ["ocpp2.1"] }).route("/v21/:id");
  v21.handle("NotifyPeriodicEventStream", ({ params }) => {
    expectTypeOf(params.id).toEqualTypeOf<number>();
  });
  v21.handle("ocpp2.1", "NotifyPeriodicEventStream", () => {});
}
