import { expectTypeOf } from "vitest";
import { BrowserOCPPClient } from "../../src/browser/client.js";
import { OCPPClient } from "../../src/client.js";
import { OCPPServer } from "../../src/server.js";
import type { ExactKeys, JsonObject } from "../../src/types.js";
import { NOREPLY } from "../../src/types.js";
import { unchecked } from "../../src/unchecked.js";

/**
 * T3a: on clients and connections, typed methods take only the actions their
 * protocols define, with their exact params and responses; `unchecked()` is
 * the explicit way to use any other. Compiled by `typecheck`; never run. A
 * line under @ts-expect-error must not compile.
 */
const endpoint = "ws://localhost:9220";

export async function strictActions() {
  const c16 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });

  // G1: an action of another version.
  // @ts-expect-error TransactionEvent is 2.0.1, not 1.6
  await c16.call("TransactionEvent", { eventType: "Started" });
  // G2: a typo.
  // @ts-expect-error no such action
  await c16.call("BootNotifcation", { chargePointVendor: "V", chargePointModel: "M" });
  // G3: SEND exists only in OCPP 2.1.
  // @ts-expect-error a 1.6 client has no SEND messages
  await c16.send("NotifyPeriodicEventStream", { id: 1, pending: 0, basetime: "", data: [] });
  // G4: wrong params for a known action.
  // @ts-expect-error Heartbeat takes no params
  await c16.call("Heartbeat", { bogus: 1 });
  // @ts-expect-error a response needs its required fields
  c16.handle("Heartbeat", () => ({}));
  // @ts-expect-error same with safeCall
  await c16.safeCall("BootNotifcation", {});
  // @ts-expect-error same with the version named
  await c16.call("ocpp1.6", "BootNotifcation", {});

  // Correct calls and handlers still compile.
  const hb = await c16.call("Heartbeat", {});
  expectTypeOf(hb.currentTime).toEqualTypeOf<string>();
  c16.handle("Heartbeat", () => ({ currentTime: "" }));
  c16.handle("ocpp1.6", "Heartbeat", () => NOREPLY);
  await c16.call("Heartbeat", {}, { noReply: true });

  // removeHandler names a known action, or an unchecked one.
  c16.removeHandler("Heartbeat");
  c16.removeHandler("ocpp1.6", "Heartbeat");
  c16.removeHandler();
  // @ts-expect-error no such action
  c16.removeHandler("Heartbet");

  // An explicit type argument is the action now; the response comes from it.
  // @ts-expect-error the response type is no longer passed
  await c16.call<{ status: string }>("BootNotification", { chargePointVendor: "V", chargePointModel: "M" });
}

export async function uncheckedActions() {
  const c16 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });

  const pong = await c16.call(unchecked("VendorPing"), { n: 1 });
  expectTypeOf(pong).toEqualTypeOf<JsonObject>();
  const typed = await c16.call<{ pong: boolean }>(unchecked("VendorPing"), {});
  expectTypeOf(typed).toEqualTypeOf<{ pong: boolean }>();
  await c16.call(unchecked("VendorPing"), {}, { noReply: true });
  await c16.call("ocpp1.6", unchecked("VendorPing"), {});
  const safe = await c16.safeCall(unchecked("VendorPing"), {});
  expectTypeOf(safe).toEqualTypeOf<JsonObject | undefined>();
  await c16.send(unchecked("VendorEvent"), { at: 1 });
  // A known action with a payload that is wrong on purpose.
  await c16.call(unchecked("BootNotification"), {});

  c16.handle(unchecked("VendorPing"), ({ params }) => {
    expectTypeOf(params).toEqualTypeOf<JsonObject>();
    return { pong: true };
  });
  c16.handle("ocpp1.6", unchecked("VendorPing"), () => NOREPLY);
  // @ts-expect-error a CALL is answered with an object
  c16.handle(unchecked("VendorPing"), () => undefined);
  c16.removeHandler(unchecked("VendorPing"));
  c16.removeHandler("ocpp1.6", unchecked("VendorPing"));
}

export async function versionsMustBeConfigured() {
  const mixed = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6", "vendor-x"] });
  await mixed.call("vendor-x", unchecked("Ping"), {});
  mixed.handle("vendor-x", unchecked("Ping"), () => ({}));
  // @ts-expect-error "ocpp16" (a typo) is not one of its protocols
  await mixed.call("ocpp16", unchecked("Ping"), {});
  // @ts-expect-error an action the types do not know needs unchecked()
  await mixed.call("vendor-x", "Ping", {});
  // @ts-expect-error same for handlers
  mixed.handle("vendor-x", "Ping", () => ({}));

  // A client without protocols takes any version name, as before.
  const plain = new OCPPClient({ identity: "CP1", endpoint });
  await plain.call("anything", unchecked("Ping"), {});
  // ...but still only known actions without unchecked().
  // @ts-expect-error no such action in any version
  await plain.call("Pingg", {});
}

