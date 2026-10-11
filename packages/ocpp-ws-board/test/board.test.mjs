import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Hono } from "hono";
import { OCPPClient, OCPPServer } from "ocpp-ws-io";
import { OCPPProtocolProxy } from "ocpp-ws-io/proxy";
import { SmartChargingEngine } from "ocpp-ws-io/smart-charge";
import {
  CompressedMemoryStore,
  createAuthLayer,
  createBoard,
  expressAdapter,
} from "../dist/index.js";

const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("Condition did not become true");
};
const jsonRequest = (board, path, body, cookie) =>
  board.app.request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
async function pair(t, protocol = "ocpp1.6", options = {}) {
  const board = createBoard({ auth: { mode: "none" }, ...options });
  const server = new OCPPServer({
    protocols: [protocol],
    logging: false,
    pingIntervalMs: 0,
  });
  server.plugin(board.plugin);
  const http = await server.listen(0);
  const endpoint = `ws://127.0.0.1:${http.address().port}`;
  const client = new OCPPClient({
    endpoint,
    identity: "CP-BOARD",
    protocols: [protocol],
    reconnect: false,
    logging: false,
  });
  t.after(async () => {
    await client.close({ force: true }).catch(() => {});
    await server.close({ force: true });
    board.cleanup();
  });
  await client.connect();
  await waitFor(() => server.getLocalClient("CP-BOARD"));
  await board.plugin.flush();
  return {
    board,
    server,
    client,
    endpoint,
    connection: server.getLocalClient("CP-BOARD"),
  };
}

test("package supports both ESM and CJS entry points", async () => {
  const esm = await import("ocpp-ws-board");
  const cjs = createRequire(import.meta.url)("ocpp-ws-board");
  assert.equal(typeof esm.createBoard, "function");
  assert.equal(typeof cjs.createBoard, "function");
});

