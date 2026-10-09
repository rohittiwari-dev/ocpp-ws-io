import { expectTypeOf } from "vitest";
import {
  OCPPClient,
  OCPPServer,
  type CallOptions,
  type OCPPServerClient,
  unchecked,
} from "ocpp-ws-io";
import {
  BrowserOCPPClient,
  unchecked as browserUnchecked,
} from "ocpp-ws-io/browser";

// This fixture uses package exports, never source paths. Run after building.
declare module "ocpp-ws-io" {
  interface OCPPMethodMap {
    "frontend-v1": {
      ReadLog: {
        request: { id: string };
        response: { message: string };
      };
    };
  }
  interface OCPPSendMethodMap {
    "frontend-v1": {
      ChargerLog: { request: { message: string } };
    };
  }
}

export async function sharedFrontendEvents() {
  const options = {
    identity: "admin",
    endpoint: "ws://localhost:9220",
    protocols: ["frontend-v1"] as const,
  };
  const node = new OCPPClient(options);
  const browser = new BrowserOCPPClient(options);
  expectTypeOf(await node.call("ReadLog", { id: "1" }))
    .toEqualTypeOf<{ message: string }>();
  expectTypeOf(await browser.call("ReadLog", { id: "1" }))
    .toEqualTypeOf<{ message: string }>();
  await node.send("ChargerLog", { message: "connected" });
  await browser.send("ChargerLog", { message: "connected" });
  browser.handle("ChargerLog", ({ params }) => {
    expectTypeOf(params).toEqualTypeOf<{ message: string }>();
  });
  browser.handle("ReadLog", ({ params }) => {
    expectTypeOf(params).toEqualTypeOf<{ id: string }>();
    return { message: params.id };
  });
  // @ts-expect-error the custom event still checks its payload
  await browser.send("ChargerLog", { message: 42 });
  // @ts-expect-error a custom request still checks its payload
  await browser.call("ReadLog", { id: 42 });
  // @ts-expect-error no such frontend event
  await browser.send("ChargerLogTypo", { message: "connected" });

  // Helpers imported from either public entry point share one brand.
  await node.call(browserUnchecked("VendorLog"), { message: "connected" });
  await browser.call(unchecked("VendorLog"), { message: "connected" });
}

export function roleBasedConnections() {
  const clients = new Map<string, OCPPServerClient>();
  const server = new OCPPServer({ protocols: ["ocpp1.6", "frontend-v1"] });
  server.on("client", (client: OCPPServerClient) => {
    if (client.session.role === "ADMIN") clients.set(client.identity, client);
  });
  clients.forEach((client) => {
    void client.send("ChargerLog", { message: "connected" });
    // @ts-expect-error a broad client still checks the declared event payload
    void client.send("ChargerLog", { message: 42 });
  });
}

export function publishedPayloadsAndOptions(options?: CallOptions) {
  const settings = {
    identity: "cp",
    endpoint: "ws://localhost:9220",
    protocols: ["ocpp1.6"] as const,
  };
  const node = new OCPPClient(settings);
  const browser = new BrowserOCPPClient(settings);
  for (const client of [node, browser]) {
    expectTypeOf(client.call("Heartbeat", {}, options))
      .toEqualTypeOf<Promise<{ currentTime: string }>>();
    expectTypeOf(client.call("Heartbeat", {}, { noReply: true }))
      .toEqualTypeOf<Promise<void>>();
    client.handle("StatusNotification", async () => ({}));
    // @ts-expect-error empty requests must be objects in the built declarations
    void client.call("Heartbeat", 42);
    // @ts-expect-error empty responses must be objects in the built declarations
    client.handle("StatusNotification", () => 42);
    // @ts-expect-error asynchronous responses obey the same restriction
    client.handle("StatusNotification", async () => 42);
  }
}
