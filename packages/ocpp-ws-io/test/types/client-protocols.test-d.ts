import { expectTypeOf } from "vitest";
import {
  type AnyBrowserOCPPClient,
  BrowserOCPPClient,
} from "../../src/browser/client.js";
import type { OCPPCallError } from "../../src/browser/types.js";
import { type AnyOCPPClient, OCPPClient } from "../../src/client/client.js";
import type { ClientOptions } from "../../src/types.js";

/**
 * T2: a client is typed for the protocols it is configured with. Compiled by
 * `typecheck` (tsconfig.test.json); never run. A line under @ts-expect-error
 * must not compile.
 */
const endpoint = "ws://localhost:9220";

export async function inferredFromProtocols() {
  const c16 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  expectTypeOf(c16).toEqualTypeOf<OCPPClient<"ocpp1.6">>();
  expectTypeOf(c16.protocol).toEqualTypeOf<"ocpp1.6" | undefined>();

  // A 1.6 answer reads as 1.6 (was the mix of three versions: an error).
  const auth = await c16.call("Authorize", { idTag: "X" });
  expectTypeOf(auth.idTagInfo.status).toEqualTypeOf<
    "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx"
  >();

  c16.handle("Reset", ({ params }) => {
    // @ts-expect-error "Immediate" is 2.0.1; 1.6 has "Hard" | "Soft"
    if (params.type === "Immediate") return { status: "Accepted" as const };
    return { status: "Accepted" as const };
  });

  // @ts-expect-error the version named must be one the client is configured for
  await c16.call("ocpp2.0.1", "Heartbeat", {});
}

export async function defaultsAndCompatibility() {
  // Options built as the plain type, as many projects do.
  const bareOptions: ClientOptions = {
    identity: "CP1",
    endpoint,
    protocols: ["ocpp1.6"],
  };
  // No protocols: the plain type, typed for every known protocol, as before.
  const all: OCPPClient = new OCPPClient({ identity: "CP1", endpoint });
  await all.call("Heartbeat", {});
  const fromBareOptions: OCPPClient = new OCPPClient(bareOptions);
  const fromConfigList: OCPPClient = new OCPPClient({
    identity: "CP1",
    endpoint,
    protocols: ["ocpp1.6"] as string[],
  });
  void [fromBareOptions, fromConfigList];

  // A list only known at runtime: every known protocol.
  const fromConfig: string[] = ["ocpp1.6"];
  const loose = new OCPPClient({ identity: "CP1", endpoint, protocols: fromConfig });
  loose.handle("BootNotification", () => ({
    currentTime: "",
    interval: 300,
    status: "Accepted" as const,
  }));

  // An explicit generic still works, and must agree with the list.
  new OCPPClient<"ocpp1.6">({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  // @ts-expect-error the generic says 1.6, the list says 2.0.1
  new OCPPClient<"ocpp1.6">({ identity: "CP1", endpoint, protocols: ["ocpp2.0.1"] });
}

export function narrowingOneConnection() {
  const mixed = new OCPPClient({
    identity: "CP1",
    endpoint,
    protocols: ["ocpp1.6", "ocpp2.0.1"],
  });
  const c16 = mixed.forProtocol("ocpp1.6");
  expectTypeOf(c16).toEqualTypeOf<OCPPClient<"ocpp1.6"> | undefined>();
  c16?.handle("BootNotification", ({ params }) => {
    expectTypeOf(params.chargePointVendor).toEqualTypeOf<string>();
    return { currentTime: "", interval: 300, status: "Accepted" as const };
  });
  // @ts-expect-error ocpp2.1 is not configured
  mixed.forProtocol("ocpp2.1");
}

export async function browserClient() {
  const b16 = new BrowserOCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  expectTypeOf(b16).toEqualTypeOf<BrowserOCPPClient<"ocpp1.6">>();
  const auth = await b16.call("Authorize", { idTag: "X" });
  expectTypeOf(auth.idTagInfo.status).toEqualTypeOf<
    "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx"
  >();
  const b201 = new BrowserOCPPClient({
    identity: "CP1",
    endpoint,
    protocols: ["ocpp1.6", "ocpp2.0.1"],
  }).forProtocol("ocpp2.0.1");
  expectTypeOf(b201).toEqualTypeOf<BrowserOCPPClient<"ocpp2.0.1"> | undefined>();
}

export function anyClientHoldsEveryConfiguration() {
  const c16 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  const c201 = new OCPPClient({ identity: "CP2", endpoint, protocols: ["ocpp2.0.1"] });
  const held: AnyOCPPClient[] = [c16, c201, new OCPPClient({ identity: "CP3", endpoint })];
  expectTypeOf(held[0].close).toBeFunction();
  // @ts-expect-error typed calls need the client's own type
  held[0].call("Heartbeat", {});

  const b16 = new BrowserOCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  const browsers: AnyBrowserOCPPClient[] = [b16];
  void browsers;
}

export function typedClientFitsThePlainType() {
  // 2.x code that keeps clients as plain OCPPClient still compiles.
  const c16 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  const held: OCPPClient[] = [c16];
  // Not yet the browser client: keep it typed, or use AnyBrowserOCPPClient.
  const b16 = new BrowserOCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  // @ts-expect-error a typed browser client does not fit the plain type
  const browsers: BrowserOCPPClient[] = [b16];
  return [held, browsers];
}

export function browserClientEventsAreTyped() {
  // B19: the browser client's events are typed, as the Node client's are.
  const b16 = new BrowserOCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  b16.on("reconnect", ({ attempt, delay }) => {
    expectTypeOf(attempt).toEqualTypeOf<number>();
    expectTypeOf(delay).toEqualTypeOf<number>();
  });
  b16.once("close", ({ code, reason }) => {
    expectTypeOf(code).toEqualTypeOf<number>();
    expectTypeOf(reason).toEqualTypeOf<string>();
  });
  b16.on("callError", (frame) => {
    expectTypeOf(frame).toEqualTypeOf<OCPPCallError>();
  });
  // @ts-expect-error the error event can carry a DOM Event, not only an Error
  b16.on("error", (err: Error) => void err);
  // @ts-expect-error reconnect is emitted with an object
  b16.emit("reconnect", 1);
  // An event the client does not declare takes any arguments.
  b16.on("custom", (...args) => {
    expectTypeOf(args).toEqualTypeOf<unknown[]>();
  });
}