for (const protocol of ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"])
  test(`real core traffic, commands, and disconnect: ${protocol}`, async (t) => {
    const { board, client, connection } = await pair(t, protocol);
    connection.handle("Heartbeat", () => ({
      currentTime: new Date().toISOString(),
    }));
    client.handle("TriggerMessage", () => ({ status: "Accepted" }));
    await client.call("Heartbeat", {});
    await board.plugin.flush();
    const messages = await board.store.getMessages();
    assert.ok(
      messages.some(
        (message) => message.type === "CALL" && message.direction === "IN",
      ),
    );
    assert.ok(
      messages.some(
        (message) =>
          message.type === "CALLRESULT" && message.direction === "OUT",
      ),
    );
    assert.ok(messages.every((message) => message.protocol === protocol));
    const response = await jsonRequest(board, "/api/commands", {
      identity: "CP-BOARD",
      protocol,
      method: "TriggerMessage",
      params: { requestedMessage: "Heartbeat" },
      timeoutMs: 1000,
    });
    assert.equal(response.status, 200);
    const command = await response.json();
    assert.equal(command.status, "succeeded");
    assert.equal(command.result.status, "Accepted");
    assert.equal(
      (await (await board.app.request("/api/commands")).json()).length,
      1,
    );
    assert.equal(
      (await jsonRequest(board, "/api/connections/CP-BOARD/disconnect", {}))
        .status,
      200,
    );
    assert.equal(
      (await board.store.getConnection("CP-BOARD")).status,
      "offline",
    );
  });

test("real CALLERROR retains error description and details", async (t) => {
  const { board, client } = await pair(t);
  await assert.rejects(client.call("VendorMissing", {}));
  await board.plugin.flush();
  const message = (await board.store.getMessages()).find(
    (entry) => entry.type === "CALLERROR",
  );
  assert.ok(message.payload.errorCode);
  assert.equal(typeof message.payload.errorDescription, "string");
  assert.equal(typeof message.payload.errorDetails, "object");
});

test("public hook argument compatibility and OCPP 2.1 frame classification", async (t) => {
  const { board, connection } = await pair(t, "ocpp2.1");
  await board.plugin.onError(connection, new Error("socket issue"));
  await board.plugin.onBadMessage(
    connection,
    "bad-json",
    new Error("bad frame"),
  );
  await board.plugin.onValidationFailure(
    connection,
    {},
    new Error("invalid schema"),
  );
  await board.plugin.onHandlerError(
    connection,
    "Heartbeat",
    new Error("handler failed"),
  );
  await board.plugin.onBackpressure(connection, 2048);
  await board.plugin.onTLSUpdate({});
  for (const kind of [5, 6])
    await board.plugin.onMessage(connection, {
      direction: "IN",
      message:
        kind === 5
          ? [5, "r1", "GenericError", "Invalid response", { reason: "test" }]
          : [6, "s1", "NotifyPeriodicEventStream", {}],
      ctx: {
        type: "incoming_call",
        timestamp: new Date().toISOString(),
        messageId: "id",
        method: "NotifyPeriodicEventStream",
        params: {},
      },
    });
  const errors = await board.store.getErrors();
  assert.deepEqual(
    errors.map((error) => error.message),
    ["handler failed", "invalid schema", "bad frame", "socket issue"],
  );
  assert.ok(errors.every((error) => error.identity === "CP-BOARD"));
  assert.equal(
    (await board.store.getSystemEvents()).find(
      (event) => event.type === "BACKPRESSURE",
    ).details.bufferedAmount,
    2048,
  );
  assert.ok(
    (await board.store.getMessages()).some(
      (message) => message.type === "SEND",
    ),
  );
  assert.ok(
    (await board.store.getMessages()).some(
      (message) => message.type === "CALLRESULTERROR",
    ),
  );
});

test("late disconnect of evicted socket does not overwrite replacement", async (t) => {
  const { board, connection, server, endpoint } = await pair(t);
  const replacement = new OCPPClient({
    endpoint,
    identity: "CP-BOARD",
    protocols: ["ocpp1.6"],
    reconnect: false,
    logging: false,
  });
  t.after(() => replacement.close({ force: true }).catch(() => {}));
  await replacement.connect();
  await waitFor(() => server.getLocalClient("CP-BOARD") !== connection);
  board.plugin.onDisconnect(connection, 1000, "old connection");
  await board.plugin.flush();
  assert.equal((await board.store.getConnection("CP-BOARD")).status, "online");
});

test("commands validate input, protocol, offline stations and read-only mode", async (t) => {
  const { board } = await pair(t);
  const good = {
    identity: "CP-BOARD",
    protocol: "ocpp1.6",
    method: "TriggerMessage",
    params: {},
    timeoutMs: 1000,
  };
  for (const body of [
    null,
    {},
    { ...good, params: [] },
    { ...good, timeoutMs: -1 },
    { ...good, method: "bad action" },
  ])
    assert.equal((await jsonRequest(board, "/api/commands", body)).status, 400);
  assert.equal(
    (
      await jsonRequest(board, "/api/commands", {
        ...good,
        protocol: "ocpp2.1",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await jsonRequest(board, "/api/commands", {
        ...good,
        identity: "OFFLINE",
      })
    ).status,
    409,
  );
  const readonly = createBoard({
    auth: { mode: "none" },
    commandsEnabled: false,
  });
  t.after(readonly.cleanup);
  assert.equal(
    (await jsonRequest(readonly, "/api/commands", good)).status,
    403,
  );
  assert.equal(
    (await jsonRequest(board, "/api/connections/OFFLINE/reconnect", {})).status,
    409,
  );
});

test("failed RPC is a recorded failure, not reported as success", async (t) => {
  const { board } = await pair(t);
  const response = await jsonRequest(board, "/api/commands", {
    identity: "CP-BOARD",
    protocol: "ocpp1.6",
    method: "NotImplementedByStation",
    params: {},
    timeoutMs: 1000,
  });
  const command = await response.json();
  assert.equal(command.status, "failed");
  assert.ok(command.error);
});

test("auth is isolated per board, protects reads and writes, and rejects cross-origin mutation", async (t) => {
  const first = createBoard({ auth: { mode: "token", token: "first-secret" } });
  const second = createBoard({
    auth: { mode: "token", token: "second-secret" },
  });
  t.after(() => {
    first.cleanup();
    second.cleanup();
  });
  assert.equal((await first.app.request("/api/connections")).status, 401);
  assert.equal((await jsonRequest(first, "/api/commands", {})).status, 401);
  assert.equal(
    (await jsonRequest(first, "/api/auth/login", { token: "wrong" })).status,
    401,
  );
  const login = await jsonRequest(first, "/api/auth/login", {
    token: "first-secret",
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await first.app.request("/api/connections", { headers: { cookie } }))
      .status,
    200,
  );
  assert.equal(
    (await second.app.request("/api/connections", { headers: { cookie } }))
      .status,
    401,
  );
  assert.equal(
    (
      await first.app.request("/api/auth/logout", {
        method: "POST",
        headers: { origin: "https://other.example", cookie },
      })
    ).status,
    403,
  );
  await jsonRequest(first, "/api/auth/logout", {}, cookie);
  assert.equal(
    (await first.app.request("/api/connections", { headers: { cookie } }))
      .status,
    401,
  );
});

test("expired authentication sessions are rejected", () => {
  const auth = createAuthLayer({ mode: "token", token: "x", sessionTtlMs: -1 });
  assert.equal(auth.getSession(auth.createSession({ name: "test" })), null);
});

test("SSE cancels subscriptions immediately", async (t) => {
  const board = createBoard({ auth: { mode: "none" } });
  t.after(board.cleanup);
  const response = await board.app.request("/api/messages/stream");
  const reader = response.body.getReader();
  await reader.read();
  assert.equal(board.messageBroker.clientCount, 1);
  await reader.cancel();
  assert.equal(board.messageBroker.clientCount, 0);
});

test("prefix-aware HTML, nested routes, assets and API fallbacks", async (t) => {
  const board = createBoard({ basePath: "/ops/board", auth: { mode: "none" } });
  t.after(board.cleanup);
  const app = new Hono();
  app.route("/ops/board", board.app);
  const response = await app.request("/ops/board/connection/view/CP-1");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<base href="\/ops\/board\/">/);
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert.equal(
    (await app.request(`/ops/board/${asset.replace(/^\.\//, "")}`)).status,
    200,
  );
  assert.equal((await app.request("/ops/board/api/not-found")).status, 404);
  assert.equal((await app.request("/ops/board/missing.js")).status, 404);
});

test("Express-compatible adapter accepts POST bodies and cancels SSE", async (t) => {
  const adapter = expressAdapter({ auth: { mode: "token", token: "test" } });
  const http = createServer(adapter.handler);
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(async () => {
    adapter.cleanup();
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  });
  const base = `http://127.0.0.1:${http.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "test" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${base}/api/messages/stream`, {
    headers: { cookie },
  });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await waitFor(() => adapter.messageBroker.clientCount === 0);
});

test("smart-charge binding observes initial sessions, updates, allocations and cleanup", async (t) => {
  const board = createBoard({ auth: { mode: "none" } });
  t.after(board.cleanup);
  const engine = new SmartChargingEngine({
    siteId: "test",
    maxGridPowerKw: 20,
    algorithm: "EQUAL_SHARE",
    dispatcher: async () => {},
  });
  engine.addSession({ transactionId: 1, clientId: "CP-1", connectorId: 1 });
  const detach = board.connectSmartCharge(engine);
  assert.equal(board.store.smartChargeSessions.size, 1);
  engine.optimize();
  assert.ok(board.store.smartChargeSessions.get("1").allocatedKw > 0);
  engine.removeSession(1);
  assert.equal(board.store.smartChargeSessions.size, 0);
  detach();
  assert.equal(board.store.smartChargeConnected, false);
  assert.equal(engine.listenerCount("optimized"), 0);
});

test("proxy middleware and error binding record events without modifying frames", async (t) => {
  const board = createBoard({ auth: { mode: "none" } });
  t.after(board.cleanup);
  const proxy = new OCPPProtocolProxy({
    upstreamEndpoint: "ws://localhost:9999",
    upstreamProtocol: "ocpp2.0.1",
  });
  const detach = board.connectProxy(proxy);
  const message = { type: 2, messageId: "1", action: "Heartbeat", payload: {} };
  const context = {
    identity: "CP-PROXY",
    sourceProtocol: "ocpp1.6",
    targetProtocol: "ocpp2.0.1",
  };
  assert.equal(
    await board.proxyMiddleware(message, context, "upstream", "pre"),
    undefined,
  );
  await board.proxyMiddleware(message, context, "upstream", "post");
  proxy.emit("translationError", new Error("mapping failed"), message, context);
  await waitFor(async () => (await board.store.getProxyEvents()).length === 2);
  assert.equal((await board.store.getProxyEvents())[0].error, "mapping failed");
  detach();
  assert.equal(proxy.listenerCount("translationError"), 0);
});

test("asynchronous storage preserves connection/message/disconnect order", async (t) => {
  class DelayedStore extends CompressedMemoryStore {
    async addConnection(connection) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      await super.addConnection(connection);
    }
  }
  const { board, client } = await pair(t, "ocpp1.6", {
    store: new DelayedStore(),
  });
  await client.close({ force: true });
  await board.plugin.flush();
  assert.equal((await board.store.getConnection("CP-BOARD")).status, "offline");
});

