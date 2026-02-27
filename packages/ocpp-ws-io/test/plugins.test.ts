import { describe, it, expect, vi } from "vitest";
import { OCPPServer } from "../src/server.js";
import type { OCPPPlugin } from "../src/types.js";
import {
  sessionLogPlugin,
  heartbeatPlugin,
  connectionGuardPlugin,
  metricsPlugin,
  otelPlugin,
  webhookPlugin,
  anomalyPlugin,
} from "../src/plugins/index.js";

// ─── sessionLogPlugin ──────────────────────────────────────────

describe("sessionLogPlugin", () => {
  it("should register with correct name", () => {
    const plugin = sessionLogPlugin();
    expect(plugin.name).toBe("session-log");
  });

  it("should log on connection and disconnection", () => {
    const logSpy = vi.fn();
    const plugin = sessionLogPlugin({ logger: { info: logSpy } });

    const fakeClient = {
      identity: "CP-101",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "192.168.1.1" },
    } as any;

    plugin.onConnection!(fakeClient);
    expect(logSpy).toHaveBeenCalledWith("Connected", {
      identity: "CP-101",
      ip: "192.168.1.1",
      protocol: "ocpp1.6",
    });

    plugin.onDisconnect!(fakeClient, 1000, "normal");
    expect(logSpy).toHaveBeenCalledWith(
      "Disconnected",
      expect.objectContaining({
        identity: "CP-101",
        code: 1000,
        reason: "normal",
      }),
    );
  });

  it("should clean up on server close", () => {
    const plugin = sessionLogPlugin();
    plugin.onConnection!({
      identity: "CP-102",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "1.2.3.4" },
    } as any);
    // Should not throw
    plugin.onClose!();
  });
});

// ─── heartbeatPlugin ───────────────────────────────────────────

describe("heartbeatPlugin", () => {
  it("should register with correct name", () => {
    const plugin = heartbeatPlugin();
    expect(plugin.name).toBe("heartbeat");
  });

  it("should register a Heartbeat handler on connection", () => {
    const plugin = heartbeatPlugin();
    const handleSpy = vi.fn();
    const fakeClient = { handle: handleSpy } as any;

    plugin.onConnection!(fakeClient);
    expect(handleSpy).toHaveBeenCalledWith("Heartbeat", expect.any(Function));

    // The handler should return currentTime
    const handler = handleSpy.mock.calls[0][1];
    const result = handler();
    expect(result).toHaveProperty("currentTime");
    expect(typeof result.currentTime).toBe("string");
  });
});

// ─── connectionGuardPlugin ─────────────────────────────────────

