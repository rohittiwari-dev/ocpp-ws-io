import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocketModule from "ws";
import {
  type AnyBrowserOCPPClient,
  BrowserOCPPClient,
} from "../src/browser/client.js";
import { type AnyOCPPClient, OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";

/**
 * forProtocol(): the same client, typed for the protocol it negotiated, or
 * undefined for any other protocol and before it connects.
 */
describe("forProtocol()", () => {
  const servers: OCPPServer[] = [];
  const clients: Array<AnyOCPPClient | AnyBrowserOCPPClient> = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  /** A CSMS that only speaks 2.0.1. */
  async function start() {
    const server = new OCPPServer({ protocols: ["ocpp2.0.1"], logging: false });
    servers.push(server);
    const http = await server.listen(0);
    return `ws://localhost:${(http.address() as AddressInfo).port}`;
  }

  it("returns the client for the negotiated protocol only", async () => {
    const endpoint = await start();
    const client = new OCPPClient({
      identity: "CP-1",
      endpoint,
      protocols: ["ocpp1.6", "ocpp2.0.1"],
      reconnect: false,
      logging: false,
    });
    clients.push(client);
    expect(client.forProtocol("ocpp2.0.1")).toBeUndefined();

    await client.connect();

    expect(client.protocol).toBe("ocpp2.0.1");
    expect(client.forProtocol("ocpp2.0.1")).toBe(client);
    expect(client.forProtocol("ocpp1.6")).toBeUndefined();
  });

  describe("browser client", () => {
    // The browser client uses the global WebSocket; `ws` stands in for it.
    const original = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
    beforeAll(() => {
      Object.defineProperty(globalThis, "WebSocket", {
        value: WebSocketModule,
        configurable: true,
        writable: true,
      });
    });
    afterAll(() => {
      if (original) Object.defineProperty(globalThis, "WebSocket", original);
      else Reflect.deleteProperty(globalThis, "WebSocket");
    });

    it("returns the client for the negotiated protocol only", async () => {
      const endpoint = await start();
      const client = new BrowserOCPPClient({
        identity: "CP-B",
        endpoint,
        protocols: ["ocpp1.6", "ocpp2.0.1"],
        reconnect: false,
        logging: false,
      });
      clients.push(client);
      expect(client.forProtocol("ocpp2.0.1")).toBeUndefined();

      await client.connect();

      expect(client.forProtocol("ocpp2.0.1")).toBe(client);
      expect(client.forProtocol("ocpp1.6")).toBeUndefined();
    });
  });
});
