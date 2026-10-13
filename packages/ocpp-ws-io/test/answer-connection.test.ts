import { once } from "node:events";
import type { AddressInfo } from "node:net";
import WebSocketModule, { type WebSocket, WebSocketServer } from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";

// A call's answer goes on the connection the call came in on. A client that
// reconnected while its handler ran used to send the answer on the new
// connection, under the old call's message ID: an answer to a call that
// connection never made, or, with message IDs counted per connection, the
// answer to a different call (O38).

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

type Frame = [number, string, ...unknown[]];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => {});
});

/** A CSMS on a bare WebSocket server, recording the frames of each connection. */
async function rawCsms() {
  const wss = new WebSocketServer({ port: 0, handleProtocols: () => "ocpp1.6" });
  await once(wss, "listening");
  cleanups.push(async () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  });
  const connections: Array<{ ws: WebSocket; frames: Frame[] }> = [];
  wss.on("connection", (ws) => {
    const connection = { ws, frames: [] as Frame[] };
    connections.push(connection);
    ws.on("message", (data) => connection.frames.push(JSON.parse(String(data)) as Frame));
  });
  const { port } = wss.address() as AddressInfo;
  return { url: `ws://localhost:${port}`, connections };
}

type Station = OCPPClient<"ocpp1.6"> | BrowserOCPPClient<"ocpp1.6">;

function stationOptions(url: string) {
  return {
    endpoint: url,
    identity: "CP-1",
    protocols: ["ocpp1.6"] as ["ocpp1.6"],
    backoffMin: 50,
    backoffMax: 100,
    logging: false as const,
  };
}

/**
 * The charging station gets Reset on connection 1, which drops while its
 * handler runs; once connection 2 is open, the handler settles with
 * `settle`. Returns connection 2's frames after a probe call answered on it:
 * frames on one socket arrive in order, so a stale answer sent when the
 * handler settled would be there before the probe's answer.
 */
async function reconnectWhileHandling(
  createStation: (url: string) => Station,
  settle: (reset: Deferred<{ status: "Accepted" }>) => void,
) {
  const csms = await rawCsms();
  const station = createStation(csms.url);
  cleanups.push(() => station.close({ force: true }));
  const reset = deferred<{ status: "Accepted" }>();
  let handling = false;
  station.handle("Reset", () => {
    handling = true;
    return reset.promise;
  });
  station.handle("GetLocalListVersion", () => ({ listVersion: 7 }));
  const sentIds: string[] = [];
  if (station instanceof OCPPClient) {
    station.on("message", ({ message, direction }) => {
      if (direction === "OUT") sentIds.push(message[1]);
    });
  } else {
    station.on("callResult", (frame) => sentIds.push(frame[1]));
    station.on("callError", (frame) => sentIds.push(frame[1]));
  }
  await station.connect();

  await vi.waitFor(() => expect(csms.connections).toHaveLength(1));
  const first = csms.connections[0];
  first?.ws.send(JSON.stringify([2, "reset-1", "Reset", { type: "Soft" }]));
  await vi.waitFor(() => expect(handling).toBe(true));
  first?.ws.terminate();

  await vi.waitFor(() => expect(csms.connections).toHaveLength(2));
  await vi.waitFor(() => expect(station.state).toBe(1));
  settle(reset);

  const second = csms.connections[1];
  second?.ws.send(JSON.stringify([2, "probe-1", "GetLocalListVersion", {}]));
  await vi.waitFor(() =>
    expect(second?.frames.some((f) => f[1] === "probe-1")).toBe(true),
  );
  return { secondFrames: second?.frames ?? [], sentIds };
}

