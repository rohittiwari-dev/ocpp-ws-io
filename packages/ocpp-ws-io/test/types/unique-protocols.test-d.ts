import { expectTypeOf } from "vitest";
import { BrowserOCPPClient } from "../../src/browser/client.js";
import { OCPPClient } from "../../src/client/client.js";
import { OCPPServer } from "../../src/server/server.js";
import type { OCPPServerClient } from "../../src/server/server-client.js";
import type { ConnectionOf } from "../../src/types/index.js";

/**
 * T3c (B6): a protocol listed twice is a type error at the repeat, as well as
 * a TypeError at construction. Compiled by `typecheck`; never run.
 */
const endpoint = "ws://localhost:9220";

export function duplicatesAreErrors() {
  new OCPPServer({
    protocols: [
      "ocpp1.6",
      // @ts-expect-error listed more than once
      "ocpp1.6",
    ],
  });
  new OCPPClient({
    identity: "CP1",
    endpoint,
    protocols: [
      "ocpp2.0.1",
      "ocpp1.6",
      // @ts-expect-error listed more than once
      "ocpp2.0.1",
    ],
  });
  new BrowserOCPPClient({
    identity: "CP1",
    endpoint,
    protocols: [
      "ocpp1.6",
      // @ts-expect-error listed more than once
      "ocpp1.6",
    ],
  });
  new OCPPServer({ protocols: ["ocpp1.6", "ocpp2.0.1"] })
    .route("/x")
    .config({
      protocols: [
        "ocpp1.6",
        // @ts-expect-error listed more than once
        "ocpp1.6",
      ],
    });
  new OCPPServer({
    protocols: [
      "vendor-x",
      // @ts-expect-error a custom name counts too
      "vendor-x",
    ],
  });
}

export function everythingElseAsBefore() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6", "ocpp2.0.1"] });
  // The protocols are still inferred from the list.
  csms.on("client", (c) => {
    expectTypeOf(c).toEqualTypeOf<OCPPServerClient<"ocpp1.6" | "ocpp2.0.1">>();
  });
  expectTypeOf<ConnectionOf<typeof csms>>().toEqualTypeOf<
    OCPPServerClient<"ocpp1.6" | "ocpp2.0.1">
  >();
  // An annotation names the protocols only, as before.
  const annotated: OCPPServer<"ocpp1.6" | "ocpp2.0.1"> = csms;
  const plain: OCPPServer = csms;
  // Custom names and lists known only at runtime still compile.
  new OCPPServer({ protocols: ["ocpp1.6", "vendor-x"] });
  const fromConfig: string[] = ["ocpp1.6"];
  new OCPPServer({ protocols: fromConfig });
  const client = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  const heldClient: OCPPClient<"ocpp1.6"> = client;
  const route = csms.route("/v16").config({ protocols: ["ocpp1.6"] });
  expectTypeOf(route).toEqualTypeOf<
    import("../../src/server/router.js").OCPPRouter<"ocpp1.6">
  >();
  return [annotated, plain, heldClient];
}