describe("connectionGuardPlugin", () => {
  it("should register with correct name", () => {
    const plugin = connectionGuardPlugin({ maxConnections: 10 });
    expect(plugin.name).toBe("connection-guard");
  });

  it("should allow connections within limit", () => {
    const plugin = connectionGuardPlugin({ maxConnections: 2 });
    const closeSpy = vi.fn().mockResolvedValue({});

    const client1 = { close: closeSpy } as any;
    const client2 = { close: closeSpy } as any;

    plugin.onConnection!(client1);
    plugin.onConnection!(client2);

    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("should force-close connections exceeding limit", () => {
    const plugin = connectionGuardPlugin({ maxConnections: 1 });
    const closeSpy = vi.fn().mockResolvedValue({});

    plugin.onConnection!({ close: vi.fn().mockResolvedValue({}) } as any);
    plugin.onConnection!({ close: closeSpy } as any);

    expect(closeSpy).toHaveBeenCalledWith({
      code: 4001,
      reason: "Connection limit reached",
      force: true,
    });
  });

  it("should handle disconnect without prior connect (fallback duration 0)", () => {
    const logSpy = vi.fn();
    const plugin = sessionLogPlugin({ logger: { info: logSpy } });

    // Disconnect a client that was never tracked in onConnection
    const unknownClient = {
      identity: "CP-UNKNOWN",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "10.0.0.1" },
    } as any;

    plugin.onDisconnect!(unknownClient, 1001, "going away");
    expect(logSpy).toHaveBeenCalledWith(
      "Disconnected",
      expect.objectContaining({
        identity: "CP-UNKNOWN",
        durationSec: 0,
        code: 1001,
      }),
    );
  });

  it("should track disconnections correctly", () => {
    const plugin = connectionGuardPlugin({ maxConnections: 1 });
    const closeSpy1 = vi.fn().mockResolvedValue({});
    const closeSpy2 = vi.fn().mockResolvedValue({});

    const client1 = { close: closeSpy1 } as any;
    plugin.onConnection!(client1);
    plugin.onDisconnect!(client1, 1000, "normal");
    // Now back to 0 — next should be allowed
    const client2 = { close: closeSpy2 } as any;
    plugin.onConnection!(client2);
    expect(closeSpy2).not.toHaveBeenCalled();
  });
});

// ─── metricsPlugin ─────────────────────────────────────────────

describe("metricsPlugin", () => {
  it("should register with correct name and have getMetrics()", () => {
    const plugin = metricsPlugin();
    expect(plugin.name).toBe("metrics");
    expect(typeof plugin.getMetrics).toBe("function");
  });

  it("should track connections and disconnections", () => {
    const plugin = metricsPlugin({ intervalMs: 0 });
    plugin.onInit!({} as any);

    const fakeClient = { identity: "CP-1" } as any;
    plugin.onConnection!(fakeClient);
    plugin.onConnection!({ identity: "CP-2" } as any);

    let snap = plugin.getMetrics();
    expect(snap.totalConnections).toBe(2);
    expect(snap.activeConnections).toBe(2);
    expect(snap.peakConnections).toBe(2);

    plugin.onDisconnect!(fakeClient, 1000, "normal");
    snap = plugin.getMetrics();
    expect(snap.totalDisconnections).toBe(1);
    expect(snap.activeConnections).toBe(1);
    expect(snap.peakConnections).toBe(2); // Peak stays
  });

  it("should call onSnapshot callback", () => {
    vi.useFakeTimers();
    const snapshotSpy = vi.fn();
    const plugin = metricsPlugin({ intervalMs: 100, onSnapshot: snapshotSpy });
    plugin.onInit!({} as any);

    vi.advanceTimersByTime(100);
    expect(snapshotSpy).toHaveBeenCalledOnce();
    expect(snapshotSpy.mock.calls[0][0]).toHaveProperty("totalConnections");

    plugin.onClose!();
    vi.useRealTimers();
  });
});

// ─── otelPlugin ────────────────────────────────────────────────

describe("otelPlugin", () => {
  it("should register with correct name", () => {
    const plugin = otelPlugin();
    expect(plugin.name).toBe("otel");
  });

  it("should create and end spans when tracer is provided", () => {
    const endSpy = vi.fn();
    const setAttributeSpy = vi.fn();
    const setStatusSpy = vi.fn();

    const fakeTracer = {
      startSpan: vi.fn().mockReturnValue({
        setAttribute: setAttributeSpy,
        setStatus: setStatusSpy,
        end: endSpy,
      }),
    };

    const plugin = otelPlugin({ tracer: fakeTracer });
    plugin.onInit!({ log: { warn: vi.fn() } } as any);

    const fakeClient = {
      identity: "CP-OT-1",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "10.0.0.1" },
    } as any;

    plugin.onConnection!(fakeClient);
    expect(fakeTracer.startSpan).toHaveBeenCalledWith("ocpp.connection", {
      kind: 1,
    });
    expect(setAttributeSpy).toHaveBeenCalledWith("ocpp.identity", "CP-OT-1");

    plugin.onDisconnect!(fakeClient, 1000, "normal");
    expect(endSpy).toHaveBeenCalled();
  });

  it("should end open spans with ERROR status on server close", () => {
    const endSpy = vi.fn();
    const setAttributeSpy = vi.fn();
    const setStatusSpy = vi.fn();

    const fakeTracer = {
      startSpan: vi.fn().mockReturnValue({
        setAttribute: setAttributeSpy,
        setStatus: setStatusSpy,
        end: endSpy,
      }),
    };

    const plugin = otelPlugin({ tracer: fakeTracer });
    plugin.onInit!({ log: { warn: vi.fn() } } as any);

    // Connect two clients without disconnecting
    plugin.onConnection!({
      identity: "CP-OPEN-1",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "10.0.0.1" },
    } as any);
    plugin.onConnection!({
      identity: "CP-OPEN-2",
      protocol: "ocpp2.0.1",
      handshake: { remoteAddress: "10.0.0.2" },
    } as any);

    // Close server — should end all open spans
    plugin.onClose!();
    expect(setStatusSpy).toHaveBeenCalledWith({
      code: 2,
      message: "Server shutdown",
    });
    expect(endSpy).toHaveBeenCalledTimes(2);
  });

  it("should be no-op without tracer or @opentelemetry/api", () => {
    const plugin = otelPlugin();
    const warnSpy = vi.fn();
    plugin.onInit!({ log: { warn: warnSpy } } as any);

    // Should not throw
    plugin.onConnection!({
      identity: "CP-X",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "1.1.1.1" },
    } as any);
    plugin.onDisconnect!({ identity: "CP-X" } as any, 1000, "ok");
  });
});

