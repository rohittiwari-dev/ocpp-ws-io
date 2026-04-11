import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import type { OCPPPlugin, OCPPServerStats } from "../src/types.js";
import type { OCPPServerClient } from "../src/server-client.js";

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

/**
 * Helper: create a server + client pair with a plugin, connect them, and
 * return everything needed for assertions. Caller must close in afterEach.
 */
async function createPair(
  plugin: OCPPPlugin,
  serverOpts: Record<string, any> = {},
) {
  const server = new OCPPServer({
    protocols: ["ocpp1.6"],
    ...serverOpts,
  });
  server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
  server.plugin(plugin);

  const httpServer = await server.listen(0);
  const port = getPort(httpServer);

  const client = new OCPPClient({
    identity: "CP_HOOK_TEST",
    endpoint: `ws://localhost:${port}`,
    protocols: ["ocpp1.6"],
    reconnect: false,
  });

  await client.connect();
  await new Promise((r) => setTimeout(r, 100));

  return { server, client, port };
}

describe("Plugin Hooks — Message Observation", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should call onMessage for inbound CALL", async () => {
    const onMessage = vi.fn();
    const plugin: OCPPPlugin = { name: "msg-obs", onMessage };

    const pair = await createPair(plugin);
    server = pair.server;
    client = pair.client;

    // Register a handler so the server can process the call
    // @ts-expect-error — accessing private _clientsByIdentity
    const sc: OCPPServerClient = server._clientsByIdentity.get("CP_HOOK_TEST");
    sc.handle("BootNotification", () => ({
      status: "Accepted",
      currentTime: new Date().toISOString(),
      interval: 300,
    }));

    await client.call("BootNotification", {
      chargePointVendor: "Test",
      chargePointModel: "T1",
    });
    await new Promise((r) => setTimeout(r, 150));

    // Should have received at least the inbound CALL and outbound CALLRESULT
    expect(onMessage).toHaveBeenCalled();
    const calls = onMessage.mock.calls;
    // At minimum: 1 IN + 1 OUT
    const directions = calls.map((c: any) => c[1]?.direction);
    expect(directions).toContain("IN");
    expect(directions).toContain("OUT");
  });

  it("should include outbound CALLRESULT in onMessage", async () => {
    const messages: any[] = [];
    const plugin: OCPPPlugin = {
      name: "out-obs",
      onMessage: (_c, payload) => {
        messages.push(payload);
      },
    };

    const pair = await createPair(plugin);
    server = pair.server;
    client = pair.client;

    // @ts-expect-error
    const sc: OCPPServerClient = server._clientsByIdentity.get("CP_HOOK_TEST");
    sc.handle("BootNotification", () => ({
      status: "Accepted",
      currentTime: new Date().toISOString(),
      interval: 300,
    }));

    await client.call("BootNotification", {
      chargePointVendor: "Test",
      chargePointModel: "T1",
    });
    await new Promise((r) => setTimeout(r, 150));

    const outMsgs = messages.filter((m) => m.direction === "OUT");
    expect(outMsgs.length).toBeGreaterThanOrEqual(1);
    // The outbound should be a CALLRESULT (message type 3)
    const callResult = outMsgs.find((m) => m.message?.[0] === 3);
    expect(callResult).toBeDefined();
  });

  it("should emit outbound CALLERROR in onMessage when handler throws", async () => {
    const messages: any[] = [];
    const plugin: OCPPPlugin = {
      name: "error-obs",
      onMessage: (_c, payload) => {
        messages.push(payload);
      },
    };

    const pair = await createPair(plugin);
    server = pair.server;
    client = pair.client;

    // @ts-expect-error
    const sc: OCPPServerClient = server._clientsByIdentity.get("CP_HOOK_TEST");
    sc.handle("BootNotification", () => {
      throw new Error("Handler exploded");
    });

    await client
      .call("BootNotification", {
        chargePointVendor: "Test",
        chargePointModel: "T1",
      })
      .catch(() => {}); // Will reject with RPC error
    await new Promise((r) => setTimeout(r, 150));

    const outErrors = messages.filter(
      (m) => m.direction === "OUT" && m.message?.[0] === 4,
    );
    expect(outErrors.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Plugin Hooks — Error & Anomaly", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should call onBadMessage for malformed messages", async () => {
    const onBadMessage = vi.fn();
    const plugin: OCPPPlugin = { name: "bad-msg", onBadMessage };

    const pair = await createPair(plugin);
    server = pair.server;
    client = pair.client;

    // Send raw malformed message
    client.sendRaw("not valid json {{{");
    await new Promise((r) => setTimeout(r, 200));

    expect(onBadMessage).toHaveBeenCalled();
    const [, rawMsg, err] = onBadMessage.mock.calls[0];
    expect(typeof rawMsg).toBe("string");
    expect(err).toBeInstanceOf(Error);
  });

  it("should call onHandlerError when a handler throws", async () => {
    const onHandlerError = vi.fn();
    const plugin: OCPPPlugin = { name: "handler-err", onHandlerError };

    const pair = await createPair(plugin);
    server = pair.server;
    client = pair.client;

    // @ts-expect-error
    const sc: OCPPServerClient = server._clientsByIdentity.get("CP_HOOK_TEST");
    sc.handle("BootNotification", () => {
      throw new Error("boom");
    });

    await client
      .call("BootNotification", {
        chargePointVendor: "Test",
        chargePointModel: "T1",
      })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 200));

    expect(onHandlerError).toHaveBeenCalled();
    const [, method, err] = onHandlerError.mock.calls[0];
    expect(method).toBe("BootNotification");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
  });
});