describe("a call's answer stays on the connection the call came in on", () => {
  test("OCPPClient: a CALLRESULT is not sent on the next connection", async () => {
    const { secondFrames, sentIds } = await reconnectWhileHandling(
      (url) => new OCPPClient(stationOptions(url)),
      (reset) => reset.resolve({ status: "Accepted" }),
    );
    expect(secondFrames.map((f) => f[1])).toEqual(["probe-1"]);
    expect(sentIds).not.toContain("reset-1");
  });

  test("OCPPClient: a CALLERROR is not sent on the next connection", async () => {
    const { secondFrames, sentIds } = await reconnectWhileHandling(
      (url) => new OCPPClient(stationOptions(url)),
      (reset) => reset.reject(new Error("db down")),
    );
    expect(secondFrames.map((f) => f[1])).toEqual(["probe-1"]);
    expect(sentIds).not.toContain("reset-1");
  });

  test("BrowserOCPPClient: the answer is not sent on the next connection", async () => {
    const { secondFrames, sentIds } = await reconnectWhileHandling(
      (url) => new BrowserOCPPClient(stationOptions(url)),
      (reset) => reset.resolve({ status: "Accepted" }),
    );
    expect(secondFrames.map((f) => f[1])).toEqual(["probe-1"]);
    expect(sentIds).not.toContain("reset-1");
  });

  test("an answer still goes out while close() waits on the same, open socket", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    cleanups.push(() => server.close({ force: true }));
    const heartbeat = deferred<{ currentTime: string }>();
    const resetAnswer = deferred<unknown>();
    server.on("client", (connection) => {
      connection.handle("Heartbeat", () => heartbeat.promise);
      connection
        .call("Reset", { type: "Soft" })
        .then(resetAnswer.resolve, resetAnswer.reject);
    });
    const port = ((await server.listen(0)).address() as AddressInfo).port;

    const station = new OCPPClient(stationOptions(`ws://localhost:${port}`));
    cleanups.push(() => station.close({ force: true }));
    const reset = deferred<{ status: "Accepted" }>();
    let resetRunning = false;
    station.handle("Reset", () => {
      resetRunning = true;
      return reset.promise;
    });
    await station.connect();
    await vi.waitFor(() => expect(resetRunning).toBe(true));

    // close() waits for the Heartbeat call's answer (awaitPending), so the
    // socket stays open while the client is CLOSING.
    const call = station.call("Heartbeat", {}).catch(() => {});
    const closing = station.close();
    expect(station.state).toBe(2);
    reset.resolve({ status: "Accepted" });
    await expect(resetAnswer.promise).resolves.toEqual({ status: "Accepted" });

    heartbeat.resolve({ currentTime: "2026-10-14T00:00:00.000Z" });
    await call;
    await closing;
  });

  test("a CSMS counting message IDs per connection gets the right answer", async () => {
    let counter = 0;
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: false,
      idGenerator: () => String(++counter),
    });
    cleanups.push(() => server.close({ force: true }));
    let connections = 0;
    const answer = deferred<unknown>();
    server.on("client", (connection) => {
      counter = 0;
      connections++;
      if (connections === 1) {
        connection.call("Reset", { type: "Soft" }).catch(() => {});
      } else {
        connection
          .call("GetConfiguration", { key: ["HeartbeatInterval"] })
          .then(answer.resolve, answer.reject);
      }
    });
    const port = ((await server.listen(0)).address() as AddressInfo).port;

    const station = new OCPPClient(stationOptions(`ws://localhost:${port}`));
    cleanups.push(() => station.close({ force: true }));
    const reset = deferred<{ status: "Accepted" }>();
    let resetRunning = false;
    station.handle("Reset", () => {
      resetRunning = true;
      return reset.promise;
    });
    const config = {
      configurationKey: [{ key: "HeartbeatInterval", readonly: false, value: "300" }],
    };
    station.handle("GetConfiguration", async () => {
      // Both calls have message ID "1". Let the stale Reset answer go first,
      // then answer this one.
      reset.resolve({ status: "Accepted" });
      await reset.promise;
      await new Promise((r) => setImmediate(r));
      return config;
    });
    await station.connect();

    await vi.waitFor(() => expect(resetRunning).toBe(true));
    const first = server.getLocalClient("CP-1");
    await first?.close({ force: true });

    await expect(answer.promise).resolves.toEqual(config);
  });
});
