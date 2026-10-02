import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocketModule from "ws";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";
import type { OCPPServerClient } from "../src/server-client.js";
import type { CallOptions, LoggerLike } from "../src/types.js";

/**
 * `call(method, params, { noReply: true })` (gap G1): a
 * normal CALL that the caller does not wait for. It waits its turn in the
 * callConcurrency queue like any call, resolves with undefined once written,
 * and frees the queue at once. The peer still answers, as OCPP-J requires; that
 * answer is dropped quietly instead of being logged as one for an unknown ID.
 */
describe("call(…, { noReply: true })", () => {
  const servers: OCPPServer[] = [];
  const clients: Array<OCPPClient | BrowserOCPPClient> = [];
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  /** What the charger side received, in order, with the server's answers. */
  async function start(
    handlers: Record<string, (log: string[]) => Promise<object>>,
  ) {
    const log: string[] = [];
    const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    servers.push(server);
    let serverClient: OCPPServerClient | undefined;
    server.on("client", (c) => {
      serverClient = c;
      for (const [method, run] of Object.entries(handlers)) {
        c.handle(method, async () => {
          log.push(`${method} received`);
          const result = await run(log);
          log.push(`${method} answered`);
          return result;
        });
      }
    });
    const http = await server.listen(0);
    const { port } = http.address() as AddressInfo;
    return { port, log, serverClient: () => serverClient };
  }

  function capture() {
    const warnings: string[] = [];
    const logger: LoggerLike = {
      debug() {},
      info() {},
      error() {},
      warn(message) {
        warnings.push(message);
      },
    };
    return { warnings, logging: { logger } };
  }

  async function connect(port: number, logging: { logger: LoggerLike }) {
    const client = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      maxBadMessages: 1,
      logging,
    });
    clients.push(client);
    await client.connect();
    return client;
  }

  const slow = (ms: number) => async () => {
    await sleep(ms);
    return {};
  };

  it("sends a CALL and resolves with undefined before the answer", async () => {
    const { port, log } = await start({ Ping: slow(200) });
    const { logging } = capture();
    const client = await connect(port, logging);

    const started = Date.now();
    const result = await client.call("Ping", { n: 1 }, { noReply: true });

    expect(result).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(150);
    await sleep(50);
    expect(log).toEqual(["Ping received"]);
  });

  it("drops the answer quietly, CALLRESULT or CALLERROR, and stays connected", async () => {
    const { port, log } = await start({
      Ok: slow(20),
      Fails: async () => {
        throw new Error("no");
      },
    });
    const { warnings, logging } = capture();
    const client = await connect(port, logging);

    await client.call("Ok", {}, { noReply: true });
    await client.call("Fails", {}, { noReply: true });
    await client.call("Ok", {}, { noReply: true });
    await sleep(150);

    expect(log.filter((l) => l.endsWith("received"))).toHaveLength(3);
    // With maxBadMessages: 1, an answer counted as a bad message would close
    // the connection; these must neither warn nor close it.
    expect(warnings.filter((w) => w.includes("unknown messageId"))).toEqual([]);
    expect(client.state).toBe(OCPPClient.OPEN);
  });

  it("waits its turn behind a pending call (callConcurrency 1)", async () => {
    const { port, log } = await start({ First: slow(150), Second: slow(0) });
    const client = await connect(port, capture().logging);

    const first = client.call("First", {});
    await client.call("Second", {}, { noReply: true });
    await first;
    await sleep(50); // the frame is written; let the server log it

    expect(log.indexOf("Second received")).toBeGreaterThan(
      log.indexOf("First answered"),
    );
  });

  it("frees the queue once sent, so the next call does not wait for its answer", async () => {
    const { port, log } = await start({ First: slow(200), Second: slow(0) });
    const client = await connect(port, capture().logging);

    await client.call("First", {}, { noReply: true });
    await client.call("Second", {});
    await sleep(250); // until First, still unanswered here, is answered

    expect(log.indexOf("First answered")).toBeGreaterThan(-1);
    expect(log.indexOf("Second received")).toBeLessThan(
      log.indexOf("First answered"),
    );
  });

  it("rejects a call that reuses the ID of a noReply call still awaiting its answer", async () => {
    const { port } = await start({ Ping: slow(200) });
    const client = await connect(port, capture().logging);

    await client.call("Ping", {}, { noReply: true, idempotencyKey: "same" });
    await expect(
      client.call("Ping", {}, { idempotencyKey: "same" }),
    ).rejects.toThrow('Message ID "same" is already in use');
  });

  it("refuses retries, since there is no answer to retry on", async () => {
    const { port } = await start({ Ping: slow(0) });
    const client = await connect(port, capture().logging);
    const options: CallOptions & { noReply: true } = {
      noReply: true,
      retries: 2,
    };

    await expect(client.call("Ping", {}, options)).rejects.toThrow(
      "noReply cannot be combined with retries",
    );
  });

  it("treats an answer arriving after timeoutMs as unknown again", async () => {
    const { port } = await start({ Ping: slow(200) });
    const { warnings, logging } = capture();
    const client = await connect(port, logging);

    await client.call("Ping", {}, { noReply: true, timeoutMs: 50 });
    await sleep(300);

    expect(
      warnings.filter((w) => w.includes("unknown messageId")),
    ).toHaveLength(1);
  });

  it("works from the CSMS: a server-side client calls the charger", async () => {
    const { port, serverClient } = await start({});
    const { warnings, logging } = capture();
    const client = await connect(port, logging);
    const received: string[] = [];
    client.handle("Reset", async () => {
      received.push("Reset");
      await sleep(30);
      return { status: "Accepted" };
    });
    await sleep(20);
    const charger = serverClient();
    if (!charger) throw new Error("the charger did not reach the server");

    const result = await charger.call(
      "Reset",
      { type: "Soft" },
      { noReply: true },
    );
    await sleep(100);

    expect(result).toBeUndefined();
    expect(received).toEqual(["Reset"]);
    expect(warnings).toEqual([]);
  });

  describe("browser client", () => {
    // The browser client uses the global WebSocket; `ws` stands in for it.
    // Swapped through the property descriptor, so no cast between the two
    // WebSocket types is needed.
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

    it("sends, resolves with undefined, and drops the answer quietly", async () => {
      const { port, log } = await start({ Ping: slow(50) });
      const { warnings, logging } = capture();
      const client = new BrowserOCPPClient({
        identity: "CP-B",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
        logging,
      });
      clients.push(client);
      await client.connect();

      const result = await client.call("Ping", {}, { noReply: true });
      await sleep(150);

      expect(result).toBeUndefined();
      expect(log).toEqual(["Ping received", "Ping answered"]);
      expect(
        warnings.filter((w) => w.includes("unknown messageId")),
      ).toEqual([]);
    });
  });
});