describe("Plugin Hooks — Interception", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("onBeforeReceive returning false should drop the message", async () => {
    const onMessage = vi.fn();
    let blockCount = 0;

    const plugin: OCPPPlugin = {
      name: "intercept",
      onMessage,
      onBeforeReceive: (_client, _rawData) => {
        blockCount++;
        return false; // Block all inbound messages
      },
    };

    const pair = await createPair(plugin);
    server = pair.server;
    client = pair.client;

    // @ts-expect-error
    const sc: OCPPServerClient = server._clientsByIdentity.get("CP_HOOK_TEST");
    sc.handle("BootNotification", () => ({
      status: "Accepted",
      currentTime: new Date().toISOString(),
      interval: 300,
    }));

    // This call should timeout because the message is blocked
    const callPromise = client.call(
      "BootNotification",
      { chargePointVendor: "Test", chargePointModel: "T1" },
      { timeoutMs: 300 },
    );

    await expect(callPromise).rejects.toThrow(/timed out/i);
    expect(blockCount).toBeGreaterThan(0);
    // onMessage should NOT be called since messages were blocked
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe("Plugin Hooks — Security & Auth", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should call onSecurityEvent and onAuthFailed on auth rejection", async () => {
    const onSecurityEvent = vi.fn();
    const onAuthFailed = vi.fn();
    const plugin: OCPPPlugin = {
      name: "auth-obs",
      onSecurityEvent,
      onAuthFailed,
    };

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.reject(401, "Bad credentials"));
    server.plugin(plugin);

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CP_AUTH_FAIL",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    // Suppress the expected unhandled error event on connect rejection
    client.on("error", () => {});
    await client.connect().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));

    expect(onSecurityEvent).toHaveBeenCalled();
    const secEvt = onSecurityEvent.mock.calls[0][0];
    expect(secEvt.type).toBe("AUTH_FAILED");
    expect(secEvt.identity).toBe("CP_AUTH_FAIL");

    expect(onAuthFailed).toHaveBeenCalled();
    const [, code, reason] = onAuthFailed.mock.calls[0];
    expect(code).toBe(401);
    expect(reason).toBe("Bad credentials");

    await client.close({ force: true }).catch(() => {});
  });
});

describe("Plugin Hooks — Connection Lifecycle", () => {
  let server: OCPPServer;
  let client1: OCPPClient;
  let client2: OCPPClient;

  afterEach(async () => {
    if (client1) await client1.close({ force: true }).catch(() => {});
    if (client2) await client2.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should call onEviction when duplicate identity connects", async () => {
    const onEviction = vi.fn();
    const plugin: OCPPPlugin = { name: "eviction-obs", onEviction };

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    server.plugin(plugin);

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    // First connection
    client1 = new OCPPClient({
      identity: "CP_EVICT",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client1.connect();
    await new Promise((r) => setTimeout(r, 100));

    // Second connection with same identity — should evict first
    client2 = new OCPPClient({
      identity: "CP_EVICT",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client2.connect();
    await new Promise((r) => setTimeout(r, 200));

    expect(onEviction).toHaveBeenCalledOnce();
    const [evictedClient, newClient] = onEviction.mock.calls[0];
    expect(evictedClient.identity).toBe("CP_EVICT");
    expect(newClient.identity).toBe("CP_EVICT");
    // They should be different instances
    expect(evictedClient).not.toBe(newClient);
  });
});

describe("Plugin Hooks — Rate Limiting", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should call onRateLimitExceeded when rate limit is hit", async () => {
    const onRateLimitExceeded = vi.fn();
    const plugin: OCPPPlugin = {
      name: "rl-obs",
      onRateLimitExceeded,
    };

    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      rateLimit: { limit: 2, windowMs: 60000 },
    });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    server.plugin(plugin);

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CP_RATE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 100));

    // @ts-expect-error
    const sc: OCPPServerClient = server._clientsByIdentity.get("CP_RATE");
    sc.handle("Heartbeat", () => ({ currentTime: new Date().toISOString() }));

    // Send 3 messages (limit is 2) — the 3rd should trigger rate limit
    for (let i = 0; i < 5; i++) {
      client.call("Heartbeat", {}, { timeoutMs: 500 }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 500));

    expect(onRateLimitExceeded).toHaveBeenCalled();
  });
});