export async function browserClient() {
  const b16 = new BrowserOCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  // @ts-expect-error no such action
  await b16.call("BootNotifcation", {});
  // @ts-expect-error a 1.6 client has no SEND messages
  await b16.send("NotifyPeriodicEventStream", { id: 1, pending: 0, basetime: "", data: [] });
  // @ts-expect-error a response needs its required fields
  b16.handle("Heartbeat", () => ({}));
  const pong = await b16.call(unchecked("VendorPing"), {});
  expectTypeOf(pong).toEqualTypeOf<JsonObject>();
  b16.handle(unchecked("VendorPing"), () => ({ pong: true }));
  await b16.send(unchecked("VendorEvent"), {});
  b16.removeHandler(unchecked("VendorPing"));
  // @ts-expect-error no such action
  b16.removeHandler("Heartbet");
}

export function serverConnections() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });
  csms.on("client", async (client) => {
    // @ts-expect-error a response needs its required fields
    client.handle("BootNotification", () => ({}));
    // @ts-expect-error same through forProtocol
    client.forProtocol("ocpp1.6")?.handle("BootNotification", () => ({}));
    // @ts-expect-error Reset takes a type
    await client.call("Reset", {});
    client.handle(unchecked("VendorPing"), () => ({ pong: true }));
    await client.call(unchecked("VendorPing"), {});
  });
}

export async function exactKeys() {
  const c16 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  const c201 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp2.0.1"] });
  const mixed = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6", "ocpp2.0.1"] });
  const boot = { currentTime: "", interval: 300, status: "Accepted" as const };

  // @ts-expect-error statusInfo is 2.0.1, not 1.6
  c16.handle("BootNotification", () => ({ ...boot, statusInfo: { reasonCode: "x" } }));
  const extra = { ...boot, bogus: 1 };
  // @ts-expect-error from a variable as well
  c16.handle("BootNotification", () => extra);
  // @ts-expect-error in an async handler
  c16.handle("BootNotification", async () => ({ ...boot, bogus: 1 }));
  // @ts-expect-error at any depth
  c16.handle("Authorize", () => ({ idTagInfo: { status: "Accepted", nope: true } }));
  // @ts-expect-error the version-named form too
  c16.handle("ocpp1.6", "Heartbeat", () => ({ currentTime: "", bogus: 1 }));
  c16.handle("Authorize", () => ({ idTagInfo: { status: "Accepted" } }));

  const req = { chargePointVendor: "V", chargePointModel: "M", bogus: 1 };
  // @ts-expect-error params from a variable
  await c16.call("BootNotification", req);
  // @ts-expect-error params written in place
  await c16.call("BootNotification", { chargePointVendor: "V", chargePointModel: "M", bogus: 1 });
  // @ts-expect-error safeCall too
  await c16.safeCall("BootNotification", req);
  // @ts-expect-error the version-named call too
  await c16.call("ocpp1.6", "BootNotification", req, { timeoutMs: 1000 });

  // 2.0.1 leaves customData open, and DataTransfer's data takes any JSON.
  c201.handle("BootNotification", () => ({
    ...boot,
    customData: { vendorId: "v", anything: [1, { deep: true }] },
  }));
  await c201.call("DataTransfer", { vendorId: "v", data: { any: ["json", 1, null] } });
  // @ts-expect-error a nested key 2.0.1 does not define
  c201.handle("BootNotification", () => ({ ...boot, statusInfo: { reasonCode: "x", nope: 1 } }));

  // On a client of several versions, a key either version defines.
  mixed.handle("BootNotification", () => ({ ...boot, statusInfo: { reasonCode: "x" } }));
  // @ts-expect-error a key neither version defines
  mixed.handle("BootNotification", () => ({ ...boot, bogus: 1 }));

  // unchecked() opts out.
  c16.handle(unchecked("BootNotification"), () => ({ anything: 1 }));
  await c16.call(unchecked("BootNotification"), { anything: 1 });

  // The error names the extra keys, with their paths.
  expectTypeOf<ExactKeys<{ a: string }, { a: string }>>().toEqualTypeOf<unknown>();
  expectTypeOf<
    ExactKeys<{ a: string; n?: { x: string } }, { a: string; b: number; n: { x: string; y: 1 } }>
  >().toEqualTypeOf<{
    readonly "Error: keys not defined by the OCPP schema": "b" | "n.y";
  }>();

  // The browser client checks the same way.
  const b16 = new BrowserOCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  // @ts-expect-error a key 1.6 does not define
  b16.handle("Heartbeat", () => ({ currentTime: "", bogus: 1 }));
  // @ts-expect-error params too
  await b16.call("BootNotification", req);
  // NOREPLY is a typed answer on the browser client too (B7).
  b16.handle("Heartbeat", () => NOREPLY);
}

export function emptyResponses() {
  // 1.6 StatusNotification answers an empty object; any value fits {}, a
  // promise included, so an async handler must still type-check, and an extra
  // key in it must still fail.
  const c16 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  c16.handle("StatusNotification", () => ({}));
  c16.handle("StatusNotification", async () => ({}));
  c16.handle("ocpp1.6", "StatusNotification", async () => ({}));
  c16.handle("StatusNotification", () => new Promise((resolve) => resolve({})));
  // @ts-expect-error a key the empty response does not define
  c16.handle("StatusNotification", async () => ({ bogus: 1 }));
  // @ts-expect-error the same, returned directly
  c16.handle("StatusNotification", () => ({ bogus: 1 }));
}
