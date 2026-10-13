import type { AddressInfo } from "node:net";
import WebSocketModule from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client/client.js";
import { RPCInternalError } from "../src/core/errors.js";
import { OCPPServer } from "../src/server/server.js";
import type { OCPPServerClient } from "../src/server/server-client.js";
import { NOREPLY } from "../src/types/protocol.js";

// A handler's ctx.signal tells it that its answer can no longer be delivered:
// the connection closed (O36), or it ran past handlerTimeoutMs, which then
// answers the call with InternalError (O37).

const STANDARD_INTERNAL_ERROR = new RPCInternalError().rpcErrorMessage;

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

const servers: OCPPServer<"ocpp1.6">[] = [];
const clients: Array<OCPPClient<"ocpp1.6"> | BrowserOCPPClient<"ocpp1.6">> = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close({ force: true }).catch(() => {})));
  await Promise.all(servers.splice(0).map((s) => s.close({ force: true }).catch(() => {})));
});

async function startServer(options: { handlerTimeoutMs?: number } = {}) {
  const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false, ...options });
  servers.push(server);
  let connection: OCPPServerClient<"ocpp1.6"> | undefined;
  server.on("client", (c) => {
    connection = c;
  });
  const port = ((await server.listen(0)).address() as AddressInfo).port;
  const getConnection = async () => {
    await vi.waitFor(() => expect(connection).toBeDefined());
    return connection as OCPPServerClient<"ocpp1.6">;
  };
  return { server, endpoint: `ws://localhost:${port}`, getConnection };
}

async function connectClient(endpoint: string, options: { handlerTimeoutMs?: number } = {}) {
  const client = new OCPPClient({
    endpoint,
    identity: "CP-1",
    protocols: ["ocpp1.6"],
    reconnect: false,
    logging: false,
    ...options,
  });
  clients.push(client);
  await client.connect();
  return client;
}

/** A handler that never settles, keeping its signal. */
function hangingHandler(keep: (signal: AbortSignal) => void) {
  return ({ signal }: { signal: AbortSignal }) => {
    keep(signal);
    return new Promise<never>(() => {});
  };
}

describe("a handler's signal", () => {
  test("aborts when the charging station disconnects while the CSMS's handler runs", async () => {
    const { endpoint, getConnection } = await startServer();
    const client = await connectClient(endpoint);
    let signal: AbortSignal | undefined;
    (await getConnection()).handle("Heartbeat", hangingHandler((s) => (signal = s)));

    client.call("Heartbeat", {}).catch(() => {});
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);

    await client.close({ force: true });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect((signal?.reason as Error).message).toMatch(/^Connection closed \(/);
  });

  test("aborts on the charging station when the CSMS drops the connection", async () => {
    const { endpoint, getConnection } = await startServer();
    const client = await connectClient(endpoint);
    let signal: AbortSignal | undefined;
    client.handle("Reset", hangingHandler((s) => (signal = s)));

    const connection = await getConnection();
    connection.call("Reset", { type: "Soft" }).catch(() => {});
    await vi.waitFor(() => expect(signal).toBeDefined());

    await connection.close({ force: true });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });

  test("aborts in the browser client when the connection drops", async () => {
    const { endpoint, getConnection } = await startServer();
    const client = new BrowserOCPPClient({
      endpoint,
      identity: "CP-B",
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });
    clients.push(client);
    let signal: AbortSignal | undefined;
    client.handle("Reset", hangingHandler((s) => (signal = s)));
    await client.connect();

    const connection = await getConnection();
    connection.call("Reset", { type: "Soft" }).catch(() => {});
    await vi.waitFor(() => expect(signal).toBeDefined());

    await connection.close({ force: true });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });

  test("is not aborted once the handler has answered, not even by a later close", async () => {
    const { endpoint, getConnection } = await startServer();
    const client = await connectClient(endpoint);
    let signal: AbortSignal | undefined;
    (await getConnection()).handle("Heartbeat", (ctx) => {
      signal = ctx.signal;
      return { currentTime: new Date().toISOString() };
    });

    await client.call("Heartbeat", {});
    await client.close({ force: true });
    await vi.waitFor(async () => expect((await getConnection()).state).toBe(3));
    expect(signal?.aborted).toBe(false);
  });
});