test("telemetry error ratio counts frames once and history does not grow on every read", async () => {
  const store = new CompressedMemoryStore();
  await store.addMessage({
    id: "1",
    identity: "CP",
    direction: "IN",
    type: "CALLERROR",
    method: "Test",
    messageId: "1",
    timestamp: new Date().toISOString(),
    protocol: "ocpp1.6",
    source: "ocpp-ws-io",
  });
  await store.addError({
    id: "2",
    identity: "CP",
    category: "PROTOCOL_ERROR",
    message: "error",
    timestamp: new Date().toISOString(),
  });
  assert.equal((await store.getTelemetry()).errorRate, 100);
  await store.getTelemetry();
  assert.equal((await store.getTelemetryHistory()).length, 1);
});

test("store options can be passed as ring buffer bounds in BoardOptions", async () => {
  const board = createBoard({
    auth: { mode: "none" },
    store: {
      maxMessages: 2,
      maxProxyEvents: 5,
      maxSmartChargeHistory: 3,
    },
  });

  for (let i = 1; i <= 5; i++) {
    await board.store.addMessage({
      id: String(i),
      identity: "CP-1",
      direction: "IN",
      type: "CALL",
      method: "Heartbeat",
      messageId: String(i),
      timestamp: new Date().toISOString(),
      protocol: "ocpp1.6",
      source: "ocpp-ws-io",
    });
  }

  const messages = await board.store.getMessages();
  assert.equal(messages.length, 2, "ring buffer bounds maxMessages to 2");
  assert.equal(messages[0].id, "5");
  assert.equal(messages[1].id, "4");
  board.cleanup();
});
