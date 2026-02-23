import { describe, it, expect, vi } from "vitest";
import { RedisAdapter } from "../src/adapters/redis/index.js";
import { InMemoryAdapter } from "../src/adapters/adapter.js";

// Mock Redis client with all required methods
const createMockRedis = () => ({
  publish: vi.fn().mockResolvedValue(1),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
  disconnect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue("OK"),
  get: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  xadd: vi.fn().mockResolvedValue("0-0"),
  pipeline: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  }),
});

// ─── C1: Batch Presence Pipeline ─────────────────────────────────

describe("Phase C — Batch Presence Pipeline", () => {
  it("should batch set presence entries via pipeline", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();
    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    await adapter.setPresenceBatch([
      { identity: "CP-1", nodeId: "node-A", ttl: 60 },
      { identity: "CP-2", nodeId: "node-A", ttl: 60 },
      { identity: "CP-3", nodeId: "node-B", ttl: 120 },
    ]);

    // Should have used pipeline
    expect(pub.pipeline).toHaveBeenCalled();
    const pipeline = pub.pipeline.mock.results[0].value;
    expect(pipeline.set).toHaveBeenCalledTimes(3);
    expect(pipeline.exec).toHaveBeenCalled();

    await adapter.disconnect();
  });

  it("should handle empty batch gracefully", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();
    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
    });

    await adapter.setPresenceBatch([]);
    expect(pub.pipeline).not.toHaveBeenCalled();

    await adapter.disconnect();
  });

  it("InMemoryAdapter should support setPresenceBatch", async () => {
    const adapter = new InMemoryAdapter();

    await adapter.setPresenceBatch([
      { identity: "CP-1", nodeId: "node-A" },
      { identity: "CP-2", nodeId: "node-B" },
    ]);

    expect(await adapter.getPresence("CP-1")).toBe("node-A");
    expect(await adapter.getPresence("CP-2")).toBe("node-B");

    await adapter.disconnect();
  });
});

// ─── C2: Ephemeral TTL Leases on Stream Keys ────────────────────

describe("Phase C — Ephemeral Stream TTL", () => {
  it("should set TTL on stream key after xadd for unicast messages", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();
    pub.xadd = vi.fn().mockResolvedValue("1234-0");

    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
      streamTtlSeconds: 120,
    });

    await adapter.publish("ocpp:node:abc", { method: "Reset", params: {} });

    // Should have called expire on the stream key
    expect(pub.expire).toHaveBeenCalledWith("test:ocpp:node:abc", 120);

    await adapter.disconnect();
  });

  it("should NOT set TTL for broadcast (Pub/Sub) channels", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();

    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    await adapter.publish("ocpp:broadcast", { method: "Reset", params: {} });

    // expire should NOT be called for broadcast channels
    expect(pub.expire).not.toHaveBeenCalled();

    await adapter.disconnect();
  });
});

// ─── C3: Redis Failure Rehydration ───────────────────────────────

describe("Phase C — Redis Failure Rehydration", () => {
  it("should register error and reconnect listeners on the driver", () => {
    const pub = createMockRedis();
    const sub = createMockRedis();

    new RedisAdapter({
      pubClient: pub,
      subClient: sub,
    });

    // IoRedisDriver registers 'error' and 'connect' listeners via on()
    expect(pub.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(pub.on).toHaveBeenCalledWith("connect", expect.any(Function));
  });

  it("should cache presence entries and rehydrate on reconnect", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();

    // Capture the 'connect' handler
    let connectHandler: (() => void) | undefined;
    pub.on.mockImplementation((event: string, handler: any) => {
      if (event === "connect") connectHandler = handler;
    });

    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    // Set presence — should be cached
    await adapter.setPresence("CP-1", "node-A", 60);
    expect(pub.set).toHaveBeenCalledWith(
      "test:presence:CP-1",
      "node-A",
      "EX",
      60,
    );

    // Reset mock to track the rehydration call
    pub.pipeline.mockClear();
    pub.pipeline.mockReturnValue({
      set: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    });

    // Simulate reconnection
    connectHandler?.();
    // Give async rehydration time to complete
    await new Promise((r) => setTimeout(r, 50));

    // Rehydration should have triggered a pipeline batch set
    expect(pub.pipeline).toHaveBeenCalled();
  });
});

// ─── C4: Message Ordering (Sequence IDs) ─────────────────────────

describe("Phase C — Message Ordering Sequence IDs", () => {
  it("should attach __seq to unicast messages", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();

    let capturedMessage: string | undefined;
    pub.xadd = vi.fn().mockImplementation((_stream: string, ...args: any[]) => {
      // Find the message arg — it's in the flat args for IoRedis
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "message") {
          capturedMessage = args[i + 1];
          break;
        }
      }
      return Promise.resolve("1234-0");
    });

    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    const payload = { source: "node-1", target: "CP-1", method: "Reset" };
    await adapter.publish("ocpp:node:xyz", payload);

    // The payload object should now have __seq
    expect((payload as any).__seq).toBe(1);

    // Publish again — seq should increment
    const payload2 = { source: "node-1", target: "CP-2", method: "Reset" };
    await adapter.publish("ocpp:node:xyz", payload2);
    expect((payload2 as any).__seq).toBe(2);

    await adapter.disconnect();
  });

  it("should NOT attach __seq to broadcast messages", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();

    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    const payload = { source: "node-1", method: "TriggerMessage" };
    await adapter.publish("ocpp:broadcast", payload);

    expect((payload as any).__seq).toBeUndefined();

    await adapter.disconnect();
  });
});

// ─── Adapter Options ─────────────────────────────────────────────

describe("Phase C — Adapter Options", () => {
  it("should accept streamTtlSeconds and presenceTtlSeconds options", () => {
    const pub = createMockRedis();
    const sub = createMockRedis();

    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      streamTtlSeconds: 600,
      presenceTtlSeconds: 120,
    });

    // Verify adapter was created successfully (no errors)
    expect(adapter).toBeDefined();
  });
});