describe("handlerTimeoutMs", () => {
  test("is off by default: a slow handler still answers", async () => {
    const { endpoint, getConnection } = await startServer();
    const client = await connectClient(endpoint);
    (await getConnection()).handle("Heartbeat", async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { currentTime: "2026-10-14T00:00:00.000Z" };
    });

    await expect(client.call("Heartbeat", {})).resolves.toEqual({
      currentTime: "2026-10-14T00:00:00.000Z",
    });
  });

  test("answers InternalError once a handler runs past it, aborts its signal and reports handlerError", async () => {
    const { endpoint, getConnection } = await startServer({ handlerTimeoutMs: 100 });
    const client = await connectClient(endpoint);
    const connection = await getConnection();
    let signal: AbortSignal | undefined;
    const handlerErrors: Error[] = [];
    connection.on("handlerError", ({ error }) => handlerErrors.push(error));
    connection.handle("Heartbeat", hangingHandler((s) => (signal = s)));

    await expect(client.call("Heartbeat", {})).rejects.toMatchObject({
      rpcErrorCode: "InternalError",
      message: STANDARD_INTERNAL_ERROR,
    });
    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as Error).name).toBe("TimeoutError");
    expect(handlerErrors.map((e) => e.name)).toEqual(["TimeoutError"]);
  });

  test("drops the result of a handler that settles after it", async () => {
    const { endpoint, getConnection } = await startServer({ handlerTimeoutMs: 100 });
    const client = await connectClient(endpoint);
    const answers: unknown[] = [];
    client.on("message", ({ message, direction }) => {
      if (direction === "IN" && message[0] !== 2) answers.push(message);
    });
    let settled = false;
    (await getConnection()).handle("Heartbeat", async () => {
      await new Promise((r) => setTimeout(r, 400));
      settled = true;
      return { currentTime: "2026-10-14T00:00:00.000Z" };
    });

    await expect(client.call("Heartbeat", {})).rejects.toMatchObject({
      rpcErrorCode: "InternalError",
    });
    await vi.waitFor(() => expect(settled).toBe(true));
    // A reply sent when the handler settled arrives within milliseconds on
    // loopback; 100 ms leaves room for it before counting.
    await new Promise((r) => setTimeout(r, 100));
    expect(answers).toHaveLength(1);
  });

  test("does not touch a handler that answers in time", async () => {
    const { endpoint, getConnection } = await startServer({ handlerTimeoutMs: 200 });
    const client = await connectClient(endpoint);
    let signal: AbortSignal | undefined;
    (await getConnection()).handle("Heartbeat", async (ctx) => {
      signal = ctx.signal;
      await new Promise((r) => setTimeout(r, 50));
      return { currentTime: "2026-10-14T00:00:00.000Z" };
    });

    await expect(client.call("Heartbeat", {})).resolves.toEqual({
      currentTime: "2026-10-14T00:00:00.000Z",
    });
    // Past the 200 ms limit, with room: a timer left running would have
    // aborted the signal by then.
    await new Promise((r) => setTimeout(r, 300));
    expect(signal?.aborted).toBe(false);
  });

  test("sends nothing for a handler that returned NOREPLY in time", async () => {
    const { endpoint, getConnection } = await startServer({ handlerTimeoutMs: 100 });
    const client = await connectClient(endpoint);
    const answers: unknown[] = [];
    client.on("message", ({ message, direction }) => {
      if (direction === "IN" && message[0] !== 2) answers.push(message);
    });
    let signal: AbortSignal | undefined;
    (await getConnection()).handle("Heartbeat", (ctx) => {
      signal = ctx.signal;
      return NOREPLY;
    });

    client.call("Heartbeat", {}, { timeoutMs: 1000 }).catch(() => {});
    await vi.waitFor(() => expect(signal).toBeDefined());
    // Past the 100 ms limit, with room: a timer left running would have
    // aborted the signal by then.
    await new Promise((r) => setTimeout(r, 300));
    expect(answers).toHaveLength(0);
    expect(signal?.aborted).toBe(false);
  });

  test("a connection takes the server's value, and client.reconfigure() changes it", async () => {
    const { endpoint, getConnection } = await startServer({ handlerTimeoutMs: 100 });
    const client = await connectClient(endpoint);
    const connection = await getConnection();
    connection.handle("Heartbeat", async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { currentTime: "2026-10-14T00:00:00.000Z" };
    });

    await expect(client.call("Heartbeat", {})).rejects.toMatchObject({
      rpcErrorCode: "InternalError",
    });
    connection.reconfigure({ handlerTimeoutMs: 0 });
    await expect(client.call("Heartbeat", {})).resolves.toEqual({
      currentTime: "2026-10-14T00:00:00.000Z",
    });
  });

  test("applies on a charging station's OCPPClient", async () => {
    const { endpoint, getConnection } = await startServer();
    const client = await connectClient(endpoint, { handlerTimeoutMs: 100 });
    client.handle("Reset", hangingHandler(() => {}));

    await expect(
      (await getConnection()).call("Reset", { type: "Soft" }),
    ).rejects.toMatchObject({ rpcErrorCode: "InternalError" });
  });

  test("applies on the browser client", async () => {
    const { endpoint, getConnection } = await startServer();
    const client = new BrowserOCPPClient({
      endpoint,
      identity: "CP-B",
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
      handlerTimeoutMs: 100,
    });
    clients.push(client);
    let signal: AbortSignal | undefined;
    client.handle("Reset", hangingHandler((s) => (signal = s)));
    await client.connect();

    await expect(
      (await getConnection()).call("Reset", { type: "Soft" }),
    ).rejects.toMatchObject({
      rpcErrorCode: "InternalError",
      message: STANDARD_INTERNAL_ERROR,
    });
    expect((signal?.reason as Error).name).toBe("TimeoutError");
  });
});
