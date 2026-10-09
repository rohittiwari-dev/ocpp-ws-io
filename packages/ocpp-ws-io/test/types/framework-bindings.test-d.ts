import { expectTypeOf } from "vitest";
import type { OcppExpressContext } from "../../src/frameworks/express/types.js";
import type { OcppFastifyContext } from "../../src/frameworks/fastify/types.js";
import type { OcppHonoContext } from "../../src/frameworks/hono/types.js";
import type { OcppService } from "../../src/frameworks/nestjs/ocpp.service.js";
import type { JsonObject, OCPPResponseType } from "../../src/types.js";
import { unchecked } from "../../src/core/unchecked.js";

/**
 * T5d (D13): the framework bindings send as a plain OCPPServer does: known
 * actions of the declared protocols with exact payloads, unchecked() for the
 * rest. The base context (Fastify, Hono) and the NestJS service copy the
 * server's overloads, so each form is checked on them; the Express context
 * takes the server's own method types. Compiled by `typecheck`; never run.
 */
type Reset16 = OCPPResponseType<"ocpp1.6", "Reset"> | undefined;
type ResetAny = OCPPResponseType<"ocpp1.6" | "ocpp2.0.1" | "ocpp2.1", "Reset">;

export async function baseContext(ocpp: OcppFastifyContext) {
  // Every form the server has.
  expectTypeOf(
    await ocpp.sendToClient("CP1", "Reset", { type: "Soft" }),
  ).toEqualTypeOf<ResetAny | undefined>();
  expectTypeOf(
    await ocpp.sendToClient("CP1", "ocpp1.6", "Reset", { type: "Soft" }),
  ).toEqualTypeOf<Reset16>();
  expectTypeOf(
    await ocpp.sendToClient("CP1", "Reset", { type: "Soft" }, { timeoutMs: 1 }),
  ).toEqualTypeOf<ResetAny | undefined>();
  expectTypeOf(
    await ocpp.sendToClient("CP1", unchecked("VendorPing"), {}),
  ).toEqualTypeOf<JsonObject | undefined>();
  expectTypeOf(
    await ocpp.sendToClient("CP1", "vendor-proto", unchecked("Ping")),
  ).toEqualTypeOf<JsonObject | undefined>();
  expectTypeOf(
    await ocpp.safeSendToClient("CP1", "ocpp1.6", "Reset", { type: "Soft" }),
  ).toEqualTypeOf<Reset16>();
  void ocpp.safeSendToClient("CP1", unchecked("VendorPing"), {});

  // No untyped fallback.
  // @ts-expect-error no such action
  void ocpp.sendToClient("CP1", "Rest", {});
  // @ts-expect-error no such action
  void ocpp.safeSendToClient("CP1", "Rest", {});
  // @ts-expect-error a key the schema does not define
  void ocpp.sendToClient("CP1", "ocpp1.6", "Reset", { type: "Soft", x: 1 });
  // @ts-expect-error a type argument no longer names the response
  void ocpp.sendToClient<{ ok: true }>("CP1", "Reset", { type: "Soft" });
}

export async function hono(ocpp: OcppHonoContext) {
  expectTypeOf(
    await ocpp.sendToClient("CP1", "ocpp1.6", "Reset", { type: "Soft" }),
  ).toEqualTypeOf<Reset16>();
  // @ts-expect-error no such action
  void ocpp.sendToClient("CP1", "Rest", {});
}

export async function nest(ocpp: OcppService) {
  expectTypeOf(
    await ocpp.sendToClient("CP1", "Reset", { type: "Soft" }),
  ).toEqualTypeOf<ResetAny | undefined>();
  expectTypeOf(
    await ocpp.sendToClient("CP1", "ocpp1.6", "Reset", { type: "Soft" }),
  ).toEqualTypeOf<Reset16>();
  expectTypeOf(
    await ocpp.sendToClient("CP1", "Reset", { type: "Soft" }, { timeoutMs: 1 }),
  ).toEqualTypeOf<ResetAny | undefined>();
  expectTypeOf(
    await ocpp.sendToClient("CP1", unchecked("VendorPing"), {}),
  ).toEqualTypeOf<JsonObject | undefined>();
  expectTypeOf(
    await ocpp.sendToClient("CP1", "vendor-proto", unchecked("Ping")),
  ).toEqualTypeOf<JsonObject | undefined>();
  expectTypeOf(
    await ocpp.safeSendToClient("CP1", "ocpp1.6", "Reset", { type: "Soft" }),
  ).toEqualTypeOf<Reset16>();
  void ocpp.safeSendToClient("CP1", unchecked("VendorPing"), {});

  // @ts-expect-error no such action
  void ocpp.sendToClient("CP1", "Rest", {});
  // @ts-expect-error no such action
  void ocpp.safeSendToClient("CP1", "Rest", {});
  // @ts-expect-error a key the schema does not define
  void ocpp.sendToClient("CP1", "ocpp1.6", "Reset", { type: "Soft", x: 1 });
  // @ts-expect-error a type argument no longer names the response
  void ocpp.sendToClient<{ ok: true }>("CP1", "Reset", { type: "Soft" });
}

export async function express(ocpp: OcppExpressContext) {
  expectTypeOf(
    await ocpp.sendToClient("CP1", "ocpp1.6", "Reset", { type: "Soft" }),
  ).toEqualTypeOf<Reset16>();
  // @ts-expect-error no such action
  void ocpp.sendToClient("CP1", "Rest", {});
  // @ts-expect-error no such action
  void ocpp.safeSendToClient("CP1", "Rest", {});
  void ocpp.sendToClient("CP1", unchecked("VendorPing"), {});
}
