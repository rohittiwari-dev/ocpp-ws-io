import { expectTypeOf } from "vitest";
import { OCPPClient } from "../../src/client/client.js";
import { OCPPServer } from "../../src/server/server.js";
import { unchecked } from "../../src/core/unchecked.js";
import { createValidator, type Validator } from "../../src/core/validation/validator.js";

/**
 * T4a (D8): strict-mode options name only what the server, route or client is
 * configured with. A validator, a strictMode entry or a strictModeMethods
 * action for anything else compiled and did nothing.
 */
declare const schemas: { $id: string }[];
const endpoint = "ws://localhost:9220";

export function validatorsKeepTheirProtocol() {
  const vendor = createValidator("vendor-x", schemas);
  expectTypeOf(vendor).toEqualTypeOf<Validator<"vendor-x">>();
  expectTypeOf(vendor.subprotocol).toEqualTypeOf<"vendor-x">();

  // A name known only at runtime stays a string.
  const name: string = "vendor-y";
  expectTypeOf(createValidator(name, schemas)).toEqualTypeOf<Validator<string>>();
}

export function serverOptions() {
  const vendor = createValidator("vendor-x", schemas);

  // B15: a configured custom protocol can be listed in strictMode.
  new OCPPServer({
    protocols: ["ocpp1.6", "vendor-x"],
    strictMode: ["vendor-x"],
    strictModeValidators: [vendor],
  });
  new OCPPServer({
    protocols: ["ocpp1.6"],
    strictMode: true,
    strictModeMethods: ["BootNotification", unchecked("VendorPing")],
  });

  // @ts-expect-error a validator for a protocol the server does not use
  new OCPPServer({ protocols: ["ocpp1.6"], strictMode: true, strictModeValidators: [vendor] });
  // @ts-expect-error strict mode for a version the server does not use
  new OCPPServer({ protocols: ["ocpp1.6"], strictMode: ["ocpp2.0.1"] });
  // @ts-expect-error an action of another version
  new OCPPServer({ protocols: ["ocpp1.6"], strictMode: true, strictModeMethods: ["TransactionEvent"] });

  // The lists do not widen the server's protocols.
  const server = new OCPPServer({ protocols: ["ocpp1.6"], strictMode: ["ocpp1.6"] });
  expectTypeOf(server).toEqualTypeOf<OCPPServer<"ocpp1.6", readonly ["ocpp1.6"]>>();

  // A protocol list known only at runtime takes any name.
  const protocols: string[] = ["ocpp1.6"];
  new OCPPServer({ protocols, strictMode: ["vendor-z"], strictModeValidators: [vendor] });
}

export function clientOptions() {
  const vendor = createValidator("vendor-x", schemas);

  new OCPPClient({
    identity: "CP1",
    endpoint,
    protocols: ["ocpp1.6", "vendor-x"],
    strictMode: ["vendor-x"],
    strictModeValidators: [vendor],
  });
  // OCPP 2.1 SEND messages are validated too, so they can be listed.
  new OCPPClient({
    identity: "CP1",
    endpoint,
    protocols: ["ocpp2.1"],
    strictMode: true,
    strictModeMethods: ["NotifyPeriodicEventStream", "BootNotification"],
  });

  new OCPPClient({
    identity: "CP1",
    endpoint,
    protocols: ["ocpp1.6"],
    strictMode: true,
    // @ts-expect-error a validator for a protocol the client does not use
    strictModeValidators: [vendor],
  });
  new OCPPClient({
    identity: "CP1",
    endpoint,
    protocols: ["ocpp1.6"],
    // @ts-expect-error strict mode for a version the client does not use
    strictMode: ["ocpp2.0.1"],
  });
  new OCPPClient({
    identity: "CP1",
    endpoint,
    protocols: ["ocpp1.6"],
    strictMode: true,
    // @ts-expect-error an action of another version
    strictModeMethods: ["TransactionEvent"],
  });
}

export function routeOptions() {
  const server = new OCPPServer({ protocols: ["ocpp1.6", "ocpp2.0.1"] });
  server.route("/a").config({
    protocols: ["ocpp2.0.1"],
    strictMode: ["ocpp2.0.1"],
    strictModeMethods: ["TransactionEvent"],
  });
  server.route("/b").config({
    protocols: ["ocpp2.0.1"],
    // @ts-expect-error the route speaks 2.0.1 only
    strictMode: ["ocpp1.6"],
  });
  server.route("/c").config({
    protocols: ["ocpp2.0.1"],
    strictMode: true,
    // @ts-expect-error a 1.6 action on a 2.0.1 route
    strictModeMethods: ["DiagnosticsStatusNotification"],
  });
}
