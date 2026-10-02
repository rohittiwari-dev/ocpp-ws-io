import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocketModule from "ws";
import {
  type AnyBrowserOCPPClient,
  BrowserOCPPClient,
} from "../src/browser/client.js";
import { type AnyOCPPClient, OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";
import type { OCPPServerClient } from "../src/server-client.js";
import type { ClientOptions } from "../src/types.js";
import { unchecked } from "../src/unchecked.js";

/**
 * The client's `closing` event (gap G5): emitted when close() starts shutting
 * the client down, before it waits for pending calls, and followed by `close`
 * once the socket has closed; no reconnect follows. A close the CSMS starts
 * gives `disconnect` and then `close` or `reconnect`, as before, not `closing`.
 */
describe("client closing event", () => {
  const servers: OCPPServer[] = [];
  const clients: Array<AnyOCPPClient | AnyBrowserOCPPClient> = [];
  const STATE = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  /** A server whose `Slow` handler answers only once released. */
  async function start() {
    const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    servers.push(server);
    let release = () => {};
    const released = new Promise<void>((r) => {
      release = r;
    });
    const connected = new Promise<OCPPServerClient>((resolve) => {
      server.on("client", (c) => {
        c.handle(unchecked("Slow"), async () => {
          await released;
          return {};
        });
        resolve(c);
      });
    });
    const http = await server.listen(0);
    const { port } = http.address() as AddressInfo;
    return { server, port, connected, release };
  }

  async function connect(port: number, options: Partial<ClientOptions> = {}) {
    const client = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
      ...options,
    });
    clients.push(client);
    await client.connect();
    return client;
  }

  /** Lifecycle events in order; `closing` records the state it sees. */
  function record(client: OCPPClient) {
    const events: string[] = [];
    client.on("closing", () => events.push(`closing ${STATE[client.state]}`));
    client.on("close", () => events.push("close"));
    client.on("disconnect", () => events.push("disconnect"));
    client.on("reconnect", () => events.push("reconnect"));
    return events;
  }

  it("close() emits closing at once, and close after pending calls settle", async () => {
    const { port, release } = await start();
    const client = await connect(port);
    const events = record(client);
    const pending = client.call(unchecked("Slow"), {});

    const closed = client.close();
    expect(events).toEqual(["closing CLOSING"]);

    release();
    await pending;
    await closed;
    expect(events).toEqual(["closing CLOSING", "close"]);
  });

  it("emits closing once per close, and not for a client already closed", async () => {
    const { port } = await start();
    const client = await connect(port);
    const events = record(client);

    await Promise.all([client.close(), client.close()]);
    await client.close();

    expect(events).toEqual(["closing CLOSING", "close"]);
  });

  it("a close the CSMS starts gives disconnect and close, not closing", async () => {
    const { port, connected } = await start();
    const client = await connect(port);
    const events = record(client);
    const closed = new Promise<void>((r) => client.once("close", () => r()));

    await (await connected).close();
    await closed;

    expect(events).toEqual(["disconnect", "close"]);
  });

  it("close() while waiting to reconnect emits closing, then close", async () => {
    const { port, connected } = await start();
    const client = await connect(port, { reconnect: true, backoffMin: 60_000 });
    const events = record(client);
    const waiting = new Promise<void>((r) => client.once("reconnect", () => r()));
    await (await connected).close();
    await waiting;

    await client.close();

    expect(events).toEqual([
      "disconnect",
      "reconnect",
      "closing CLOSING",
      "close",
    ]);
  });

  it("the server's connection to a charger emits closing when the server closes", async () => {
    const { server, port, connected } = await start();
    await connect(port);
    const charger = await connected;
    const events: string[] = [];
    charger.on("closing", () => events.push("closing"));
    charger.on("close", () => events.push("close"));

    await server.close();

    expect(events).toEqual(["closing", "close"]);
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

    it("close() emits closing at once, and close after pending calls settle", async () => {
      const { port, release } = await start();
      const client = new BrowserOCPPClient({
        identity: "CP-B",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
        logging: false,
      });
      clients.push(client);
      await client.connect();
      const events: string[] = [];
      client.on("closing", () => events.push(`closing ${STATE[client.state]}`));
      client.on("close", () => events.push("close"));
      const pending = client.call(unchecked("Slow"), {});

      const closed = client.close();
      expect(events).toEqual(["closing CLOSING"]);

      release();
      await pending;
      await closed;
      expect(events).toEqual(["closing CLOSING", "close"]);
    });
  });
});
