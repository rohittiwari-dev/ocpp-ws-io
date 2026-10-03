import { expectTypeOf } from "vitest";
import {
  createValidator,
  OCPPClient,
  OCPPServer,
  OCPPServerClient,
  type Validator,
} from "ocpp-ws-io";

/**
 * A custom protocol declared the way the docs and `ocpp generate` do it, by
 * augmenting OCPPMethodMap only. Type-checked in its own program (this
 * folder's tsconfig) because an augmentation is global: it would change the
 * types every other test sees.
 */
interface VendorMethods {
  VendorAction: {
    request: { data: string; priority: number };
    response: { status: "Accepted" | "Rejected" };
  };
}

declare module "ocpp-ws-io" {
  interface OCPPMethodMap {
    "vendor-proto": VendorMethods;
  }
}

export async function vendorProtocol() {
  const client = new OCPPClient({
    endpoint: "ws://localhost:3000",
    identity: "CP001",
    protocols: ["ocpp1.6", "vendor-proto"],
  });

  client.handle("vendor-proto", "VendorAction", ({ params }) => {
    expectTypeOf(params.data).toEqualTypeOf<string>();
    expectTypeOf(params.priority).toEqualTypeOf<number>();
    return { status: "Accepted" as const };
  });

  const res = await client.call("vendor-proto", "VendorAction", {
    data: "hello",
    priority: 1,
  });
  expectTypeOf(res.status).toEqualTypeOf<"Accepted" | "Rejected">();

  // @ts-expect-error priority is a number
  await client.call("vendor-proto", "VendorAction", { data: "x", priority: "1" });
}

/** T2: custom protocols follow the configuration like the OCPP versions. */
export async function mixedWithCustom() {
  const client = new OCPPClient({
    endpoint: "ws://localhost:3000",
    identity: "CP001",
    protocols: ["ocpp2.0.1", "vendor-proto"],
  });
  expectTypeOf(client).toEqualTypeOf<OCPPClient<"ocpp2.0.1" | "vendor-proto">>();

  // The short form offers the custom actions too.
  const res = await client.call("VendorAction", { data: "x", priority: 1 });
  expectTypeOf(res).toEqualTypeOf<{ status: "Accepted" | "Rejected" }>();

  const vendor = client.forProtocol("vendor-proto");
  expectTypeOf(vendor).toEqualTypeOf<OCPPClient<"vendor-proto"> | undefined>();
  vendor?.handle("VendorAction", ({ params }) => {
    expectTypeOf(params.priority).toEqualTypeOf<number>();
    return { status: "Accepted" as const };
  });
  // (A 2.0.1 action on the vendor protocol is still accepted by the untyped
  // fallback until T3 removes it.)

  // A custom protocol without declared types still compiles in the list.
  const undeclared = new OCPPClient({
    endpoint: "ws://localhost:3000",
    identity: "CP002",
    protocols: ["ocpp1.6", "not-declared"],
  });
  await undeclared.call("ocpp1.6", "Heartbeat", {});
}

/** T2b: a server mixing an OCPP version and a custom protocol. */
export async function serverWithCustom() {
  const csms = new OCPPServer({ protocols: ["ocpp2.0.1", "vendor-proto"] });
  csms.on("client", (c) => {
    expectTypeOf(c).toEqualTypeOf<
      OCPPServerClient<"ocpp2.0.1" | "vendor-proto">
    >();
    c.forProtocol("vendor-proto")?.handle("VendorAction", ({ params }) => {
      expectTypeOf(params.data).toEqualTypeOf<string>();
      return { status: "Accepted" as const };
    });
  });

  // A route for the custom protocol only.
  csms
    .route("/vendor/:id")
    .config({ protocols: ["vendor-proto"] })
    .on("client", (c) => {
      expectTypeOf(c).toEqualTypeOf<OCPPServerClient<"vendor-proto">>();
    });

  const res = await csms.sendToClient("CP1", "vendor-proto", "VendorAction", {
    data: "x",
    priority: 1,
  });
  expectTypeOf(res).toEqualTypeOf<
    { status: "Accepted" | "Rejected" } | undefined
  >();
}

/** T4a: strict-mode options for a declared custom protocol. */
export function vendorStrictMode(schemas: { $id: string }[]) {
  const vendor = createValidator("vendor-proto", schemas);
  expectTypeOf(vendor).toEqualTypeOf<Validator<"vendor-proto">>();

  new OCPPServer({
    protocols: ["ocpp2.0.1", "vendor-proto"],
    strictMode: ["vendor-proto"],
    strictModeValidators: [vendor],
    strictModeMethods: ["VendorAction", "BootNotification"],
  });
  new OCPPServer({
    protocols: ["ocpp2.0.1"],
    strictMode: true,
    // @ts-expect-error vendor-proto is declared, but not configured here
    strictModeMethods: ["VendorAction"],
  });
  // @ts-expect-error a validator for a protocol the server does not use
  new OCPPServer({ protocols: ["ocpp2.0.1"], strictMode: true, strictModeValidators: [vendor] });
}
