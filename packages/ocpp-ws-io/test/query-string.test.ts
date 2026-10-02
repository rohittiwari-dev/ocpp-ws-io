import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocketModule from "ws";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

/**
 * `query` as a string (gap G6): the client options take the connection URL's
 * query as an object or a string, as ocpp-rpc does. Either way it is added
 * after any query the endpoint has, and the identity stays the last path
 * segment.
 */
describe("ClientOptions.query as a string", () => {
  const servers: OCPPServer[] = [];
  const clients: Array<OCPPClient | BrowserOCPPClient> = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  /** What the CSMS sees of each handshake: identity and query. */
  async function start() {
    const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    servers.push(server);
    const seen: Array<{ identity: string; query: string }> = [];
    server.auth((ctx) => {
      seen.push({
        identity: ctx.handshake.identity,
        query: ctx.handshake.query.toString(),
      });
      ctx.accept();
    });
    const http = await server.listen(0);
    const { port } = http.address() as AddressInfo;
    return { base: `ws://localhost:${port}`, seen };
  }

  async function connect(endpoint: string, query: string) {
    const client = new OCPPClient({
      identity: "CP 1",
      endpoint,
      query,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });
    clients.push(client);
    await client.connect();
  }

  it("sends a query string as given, with or without a leading ?", async () => {
    const { base, seen } = await start();

    await connect(base, "token=abc&tag=a&tag=b");
    await connect(base, "?token=abc");

    expect(seen).toEqual([
      { identity: "CP 1", query: "token=abc&tag=a&tag=b" },
      { identity: "CP 1", query: "token=abc" },
    ]);
  });

  it("adds a query string after the endpoint's own query", async () => {
    const { base, seen } = await start();

    await connect(`${base}/ocpp?site=north`, "token=abc");

    expect(seen).toEqual([
      { identity: "CP 1", query: "site=north&token=abc" },
    ]);
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

    it("sends a query string as given", async () => {
      const { base, seen } = await start();
      const client = new BrowserOCPPClient({
        identity: "CP 1",
        endpoint: base,
        query: "?token=abc",
        protocols: ["ocpp1.6"],
        reconnect: false,
        logging: false,
      });
      clients.push(client);
      await client.connect();

      expect(seen).toEqual([{ identity: "CP 1", query: "token=abc" }]);
    });
  });
});
