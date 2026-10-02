import { expectTypeOf } from "vitest";
import { OCPPClient } from "ocpp-ws-io";

/**
 * T3a: under strict actions, a vendor action on a standard version is typed by
 * declaring it once on that version's method map, instead of passing its name
 * through unchecked().
 */
declare module "ocpp-ws-io" {
  interface OCPP16Methods {
    VendorPing: {
      request: { n: number };
      response: { pong: boolean };
    };
  }
}

const endpoint = "ws://localhost:9220";

export async function vendorActionOnStandardVersion() {
  const c16 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });

  const res = await c16.call("VendorPing", { n: 1 });
  expectTypeOf(res).toEqualTypeOf<{ pong: boolean }>();
  c16.handle("VendorPing", ({ params }) => {
    expectTypeOf(params.n).toEqualTypeOf<number>();
    return { pong: true };
  });

  // Checked like a standard action.
  // @ts-expect-error n is a number
  await c16.call("VendorPing", { n: "1" });
  // @ts-expect-error a key the declaration does not define
  c16.handle("VendorPing", () => ({ pong: true, extra: 1 }));
  // @ts-expect-error not declared for 2.0.1
  await new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp2.0.1"] }).call("VendorPing", { n: 1 });
}