describe("Plugin Hooks — Configuration & Server Control", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should call onReconfigure when server.reconfigure() is called", async () => {
    const onReconfigure = vi.fn();
    const plugin: OCPPPlugin = { name: "reconfig", onReconfigure };

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.plugin(plugin);
    await server.listen(0);

    server.reconfigure({ callTimeoutMs: 60000 } as any);

    expect(onReconfigure).toHaveBeenCalledOnce();
    const [newOpts, oldOpts] = onReconfigure.mock.calls[0];
    expect(newOpts.callTimeoutMs).toBe(60000);
    expect(oldOpts.callTimeoutMs).toBe(30000); // Default
  });

  it("should call onClosing before onClose during server shutdown", async () => {
    const order: string[] = [];
    const plugin: OCPPPlugin = {
      name: "close-order",
      onClosing: () => {
        order.push("onClosing");
      },
      onClose: () => {
        order.push("onClose");
      },
    };

    server = new OCPPServer();
    server.plugin(plugin);
    await server.listen(0);

    await server.close({ force: true });
    await new Promise((r) => setTimeout(r, 100));

    expect(order).toEqual(["onClosing", "onClose"]);
    server = null as any; // Prevent double-close in afterEach
  });
});

describe("Plugin Hooks — Telemetry", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should call onTelemetry at the configured interval", async () => {
    const onTelemetry = vi.fn();
    const plugin: OCPPPlugin = { name: "telemetry", onTelemetry };

    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      telemetry: { pushIntervalMs: 200 },
    } as any);
    server.plugin(plugin);
    await server.listen(0);

    // Wait for at least 2 telemetry pushes
    await new Promise((r) => setTimeout(r, 550));

    expect(onTelemetry).toHaveBeenCalled();
    expect(onTelemetry.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Verify the stats shape
    const stats: OCPPServerStats = onTelemetry.mock.calls[0][0];
    expect(stats).toHaveProperty("connectedClients");
    expect(stats).toHaveProperty("activeSessions");
    expect(stats).toHaveProperty("uptimeSeconds");
    expect(stats).toHaveProperty("memoryUsage");
    expect(stats).toHaveProperty("cpuUsage");
    expect(stats).toHaveProperty("pid");
  });

  it("should NOT start telemetry if pushIntervalMs is 0", async () => {
    const onTelemetry = vi.fn();
    const plugin: OCPPPlugin = { name: "no-telem", onTelemetry };

    server = new OCPPServer({
      telemetry: { pushIntervalMs: 0 },
    } as any);
    server.plugin(plugin);
    await server.listen(0);

    await new Promise((r) => setTimeout(r, 300));
    expect(onTelemetry).not.toHaveBeenCalled();
  });

  it("should NOT start telemetry if no plugin has onTelemetry", async () => {
    const plugin: OCPPPlugin = { name: "no-handler" };

    server = new OCPPServer({
      telemetry: { pushIntervalMs: 100 },
    } as any);
    server.plugin(plugin);

    // @ts-expect-error — accessing private field
    expect(server._telemetryInterval).toBeNull();
  });
});

describe("Plugin Hooks — Multiple plugins", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should call all plugins' onMessage hooks in registration order", async () => {
    const order: string[] = [];
    const p1: OCPPPlugin = {
      name: "p1",
      onMessage: () => {
        order.push("p1");
      },
    };
    const p2: OCPPPlugin = {
      name: "p2",
      onMessage: () => {
        order.push("p2");
      },
    };

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    server.plugin(p1, p2);

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CP_MULTI",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 100));

    // @ts-expect-error
    const sc = server._clientsByIdentity.get("CP_MULTI");
    if (!sc) {
      throw new Error("Client not found");
    }
    sc.handle("Heartbeat", () => ({ currentTime: new Date().toISOString() }));

    await client.call("Heartbeat", {});
    await new Promise((r) => setTimeout(r, 150));

    // Both plugins should have been called, p1 before p2
    const p1Idx = order.indexOf("p1");
    const p2Idx = order.indexOf("p2");
    expect(p1Idx).toBeGreaterThanOrEqual(0);
    expect(p2Idx).toBeGreaterThanOrEqual(0);
    expect(p1Idx).toBeLessThan(p2Idx);
  });

  it("should continue calling other plugins if one throws", async () => {
    const p2Called = vi.fn();
    const p1: OCPPPlugin = {
      name: "p1-throws",
      onMessage: () => {
        throw new Error("p1 crash");
      },
    };
    const p2: OCPPPlugin = {
      name: "p2-fine",
      onMessage: p2Called,
    };

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    server.plugin(p1, p2);

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CP_ERR_PLUGIN",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 100));

    // @ts-expect-error
    const sc = server._clientsByIdentity.get("CP_ERR_PLUGIN");
    if (!sc) {
      throw new Error("Client not found");
    }
    sc.handle("Heartbeat", () => ({ currentTime: new Date().toISOString() }));

    await client.call("Heartbeat", {});
    await new Promise((r) => setTimeout(r, 150));

    // p2 should still be called even though p1 threw
    expect(p2Called).toHaveBeenCalled();
  });
});