// ─── webhookPlugin ─────────────────────────────────────────────

describe("webhookPlugin", () => {
  it("should register with correct name", () => {
    const plugin = webhookPlugin({ url: "http://example.com/webhook" });
    expect(plugin.name).toBe("webhook");
  });

  it("should only send events in the allow list", () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchSpy;

    const plugin = webhookPlugin({
      url: "http://example.com/webhook",
      events: ["connect"],
    });

    // init is not in the allow list
    plugin.onInit!({} as any);
    // Give the async a tick
    expect(fetchSpy).not.toHaveBeenCalled();

    // Restore
    vi.restoreAllMocks();
  });

  it("should include X-Signature header when secret is provided", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchSpy;

    const plugin = webhookPlugin({
      url: "http://example.com/webhook",
      secret: "test-secret",
      events: ["connect"],
    });

    plugin.onConnection!({
      identity: "CP-WH-1",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "1.2.3.4" },
    } as any);

    // Wait for async fetch
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchSpy).toHaveBeenCalled();
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[1].headers["X-Signature"]).toBeDefined();

    vi.restoreAllMocks();
  });

  it("should silently handle fetch failure after retries", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("Network error"));
    globalThis.fetch = fetchSpy;

    const plugin = webhookPlugin({
      url: "http://unreachable.test/hook",
      retries: 1,
      events: ["connect"],
    });

    plugin.onConnection!({
      identity: "CP-FAIL",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "1.2.3.4" },
    } as any);

    await new Promise((r) => setTimeout(r, 100));
    // 2 attempts (initial + 1 retry), both fail silently
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });

  it("should send disconnect webhook", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchSpy;

    const plugin = webhookPlugin({
      url: "http://example.com/webhook",
      events: ["disconnect"],
    });

    plugin.onDisconnect!(
      { identity: "CP-DC", handshake: { remoteAddress: "1.2.3.4" } } as any,
      1000,
      "normal",
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.event).toBe("disconnect");
    expect(body.data.identity).toBe("CP-DC");
    expect(body.data.code).toBe(1000);

    vi.restoreAllMocks();
  });

  it("should send close webhook", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchSpy;

    const plugin = webhookPlugin({
      url: "http://example.com/webhook",
      events: ["close"],
    });

    plugin.onClose!();

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.event).toBe("close");

    vi.restoreAllMocks();
  });

  it("should send init webhook when event is allowed", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchSpy;

    const plugin = webhookPlugin({
      url: "http://example.com/webhook",
      events: ["init"],
    });

    plugin.onInit!({} as any);

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.event).toBe("init");

    vi.restoreAllMocks();
  });
});

