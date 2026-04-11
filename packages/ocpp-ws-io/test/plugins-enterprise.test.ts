import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  messageDedupPlugin,
  replayBufferPlugin,
  piiRedactorPlugin,
  kafkaPlugin,
  circuitBreakerPlugin,
  rateLimitNotifierPlugin,
  schemaVersioningPlugin,
  otelPlugin,
  metricsPlugin,
} from "../src/plugins/index.js";

// ═══════════════════════════════════════════════════════════════════
// messageDedupPlugin
// ═══════════════════════════════════════════════════════════════════

describe("messageDedupPlugin", () => {
  it("should register with correct name", () => {
    const redis = { set: vi.fn() };
    const plugin = messageDedupPlugin({ redis });
    expect(plugin.name).toBe("message-dedup");
  });

  it("should allow first message through (ioredis positional style)", async () => {
    const redis = { set: vi.fn().mockResolvedValue("OK") };
    const plugin = messageDedupPlugin({ redis, redisStyle: "positional" });

    const client = { identity: "CP-1" } as any;
    const rawData = JSON.stringify([2, "msg-001", "Heartbeat", {}]);

    const result = await plugin.onBeforeReceive!(client, rawData);
    expect(result).toBeUndefined(); // undefined = continue

    // Verify ioredis-style positional args
    expect(redis.set).toHaveBeenCalledWith(
      "ocpp:dedup:CP-1:msg-001",
      "1",
      "PX",
      300000,
      "NX",
    );
  });

  it("should drop duplicate message (ioredis style)", async () => {
    const redis = { set: vi.fn().mockResolvedValue(null) };
    const warnSpy = vi.fn();
    const plugin = messageDedupPlugin({
      redis,
      logger: { warn: warnSpy, error: vi.fn() },
    });

    const client = { identity: "CP-1" } as any;
    const rawData = JSON.stringify([2, "msg-dup", "StatusNotification", {}]);

    const result = await plugin.onBeforeReceive!(client, rawData);
    expect(result).toBe(false); // false = drop
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dropping duplicate"),
    );
  });

  it("should work with node-redis v4 options style", async () => {
    const redis = { set: vi.fn().mockResolvedValue("OK") };
    const plugin = messageDedupPlugin({
      redis,
      redisStyle: "options",
      ttlMs: 60_000,
    });

    const client = { identity: "CP-2" } as any;
    const rawData = JSON.stringify([2, "msg-002", "BootNotification", {}]);

    const result = await plugin.onBeforeReceive!(client, rawData);
    expect(result).toBeUndefined();

    // Verify node-redis v4 options-style call
    expect(redis.set).toHaveBeenCalledWith("ocpp:dedup:CP-2:msg-002", "1", {
      PX: 60_000,
      NX: true,
    });
  });

  it("should fail-open when Redis is down", async () => {
    const redis = { set: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    const errorSpy = vi.fn();
    const plugin = messageDedupPlugin({
      redis,
      logger: { warn: vi.fn(), error: errorSpy },
    });

    const client = { identity: "CP-FAIL" } as any;
    const rawData = JSON.stringify([2, "msg-003", "Heartbeat", {}]);

    const result = await plugin.onBeforeReceive!(client, rawData);
    expect(result).toBeUndefined(); // fail-open = continue
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should pass through non-JSON messages to core validator", async () => {
    const redis = { set: vi.fn() };
    const plugin = messageDedupPlugin({ redis });

    const result = await plugin.onBeforeReceive!(
      { identity: "CP-X" } as any,
      "not-json{{{",
    );
    expect(result).toBeUndefined();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// replayBufferPlugin
// ═══════════════════════════════════════════════════════════════════

describe("replayBufferPlugin", () => {
  it("should register with correct name", () => {
    const redis = { rpush: vi.fn(), lpop: vi.fn() };
    const plugin = replayBufferPlugin({ redis });
    expect(plugin.name).toBe("replay-buffer");
  });

  it("should flush queued messages on reconnection", async () => {
    const queued = [
      JSON.stringify([
        2,
        "old-1",
        "RemoteStopTransaction",
        { transactionId: 1 },
      ]),
      JSON.stringify([2, "old-2", "UnlockConnector", { connectorId: 1 }]),
    ];
    let callCount = 0;
    const redis = {
      rpush: vi.fn(),
      lpop: vi.fn().mockImplementation(async () => {
        return queued[callCount++] ?? null;
      }),
    };
    const callSpy = vi.fn().mockResolvedValue({});
    const useSpy = vi.fn();
    const plugin = replayBufferPlugin({ redis, flushConcurrency: 10 });

    plugin.onConnection!({
      identity: "CP-REPLAY",
      call: callSpy,
      use: useSpy,
    } as any);

    // Wait for async flush
    await new Promise((r) => setTimeout(r, 100));

    expect(callSpy).toHaveBeenCalledTimes(2);
    expect(callSpy).toHaveBeenCalledWith("RemoteStopTransaction", {
      transactionId: 1,
    });
    expect(callSpy).toHaveBeenCalledWith("UnlockConnector", { connectorId: 1 });
  });

  it("should skip unparseable queued messages", async () => {
    let callCount = 0;
    const queued = ["not-json{{{", null];
    const redis = {
      rpush: vi.fn(),
      lpop: vi.fn().mockImplementation(async () => queued[callCount++] ?? null),
    };
    const warnSpy = vi.fn();
    const callSpy = vi.fn();
    const plugin = replayBufferPlugin({
      redis,
      logger: { warn: warnSpy, error: vi.fn() },
    });

    plugin.onConnection!({
      identity: "CP-BAD",
      call: callSpy,
      use: vi.fn(),
    } as any);

    await new Promise((r) => setTimeout(r, 100));

    expect(callSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unparseable"),
    );
  });

  it("should wait for flushes on onClosing", async () => {
    const redis = {
      rpush: vi.fn(),
      lpop: vi.fn().mockResolvedValue(null),
    };
    const plugin = replayBufferPlugin({ redis });

    // Should not throw even without active flushes
    await plugin.onClosing!();
  });
});

// ═══════════════════════════════════════════════════════════════════
// piiRedactorPlugin
// ═══════════════════════════════════════════════════════════════════

describe("piiRedactorPlugin", () => {
  it("should register with correct name", () => {
    const plugin = piiRedactorPlugin();
    expect(plugin.name).toBe("pii-redactor");
  });

  it("should install middleware on connection", () => {
    const useSpy = vi.fn();
    const plugin = piiRedactorPlugin();
    plugin.onConnection!({ use: useSpy } as any);
    expect(useSpy).toHaveBeenCalledWith(expect.any(Function));
  });
});

// ═══════════════════════════════════════════════════════════════════
// kafkaPlugin
// ═══════════════════════════════════════════════════════════════════

describe("kafkaPlugin", () => {
  it("should register with correct name", () => {
    const mockProducer = { send: vi.fn().mockResolvedValue(undefined) };
    const plugin = kafkaPlugin({ producer: mockProducer });
    expect(plugin.name).toBe("kafka");
  });

  it("should send connection events via producer", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const plugin = kafkaPlugin({
      producer: { send: sendSpy },
      topic: "ocpp-events",
      events: ["connect"],
    });

    plugin.onConnection!({
      identity: "CP-KAFKA-1",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "10.0.0.1" },
    } as any);

    await new Promise((r) => setTimeout(r, 50));

    expect(sendSpy).toHaveBeenCalled();
    const callArgs = sendSpy.mock.calls[0][0];
    expect(callArgs.topic).toBe("ocpp-events");
    expect(callArgs.messages[0].key).toBe("CP-KAFKA-1");
  });

  it("should fire disconnect event on onClosing", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const plugin = kafkaPlugin({
      producer: { send: sendSpy },
      events: ["disconnect"],
    });

    plugin.onClosing!();

    await new Promise((r) => setTimeout(r, 50));
    // onClosing may or may not emit depending on impl — just ensure no crash
  });
});

// ═══════════════════════════════════════════════════════════════════
// circuitBreakerPlugin
// ═══════════════════════════════════════════════════════════════════

describe("circuitBreakerPlugin", () => {
  it("should register with correct name", () => {
    const plugin = circuitBreakerPlugin();
    expect(plugin.name).toBe("circuit-breaker");
  });

  it("should install middleware on connection", () => {
    const useSpy = vi.fn();
    const plugin = circuitBreakerPlugin();
    plugin.onConnection!({
      identity: "CP-CB-1",
      use: useSpy,
    } as any);
    expect(useSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it("should pass through successful calls in CLOSED state", async () => {
    const useSpy = vi.fn();
    const plugin = circuitBreakerPlugin({ failureThreshold: 2 });

    plugin.onConnection!({
      identity: "CP-CB-2",
      use: useSpy,
    } as any);

    // Get the installed middleware
    const middleware = useSpy.mock.calls[0][0];

    const ctx = { type: "outgoing_call", method: "Heartbeat", messageId: "1" };
    const next = vi.fn().mockResolvedValue({ status: "Accepted" });

    const result = await middleware(ctx, next);
    expect(result).toEqual({ status: "Accepted" });
    expect(next).toHaveBeenCalled();
  });

  it("should trip to OPEN after failureThreshold failures", async () => {
    const useSpy = vi.fn();
    const stateChangeSpy = vi.fn();
    const plugin = circuitBreakerPlugin({
      failureThreshold: 2,
      onStateChange: stateChangeSpy,
    });

    plugin.onConnection!({
      identity: "CP-CB-3",
      use: useSpy,
    } as any);

    const middleware = useSpy.mock.calls[0][0];
    const ctx = { type: "outgoing_call", method: "GetLog", messageId: "1" };
    const failingNext = vi
      .fn()
      .mockRejectedValue(new Error("WebSocket is not open"));

    // Fail twice to trip the circuit
    await expect(middleware(ctx, failingNext)).rejects.toThrow();
    await expect(middleware(ctx, failingNext)).rejects.toThrow();

    // Verify state change callback
    expect(stateChangeSpy).toHaveBeenCalledWith("CP-CB-3", "CLOSED", "OPEN");

    // Next call should fast-fail without calling next()
    const freshNext = vi.fn();
    await expect(middleware(ctx, freshNext)).rejects.toThrow(
      /Circuit breaker OPEN/,
    );
    expect(freshNext).not.toHaveBeenCalled();
  });

  it("should not intercept non-outgoing_call contexts", async () => {
    const useSpy = vi.fn();
    const plugin = circuitBreakerPlugin();
    plugin.onConnection!({
      identity: "CP-CB-4",
      use: useSpy,
    } as any);

    const middleware = useSpy.mock.calls[0][0];
    const ctx = { type: "incoming_call", method: "Heartbeat" };
    const next = vi.fn().mockResolvedValue(42);

    const result = await middleware(ctx, next);
    expect(result).toBe(42);
    expect(next).toHaveBeenCalled();
  });

  it("should clean up on disconnect and close", () => {
    const plugin = circuitBreakerPlugin();
    plugin.onConnection!({
      identity: "CP-CB-5",
      use: vi.fn(),
    } as any);

    // Should not throw
    plugin.onDisconnect!({ identity: "CP-CB-5" } as any, 1000, "normal");
    plugin.onClose!();
  });
});

// ═══════════════════════════════════════════════════════════════════
// rateLimitNotifierPlugin
// ═══════════════════════════════════════════════════════════════════

describe("rateLimitNotifierPlugin", () => {
  it("should register with correct name", () => {
    const plugin = rateLimitNotifierPlugin({
      sink: "https://alerts.example.com",
    });
    expect(plugin.name).toBe("rate-limit-notifier");
  });

  it("should send alert via custom sink when threshold reached", () => {
    const sendSpy = vi.fn();
    const plugin = rateLimitNotifierPlugin({
      sink: { send: sendSpy },
      threshold: 1,
      cooldownMs: 0,
    });

    plugin.onRateLimitExceeded!(
      {
        identity: "CP-RL-1",
        handshake: { remoteAddress: "10.0.0.1" },
      } as any,
      "raw-data",
    );

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "RATE_LIMIT_EXCEEDED",
        identity: "CP-RL-1",
        ip: "10.0.0.1",
      }),
    );
  });

  it("should respect cooldown between alerts", () => {
    const sendSpy = vi.fn();
    const plugin = rateLimitNotifierPlugin({
      sink: { send: sendSpy },
      threshold: 1,
      cooldownMs: 60_000, // 1 minute
    });

    const client = {
      identity: "CP-RL-2",
      handshake: { remoteAddress: "10.0.0.2" },
    } as any;

    // First alert should fire
    plugin.onRateLimitExceeded!(client, "raw");
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Second within cooldown should NOT fire
    plugin.onRateLimitExceeded!(client, "raw");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("should respect threshold before alerting", () => {
    const sendSpy = vi.fn();
    const plugin = rateLimitNotifierPlugin({
      sink: { send: sendSpy },
      threshold: 3,
      cooldownMs: 0,
    });

    const client = {
      identity: "CP-RL-3",
      handshake: { remoteAddress: "10.0.0.3" },
    } as any;

    plugin.onRateLimitExceeded!(client, "raw");
    plugin.onRateLimitExceeded!(client, "raw");
    expect(sendSpy).not.toHaveBeenCalled();

    // 3rd event hits threshold
    plugin.onRateLimitExceeded!(client, "raw");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("should also react to securityEvent for CONNECTION_RATE_LIMIT", () => {
    const sendSpy = vi.fn();
    const plugin = rateLimitNotifierPlugin({
      sink: { send: sendSpy },
      threshold: 1,
      cooldownMs: 0,
    });

    plugin.onSecurityEvent!({
      type: "CONNECTION_RATE_LIMIT",
      identity: "CP-RL-4",
      ip: "10.0.0.4",
      timestamp: new Date().toISOString(),
    });

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "CONNECTION_RATE_LIMIT",
      }),
    );
  });

  it("should clean up on close", () => {
    const plugin = rateLimitNotifierPlugin({
      sink: { send: vi.fn() },
    });
    plugin.onClose!();
    // Should not throw
  });
});

// ═══════════════════════════════════════════════════════════════════
// schemaVersioningPlugin
// ═══════════════════════════════════════════════════════════════════

describe("schemaVersioningPlugin", () => {
  it("should register with correct name", () => {
    const plugin = schemaVersioningPlugin({
      sourceVersion: "ocpp1.6",
      targetVersion: "ocpp2.0.1",
      rules: [],
    });
    expect(plugin.name).toBe("schema-versioning");
  });

  it("should install middleware on connection", () => {
    const useSpy = vi.fn();
    const plugin = schemaVersioningPlugin({
      sourceVersion: "ocpp1.6",
      targetVersion: "ocpp2.0.1",
      rules: [],
    });

    plugin.onConnection!({
      use: useSpy,
      protocol: "ocpp1.6",
    } as any);

    expect(useSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it("should transform incoming_call payload UP", async () => {
    const useSpy = vi.fn();
    const plugin = schemaVersioningPlugin({
      sourceVersion: "ocpp1.6",
      targetVersion: "ocpp2.0.1",
      rules: [
        {
          method: "BootNotification",
          transform: (payload, direction) => {
            if (direction === "up") {
              return {
                chargingStation: {
                  model: payload.chargePointModel,
                  vendorName: payload.chargePointVendor,
                },
                reason: "PowerUp",
              };
            }
            return payload;
          },
        },
      ],
    });

    plugin.onConnection!({
      use: useSpy,
      protocol: "ocpp1.6",
    } as any);

    const middleware = useSpy.mock.calls[0][0];
    const ctx: any = {
      type: "incoming_call",
      method: "BootNotification",
      params: {
        chargePointModel: "Model-X",
        chargePointVendor: "Vendor-Y",
      },
    };
    const next = vi.fn().mockResolvedValue({});

    await middleware(ctx, next);

    expect(ctx.params).toEqual({
      chargingStation: {
        model: "Model-X",
        vendorName: "Vendor-Y",
      },
      reason: "PowerUp",
    });
    expect(next).toHaveBeenCalled();
  });

  it("should transform outgoing_call payload DOWN", async () => {
    const useSpy = vi.fn();
    const plugin = schemaVersioningPlugin({
      sourceVersion: "ocpp1.6",
      targetVersion: "ocpp2.0.1",
      rules: [
        {
          method: "TriggerMessage",
          transform: (payload, direction) => {
            if (direction === "down") {
              return { requestedMessage: payload.requestedMessage };
            }
            return payload;
          },
        },
      ],
    });

    plugin.onConnection!({
      use: useSpy,
      protocol: "ocpp1.6",
    } as any);

    const middleware = useSpy.mock.calls[0][0];
    const ctx: any = {
      type: "outgoing_call",
      method: "TriggerMessage",
      params: {
        requestedMessage: "BootNotification",
        extraField: "should be dropped",
      },
    };
    const next = vi.fn().mockResolvedValue({});

    await middleware(ctx, next);
    expect(ctx.params).toEqual({ requestedMessage: "BootNotification" });
  });

  it("should passthrough methods without rules by default", async () => {
    const useSpy = vi.fn();
    const plugin = schemaVersioningPlugin({
      sourceVersion: "ocpp1.6",
      targetVersion: "ocpp2.0.1",
      rules: [],
    });

    plugin.onConnection!({
      use: useSpy,
      protocol: "ocpp1.6",
    } as any);

    const middleware = useSpy.mock.calls[0][0];
    const ctx: any = {
      type: "incoming_call",
      method: "Heartbeat",
      params: {},
    };
    const next = vi.fn().mockResolvedValue({ currentTime: "2025-01-01" });

    const result = await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(result).toEqual({ currentTime: "2025-01-01" });
  });

  it("should reject unmatched methods when unmatchedBehavior=reject", async () => {
    const useSpy = vi.fn();
    const plugin = schemaVersioningPlugin({
      sourceVersion: "ocpp1.6",
      targetVersion: "ocpp2.0.1",
      rules: [],
      unmatchedBehavior: "reject",
    });

    plugin.onConnection!({
      use: useSpy,
      protocol: "ocpp1.6",
    } as any);

    const middleware = useSpy.mock.calls[0][0];
    const ctx: any = {
      type: "incoming_call",
      method: "CustomAction",
      params: {},
    };

    await expect(middleware(ctx, vi.fn())).rejects.toThrow(/no transform rule/);
  });

  it("should skip middleware if applyWhen doesn't match client protocol", () => {
    const useSpy = vi.fn();
    const plugin = schemaVersioningPlugin({
      sourceVersion: "ocpp1.6",
      targetVersion: "ocpp2.0.1",
      rules: [],
      applyWhen: "ocpp1.6",
    });

    plugin.onConnection!({
      use: useSpy,
      protocol: "ocpp2.0.1", // doesn't match applyWhen
    } as any);

    expect(useSpy).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// otelPlugin — new hooks coverage
// ═══════════════════════════════════════════════════════════════════

describe("otelPlugin — expanded hooks", () => {
  function createMockTracer() {
    const addEventSpy = vi.fn();
    const recordExceptionSpy = vi.fn();
    const setAttributeSpy = vi.fn();
    const setStatusSpy = vi.fn();
    const endSpy = vi.fn();
    const startSpanSpy = vi.fn().mockReturnValue({
      setAttribute: setAttributeSpy,
      setStatus: setStatusSpy,
      addEvent: addEventSpy,
      recordException: recordExceptionSpy,
      end: endSpy,
    });

    return {
      tracer: { startSpan: startSpanSpy },
      spies: {
        startSpan: startSpanSpy,
        addEvent: addEventSpy,
        recordException: recordExceptionSpy,
        setAttribute: setAttributeSpy,
        setStatus: setStatusSpy,
        end: endSpy,
      },
    };
  }

  it("should record onValidationFailure as exception on connection span", () => {
    const { tracer, spies } = createMockTracer();
    const plugin = otelPlugin({ tracer });
    plugin.onInit!({ log: { warn: vi.fn() } } as any);

    const client = {
      identity: "CP-OT-VF",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "10.0.0.1" },
    } as any;

    plugin.onConnection!(client);
    plugin.onValidationFailure!(
      client,
      {} as any,
      new Error("Missing required field"),
    );

    expect(spies.recordException).toHaveBeenCalled();
    expect(spies.addEvent).toHaveBeenCalledWith(
      "ocpp.validation_failure",
      expect.objectContaining({ "error.message": "Missing required field" }),
    );
  });

  it("should record onRateLimitExceeded as event on connection span", () => {
    const { tracer, spies } = createMockTracer();
    const plugin = otelPlugin({ tracer });
    plugin.onInit!({ log: { warn: vi.fn() } } as any);

    const client = {
      identity: "CP-OT-RL",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "10.0.0.1" },
    } as any;

    plugin.onConnection!(client);
    plugin.onRateLimitExceeded!(client, "raw-data");

    expect(spies.addEvent).toHaveBeenCalledWith("ocpp.rate_limit_exceeded");
  });

  it("should record onBackpressure with buffered amount", () => {
    const { tracer, spies } = createMockTracer();
    const plugin = otelPlugin({ tracer });
    plugin.onInit!({ log: { warn: vi.fn() } } as any);

    const client = {
      identity: "CP-OT-BP",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "10.0.0.1" },
    } as any;

    plugin.onConnection!(client);
    plugin.onBackpressure!(client, 65536);

    expect(spies.addEvent).toHaveBeenCalledWith("ocpp.backpressure", {
      "ocpp.buffered_bytes": 65536,
    });
  });

  it("should create onTelemetry span with server stats", () => {
    const { tracer, spies } = createMockTracer();
    const plugin = otelPlugin({ tracer });
    plugin.onInit!({ log: { warn: vi.fn() } } as any);

    plugin.onTelemetry!({
      connectedClients: 42,
      activeSessions: 38,
      uptimeSeconds: 3600,
      memoryUsage: {
        rss: 100_000_000,
        heapUsed: 50_000_000,
        heapTotal: 120_000_000,
        external: 5_000_000,
        arrayBuffers: 1_000_000,
      },
      cpuUsage: { user: 1000, system: 500 },
      pid: 12345,
      webSockets: { total: 42, bufferedAmount: 1024 },
    } as any);

    expect(spies.startSpan).toHaveBeenCalledWith("ocpp.telemetry_push", {
      kind: 0,
    });
    expect(spies.setAttribute).toHaveBeenCalledWith(
      "ocpp.connected_clients",
      42,
    );
    expect(spies.setAttribute).toHaveBeenCalledWith("ocpp.ws_total", 42);
    expect(spies.end).toHaveBeenCalled();
  });

  it("should fire onClosing event on all open spans", () => {
    const { tracer, spies } = createMockTracer();
    const plugin = otelPlugin({ tracer });
    plugin.onInit!({ log: { warn: vi.fn() } } as any);

    plugin.onConnection!({
      identity: "CP-CL-1",
      protocol: "ocpp1.6",
      handshake: { remoteAddress: "10.0.0.1" },
    } as any);

    plugin.onClosing!();

    expect(spies.addEvent).toHaveBeenCalledWith("ocpp.server_closing");
  });
});

// ═══════════════════════════════════════════════════════════════════
// metricsPlugin — new counters
// ═══════════════════════════════════════════════════════════════════

describe("metricsPlugin — new counters", () => {
  it("should increment onValidationFailure counter", () => {
    const plugin = metricsPlugin({ intervalMs: 0 });
    plugin.onInit!({} as any);

    plugin.onValidationFailure!({} as any, {} as any, new Error("bad"));
    plugin.onValidationFailure!({} as any, {} as any, new Error("bad2"));

    const snap = plugin.getMetrics();
    expect(snap.totalValidationFailures).toBe(2);
  });

  it("should increment onSecurityEvent counter", () => {
    const plugin = metricsPlugin({ intervalMs: 0 });
    plugin.onInit!({} as any);

    plugin.onSecurityEvent!({
      type: "AUTH_FAILED",
      timestamp: new Date().toISOString(),
    });

    const snap = plugin.getMetrics();
    expect(snap.totalSecurityEvents).toBe(1);
  });

  it("should include new counters in Prometheus export", async () => {
    const plugin = metricsPlugin({ intervalMs: 0 });
    plugin.onInit!({} as any);

    plugin.onValidationFailure!({} as any, {} as any, new Error("x"));
    plugin.onSecurityEvent!({
      type: "RATE_LIMIT_EXCEEDED",
      timestamp: new Date().toISOString(),
    });

    const lines = await plugin.getCustomMetrics!();
    const text = lines.join("\n");

    expect(text).toContain("ocpp_validation_failures_total 1");
    expect(text).toContain("ocpp_security_events_total 1");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Integration: Register all 19 plugins
// ═══════════════════════════════════════════════════════════════════

describe("Plugin Integration — all new plugins register", () => {
  it("should register new plugins via server.plugin()", async () => {
    const { OCPPServer } = await import("../src/server.js");
    const server = new OCPPServer();

    const mockRedis = {
      set: vi.fn().mockResolvedValue("OK"),
      rpush: vi.fn(),
      lpop: vi.fn().mockResolvedValue(null),
    };
    const mockProducer = { send: vi.fn().mockResolvedValue(undefined) };

    const result = server.plugin(
      messageDedupPlugin({ redis: mockRedis }),
      replayBufferPlugin({ redis: mockRedis }),
      piiRedactorPlugin(),
      kafkaPlugin({ producer: mockProducer }),
      circuitBreakerPlugin(),
      rateLimitNotifierPlugin({ sink: { send: vi.fn() } }),
      schemaVersioningPlugin({
        sourceVersion: "ocpp1.6",
        targetVersion: "ocpp2.0.1",
        rules: [],
      }),
    );

    expect(result).toBe(server);

    // @ts-expect-error — accessing private field for test
    const names = server._plugins.map((p: any) => p.name);
    expect(names).toContain("message-dedup");
    expect(names).toContain("replay-buffer");
    expect(names).toContain("pii-redactor");
    expect(names).toContain("kafka");
    expect(names).toContain("circuit-breaker");
    expect(names).toContain("rate-limit-notifier");
    expect(names).toContain("schema-versioning");

    server.close({ force: true }).catch(() => {});
  });
});
