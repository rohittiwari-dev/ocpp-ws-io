import type { AddressInfo } from "node:net";
import WebSocketModule from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";
import type { OCPPServerClient } from "../src/server/server-client.js";

/**
 * close() with awaitPending, the default, waits for the answers to the calls
 * the peer made, not only for this side's calls (O32). A CSMS shutting down
 * dropped the answers to the chargers' requests its handlers were working on.
 */

// The browser client uses the global WebSocket; Node 20 has none.
const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
beforeAll(() => {
  Object.defineProperty(globalThis, "WebSocket", {
    value: WebSocketModule,
    configurable: true,
    writable: true,
  });
});
afterAll(() => {
  if (originalWebSocket) Object.defineProperty(globalThis, "WebSocket", originalWebSocket);
  else Reflect.deleteProperty(globalThis, "WebSocket");
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const HEARTBEAT = { currentTime: "2026-10-14T00:00:00.000Z" };

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => {});
});

async function startServer() {
  const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
  cleanups.push(() => server.close({ force: true }));
  let connection: OCPPServerClient<"ocpp1.6"> | undefined;
  server.on("client", (c) => {
    connection = c;
  });
  const { port } = (await server.listen(0)).address() as AddressInfo;
  const getConnection = async () => {
    await vi.waitFor(() => expect(connection).toBeDefined());
    return connection as OCPPServerClient<"ocpp1.6">;
  };
  return { server, endpoint: `ws://localhost:${port}`, getConnection };
}

async function connectStation(endpoint: string) {
  const station = new OCPPClient({
    endpoint,
    identity: "CP-1",
    protocols: ["ocpp1.6"],
    reconnect: false,
    logging: false,
  });
  cleanups.push(() => station.close({ force: true }));
  await station.connect();
  return station;
}

describe("close() waits for the answers to the peer's calls", () => {
  it("server.close(): a charger's call that a handler is working on is answered", async () => {
    const { server, endpoint, getConnection } = await startServer();
    const station = await connectStation(endpoint);
    const answer = deferred<typeof HEARTBEAT>();
    let handling = false;
    (await getConnection()).handle("Heartbeat", () => {
      handling = true;
      return answer.promise;
    });

    const call = station.call("Heartbeat", {});
    await vi.waitFor(() => expect(handling).toBe(true));
    const closing = server.close();
    answer.resolve(HEARTBEAT);

    await expect(call).resolves.toEqual(HEARTBEAT);
    await closing;
  });

  it("OCPPClient.close(): the CSMS's call that a handler is working on is answered", async () => {
    const { endpoint, getConnection } = await startServer();
    const station = await connectStation(endpoint);
    const answer = deferred<{ status: "Accepted" }>();
    let handling = false;
    station.handle("Reset", () => {
      handling = true;
      return answer.promise;
    });

    const call = (await getConnection()).call("Reset", { type: "Soft" });
    await vi.waitFor(() => expect(handling).toBe(true));
    const closing = station.close();
    answer.resolve({ status: "Accepted" });

    await expect(call).resolves.toEqual({ status: "Accepted" });
    await closing;
  });

  it("BrowserOCPPClient.close(): the CSMS's call that a handler is working on is answered", async () => {
    const { endpoint, getConnection } = await startServer();
    const station = new BrowserOCPPClient({
      endpoint,
      identity: "CP-B",
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });
    cleanups.push(() => station.close({ force: true }));
    const answer = deferred<{ status: "Accepted" }>();
    let handling = false;
    station.handle("Reset", () => {
      handling = true;
      return answer.promise;
    });
    await station.connect();

    const call = (await getConnection()).call("Reset", { type: "Soft" });
    await vi.waitFor(() => expect(handling).toBe(true));
    const closing = station.close();
    answer.resolve({ status: "Accepted" });

    await expect(call).resolves.toEqual({ status: "Accepted" });
    await closing;
  });

  it("stops waiting for a handler that never settles after callTimeoutMs", async () => {
    const { endpoint, getConnection } = await startServer();
    const station = new OCPPClient({
      endpoint,
      identity: "CP-1",
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
      callTimeoutMs: 200,
    });
    cleanups.push(() => station.close({ force: true }));
    await station.connect();
    let signal: AbortSignal | undefined;
    station.handle("Reset", (ctx) => {
      signal = ctx.signal;
      return new Promise<never>(() => {});
    });

    const call = (await getConnection()).call("Reset", { type: "Soft" });
    // Attached before close(), which rejects the call while it runs.
    const unanswered = expect(call).rejects.toThrow(/Connection closed/);
    await vi.waitFor(() => expect(signal).toBeDefined());
    const started = Date.now();
    await station.close();

    // It waited for the answer (about 200 ms), then closed anyway.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    await unanswered;
    expect(signal?.aborted).toBe(true);
  });

  it("close({ awaitPending: false }) does not wait: the call goes unanswered", async () => {
    const { endpoint, getConnection } = await startServer();
    const station = await connectStation(endpoint);
    let handling = false;
    station.handle("Reset", () => {
      handling = true;
      return new Promise<never>(() => {});
    });

    const call = (await getConnection()).call("Reset", { type: "Soft" });
    // Attached before close(), which rejects the call while it runs.
    const unanswered = expect(call).rejects.toThrow(/Connection closed/);
    await vi.waitFor(() => expect(handling).toBe(true));
    await station.close({ awaitPending: false });

    await unanswered;
  });

  it("close({ force: true }) does not wait, and aborts the handler's signal", async () => {
    const { endpoint, getConnection } = await startServer();
    const station = await connectStation(endpoint);
    let signal: AbortSignal | undefined;
    station.handle("Reset", (ctx) => {
      signal = ctx.signal;
      return new Promise<never>(() => {});
    });

    const call = (await getConnection()).call("Reset", { type: "Soft" });
    // Attached before close(), which rejects the call while it runs.
    const unanswered = expect(call).rejects.toThrow(/Connection closed/);
    await vi.waitFor(() => expect(signal).toBeDefined());
    await station.close({ force: true });

    await unanswered;
    expect(signal?.aborted).toBe(true);
  });
});