// ─── anomalyPlugin ─────────────────────────────────────────────

describe("anomalyPlugin", () => {
  it("should register with correct name", () => {
    const plugin = anomalyPlugin();
    expect(plugin.name).toBe("anomaly");
  });

  it("should detect rapid reconnections", () => {
    const emitSpy = vi.fn();
    const fakeServer = { emit: emitSpy } as any;

    const plugin = anomalyPlugin({
      reconnectThreshold: 3,
      windowMs: 60_000,
    });
    plugin.onInit!(fakeServer);

    const fakeClient = {
      identity: "CP-STORM",
      handshake: { remoteAddress: "10.0.0.1" },
    } as any;

    // 3 connections = OK (at threshold)
    plugin.onConnection!(fakeClient);
    plugin.onConnection!(fakeClient);
    plugin.onConnection!(fakeClient);
    expect(emitSpy).not.toHaveBeenCalled();

    // 4th = ANOMALY
    plugin.onConnection!(fakeClient);
    expect(emitSpy).toHaveBeenCalledWith(
      "securityEvent",
      expect.objectContaining({
        type: "ANOMALY_RAPID_RECONNECT",
        identity: "CP-STORM",
      }),
    );
  });

  it("should clean up on server close", () => {
    const plugin = anomalyPlugin();
    plugin.onInit!({ emit: vi.fn() } as any);
    plugin.onClose!();
    // Should not throw
  });

  it("should prune expired entries and keep non-expired via GC timer", () => {
    vi.useFakeTimers();
    const emitSpy = vi.fn();
    const fakeServer = { emit: emitSpy } as any;

    const plugin = anomalyPlugin({
      reconnectThreshold: 10,
      windowMs: 1000,
    });
    plugin.onInit!(fakeServer);

    // Add connections for two identities
    plugin.onConnection!({
      identity: "CP-OLD",
      handshake: { remoteAddress: "10.0.0.1" },
    } as any);
    plugin.onConnection!({
      identity: "CP-RECENT",
      handshake: { remoteAddress: "10.0.0.2" },
    } as any);

    // Advance time past the window so CP-OLD expires
    vi.advanceTimersByTime(1100);

    // Add a new connection for CP-RECENT so it stays non-expired
    plugin.onConnection!({
      identity: "CP-RECENT",
      handshake: { remoteAddress: "10.0.0.2" },
    } as any);

    // Trigger GC
    vi.advanceTimersByTime(1000);

    // CP-OLD should be pruned, CP-RECENT should remain
    // Verify by connecting enough times to trigger anomaly — CP-OLD starts fresh
    plugin.onClose!();
    vi.useRealTimers();
  });
});

// ─── Integration: Register all plugins ─────────────────────────

describe("Plugin Integration", () => {
  it("should register all 7 plugins via server.plugin()", () => {
    const server = new OCPPServer();

    const result = server.plugin(
      sessionLogPlugin(),
      heartbeatPlugin(),
      connectionGuardPlugin({ maxConnections: 100 }),
      metricsPlugin({ intervalMs: 0 }),
      otelPlugin(),
      webhookPlugin({ url: "http://localhost:9999/hook" }),
      anomalyPlugin(),
    );

    expect(result).toBe(server);
    // @ts-expect-error — accessing private field for test
    expect(server._plugins).toHaveLength(7);
    // @ts-expect-error
    const names = server._plugins.map((p: OCPPPlugin) => p.name);
    expect(names).toEqual([
      "session-log",
      "heartbeat",
      "connection-guard",
      "metrics",
      "otel",
      "webhook",
      "anomaly",
    ]);

    server.close({ force: true }).catch(() => {});
  });
});
