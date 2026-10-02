import { expectTypeOf } from "vitest";
import { OCPPClient } from "ocpp-ws-io";

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
