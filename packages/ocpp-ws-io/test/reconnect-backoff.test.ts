import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import WebSocketModule from "ws";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

/**
 * OCPP-J 2.0.1 / 2.1 §5.3: the first reconnection waits the minimum plus a
 * random value, and every later attempt doubles the back-off and adds a new
 * random value. Here the back-off starts at backoffMin, doubles up to
 * backoffMax, and every wait gets a fresh random addition of up to 25%.
 */

// Node 20 has no global WebSocket; the browser client gets the `ws` one.
const originalWebSocket = Object.getOwnPropertyDescriptor(
  globalThis,
  "WebSocket",
);
beforeAll(() => {
  Object.defineProperty(globalThis, "WebSocket", {
    value: WebSocketModule,
    configurable: true,
    writable: true,
  });
});
afterAll(() => {
  if (originalWebSocket) {
    Object.defineProperty(globalThis, "WebSocket", originalWebSocket);
  } else {
    Reflect.deleteProperty(globalThis, "WebSocket");
  }
});

interface Backoff {
  backoffMin: number;
  backoffMax: number;
}

interface ReconnectEvent {
  attempt: number;
  delay: number;
}

const ATTEMPTS = 6;

describe.each([
  "node",
  "browser",
] as const)("reconnect back-off (%s client)", (kind) => {
  const servers: OCPPServer[] = [];
  const closers: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const close of closers.splice(0)) await close().catch(() => {});
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  /**
   * Connects, then takes the server away so every reconnection fails, and
   * returns the delay of each attempt. `random` stands in for Math.random
   * once the connection is up.
   */
  async function reconnectDelays(
    backoff: Backoff,
    random: () => number,
  ): Promise<number[]> {
    const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    servers.push(server);
    const { port } = (await server.listen(0)).address() as AddressInfo;

    const options = {
      identity: "CP-BACKOFF",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6" as const],
      reconnect: true,
      maxReconnects: ATTEMPTS,
      logging: false as const,
      ...backoff,
    };
    const events: ReconnectEvent[] = [];
    const done = new Promise<void>((resolve) => {
      const onReconnect = (e: ReconnectEvent) => {
        events.push(e);
        if (events.length === ATTEMPTS) resolve();
      };
      if (kind === "node") {
        const client = new OCPPClient({ ...options, pingIntervalMs: 0 });
        closers.push(() => client.close({ force: true }));
        client.on("reconnect", onReconnect);
        void client.connect();
      } else {
        const client = new BrowserOCPPClient(options);
        closers.push(() => client.close({ force: true }));
        client.on("reconnect", onReconnect);
        void client.connect();
      }
    });

    await new Promise<void>((resolve) => {
      server.once("client", () => resolve());
    });
    vi.spyOn(Math, "random").mockImplementation(random);
    await server.close({ force: true });
    await done;

    expect(events.map((e) => e.attempt)).toEqual([1, 2, 3, 4, 5, 6]);
    return events.map((e) => Math.round(e.delay * 1000) / 1000);
  }

  it("waits backoffMin before the first attempt, never less", async () => {
    const delays = await reconnectDelays(
      { backoffMin: 50, backoffMax: 200 },
      () => 0,
    );
    expect(delays).toEqual([50, 100, 200, 200, 200, 200]);
  });

  it("adds a random part to every attempt, the cap included", async () => {
    const delays = await reconnectDelays(
      { backoffMin: 50, backoffMax: 200 },
      () => 0.8,
    );
    expect(delays).toEqual([60, 120, 240, 240, 240, 240]);
  });

  it("adds at most 25%", async () => {
    const delays = await reconnectDelays(
      { backoffMin: 50, backoffMax: 200 },
      () => 0.999999,
    );
    const doubled = [50, 100, 200, 200, 200, 200];
    delays.forEach((d, i) => {
      expect(d).toBeLessThanOrEqual(doubled[i] * 1.25);
    });
  });

  it("keeps drawing a fresh random value once backoffMax is reached", async () => {
    let n = 0;
    const delays = await reconnectDelays(
      { backoffMin: 50, backoffMax: 100 },
      () => (n++ * 0.37) % 1,
    );
    const capped = delays.slice(1);
    for (const d of capped) {
      expect(d).toBeGreaterThanOrEqual(100);
      expect(d).toBeLessThan(125);
    }
    expect(new Set(capped).size).toBe(capped.length);
  });
});
