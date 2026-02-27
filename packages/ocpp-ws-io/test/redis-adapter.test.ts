import { describe, it, expect, vi } from "vitest";
import { RedisAdapter } from "../src/adapters/redis/index.js";

// Mock Redis client
const createMockRedis = () => ({
  publish: vi.fn().mockResolvedValue(1),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
  disconnect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
});

describe("RedisAdapter", () => {
  it("should subscribe to channels with prefix", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();
    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    await adapter.subscribe("my-channel", () => {});

    expect(sub.subscribe).toHaveBeenCalledWith("test:my-channel");
  });

  it("should publish to channels with prefix", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();
    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    await adapter.publish("my-channel", { foo: "bar" });

    expect(pub.publish).toHaveBeenCalledWith(
      "test:my-channel",
      JSON.stringify({ foo: "bar" }),
    );
  });

  it("should handle incoming messages and strip prefix", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();
    let messageHandler: (channel: string, message: string) => void;

    sub.on.mockImplementation((event, handler) => {
      if (event === "message") {
        messageHandler = handler;
      }
    });

    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    // Wait for setupSubscriber to run
    expect(sub.on).toHaveBeenCalledWith("message", expect.any(Function));

    let receivedData: any;
    await adapter.subscribe("my-channel", (data) => {
      receivedData = data;
    });

    // Simulate incoming message from Redis
    // @ts-ignore
    messageHandler!("test:my-channel", JSON.stringify({ hello: "world" }));

    expect(receivedData).toEqual({ hello: "world" });
  });

  it("should unsubsribe with prefix", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();
    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    await adapter.subscribe("abc", () => {});
    await adapter.unsubscribe("abc");

    expect(sub.unsubscribe).toHaveBeenCalledWith("test:abc");
  });

  it("should disconnect and cleanup", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    await adapter.disconnect();

    expect(pub.quit).toHaveBeenCalled(); // or disconnect, depends on what we mocked, but RedisAdapter checks quit first
    expect(sub.quit).toHaveBeenCalled();
  });

  it("should use disconnect() if quit() is missing", async () => {
    const createDisconnectMock = () => ({
      publish: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      // no quit
    });

    const pub = createDisconnectMock();
    const sub = createDisconnectMock();
    // @ts-ignore
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    await adapter.disconnect();

    expect(pub.disconnect).toHaveBeenCalled();
    expect(sub.disconnect).toHaveBeenCalled();
  });

  it("should handle JSON parse errors gracefully", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();

    let messageHandler: Function;
    sub.on.mockImplementation((evt: string, fn: Function) => {
      if (evt === "message") messageHandler = fn;
    });

    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    // force init
    await adapter.subscribe("raw", (data) => {
      expect(data).toBe("invalid-json{");
    });

    // Trigger with bad JSON
    messageHandler!("test:raw", "invalid-json{");
  });

  it("should swallow handler errors", async () => {
    const pub = createMockRedis();
    const sub = createMockRedis();

    let messageHandler: Function;
    sub.on.mockImplementation((evt: string, fn: Function) => {
      if (evt === "message") messageHandler = fn;
    });

    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    await adapter.subscribe("thrower", () => {
      throw new Error("Handler failed");
    });

    // Should not throw
    expect(() => {
      messageHandler!("test:thrower", "{}");
    }).not.toThrow();
  });
});

describe("RedisAdapter (Node Redis v4)", () => {
  const createNodeRedisMock = () => ({
    isOpen: true,
    connect: vi.fn(),
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
    // Node Redis doesn't use 'on' for messages
  });

  it("should use NodeRedisDriver and subscribe with handler", async () => {
    const pub = createNodeRedisMock();
    const sub = createNodeRedisMock();
    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "nr:",
    });

    let capturedHandler: ((msg: string) => void) | undefined;

    // Node Redis v4 subscribe takes handler as second arg
    sub.subscribe.mockImplementation((_chan: string, handler: any) => {
      capturedHandler = handler;
      return Promise.resolve();
    });

    let received: any;
    await adapter.subscribe("foo", (data) => {
      received = data;
    });

    expect(sub.subscribe).toHaveBeenCalledWith("nr:foo", expect.any(Function));

    // Simulate message
    capturedHandler!(JSON.stringify({ a: 1 }));
    expect(received).toEqual({ a: 1 });
  });

  it("should disconnect using disconnect()", async () => {
    const pub = createNodeRedisMock();
    const sub = createNodeRedisMock();
    // @ts-ignore
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    await adapter.disconnect();

    expect(pub.disconnect).toHaveBeenCalled();
    expect(sub.disconnect).toHaveBeenCalled();
  });
});

// ─── Stream & Unicast Coverage ──────────────────────────────────

describe("RedisAdapter Streams", () => {
  const createStreamMock = () => ({
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    xadd: vi.fn().mockResolvedValue("1-0"),
    xread: vi.fn().mockResolvedValue(null),
    xlen: vi.fn().mockResolvedValue(0),
    set: vi.fn(),
    get: vi.fn(),
    mget: vi.fn().mockResolvedValue([]),
    del: vi.fn(),
    expire: vi.fn(),
    pipeline: vi.fn().mockReturnValue({ set: vi.fn(), exec: vi.fn() }),
  });

  it("should publish to streams for ocpp:node: channels", async () => {
    const pub = createStreamMock();
    const sub = createStreamMock();
    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "test:",
    });

    await adapter.publish("ocpp:node:123", { method: "Test", params: {} });

    expect(pub.xadd).toHaveBeenCalled();
    expect(pub.expire).toHaveBeenCalled();
  });

  it("should add sequence counters to unicast messages", async () => {
    const pub = createStreamMock();
    const sub = createStreamMock();
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    const data = { method: "Test", params: {} } as any;
    await adapter.publish("ocpp:node:n1", data);

    // __seq should be attached
    expect(data.__seq).toBe(1);
  });

  it("should subscribe to streams and start polling", async () => {
    const pub = createStreamMock();
    const sub = createStreamMock();
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    const handler = vi.fn();
    await adapter.subscribe("ocpp:node:mynode", handler);

    // Stream subscription doesn't call sub.subscribe
    expect(sub.subscribe).not.toHaveBeenCalled();

    // Cleanup
    await adapter.disconnect();
  });

  it("should unsubscribe from stream channels", async () => {
    const pub = createStreamMock();
    const sub = createStreamMock();
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    await adapter.subscribe("ocpp:node:n1", vi.fn());
    await adapter.unsubscribe("ocpp:node:n1");

    // Should not call sub.unsubscribe for stream channels
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    await adapter.disconnect();
  });
});

// ─── Presence Coverage ──────────────────────────────────────────

describe("RedisAdapter Presence", () => {
  const createPresenceMock = () => ({
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(),
    get: vi.fn(),
    mget: vi.fn(),
    del: vi.fn(),
    pipeline: vi.fn().mockReturnValue({ set: vi.fn(), exec: vi.fn() }),
  });

  it("should set and get presence", async () => {
    const pub = createPresenceMock();
    const sub = createPresenceMock();
    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "p:",
    });

    await adapter.setPresence("CP-1", "node-a", 300);
    expect(pub.set).toHaveBeenCalledWith(
      "p:presence:CP-1",
      "node-a",
      "EX",
      300,
    );

    pub.get.mockResolvedValue("node-a");
    const result = await adapter.getPresence("CP-1");
    expect(result).toBe("node-a");
  });

  it("should get presence batch", async () => {
    const pub = createPresenceMock();
    const sub = createPresenceMock();
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    pub.mget.mockResolvedValue(["node-a", null]);
    const result = await adapter.getPresenceBatch(["CP-1", "CP-2"]);
    expect(result).toEqual(["node-a", null]);
  });

  it("should return empty array for empty presence batch", async () => {
    const pub = createPresenceMock();
    const sub = createPresenceMock();
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    const result = await adapter.getPresenceBatch([]);
    expect(result).toEqual([]);
  });

  it("should remove presence", async () => {
    const pub = createPresenceMock();
    const sub = createPresenceMock();
    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      prefix: "x:",
    });

    await adapter.removePresence("CP-1");
    expect(pub.del).toHaveBeenCalledWith("x:presence:CP-1");
  });

  it("should set presence batch with pipeline", async () => {
    const pub = createPresenceMock();
    const sub = createPresenceMock();
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    await adapter.setPresenceBatch([
      { identity: "CP-1", nodeId: "n1", ttl: 60 },
      { identity: "CP-2", nodeId: "n2" },
    ]);
    expect(pub.pipeline).toHaveBeenCalled();
  });

  it("should return early for empty setPresenceBatch", async () => {
    const pub = createPresenceMock();
    const sub = createPresenceMock();
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    pub.pipeline = vi.fn();
    await adapter.setPresenceBatch([]);
    expect(pub.pipeline).not.toHaveBeenCalled();
  });
});

// ─── Metrics Coverage ───────────────────────────────────────────

describe("RedisAdapter Metrics", () => {
  it("should return metrics for active streams", async () => {
    const pub = {
      publish: vi.fn().mockResolvedValue(1),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      removeListener: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
      xlen: vi.fn().mockResolvedValue(5),
      xread: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      get: vi.fn(),
      mget: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(),
      xadd: vi.fn().mockResolvedValue("1-0"),
      pipeline: vi.fn().mockReturnValue({ set: vi.fn(), exec: vi.fn() }),
    };
    const sub = { ...pub };
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    // Subscribe to trigger stream polling
    await adapter.subscribe("ocpp:node:m1", vi.fn());

    const m = await adapter.metrics();
    expect(m.activeStreams).toBe(1);
    expect(m.pendingMessages).toBe(5);

    await adapter.disconnect();
  });
});

// ─── publishBatch Coverage ──────────────────────────────────────

describe("RedisAdapter publishBatch", () => {
  it("should batch stream and broadcast messages", async () => {
    const pub = {
      publish: vi.fn().mockResolvedValue(1),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      removeListener: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
      xadd: vi.fn().mockResolvedValue("1-0"),
      xread: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      get: vi.fn(),
      mget: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(),
      pipeline: vi.fn().mockReturnValue({
        xadd: vi.fn(),
        exec: vi.fn(),
      }),
    };
    const sub = { ...pub };
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });

    await adapter.publishBatch([
      { channel: "ocpp:node:n1", data: { m: "unicast" } },
      { channel: "ocpp:broadcast", data: { m: "bcast" } },
    ]);

    // Stream messages go through pipeline
    expect(pub.pipeline).toHaveBeenCalled();
    // Broadcast goes through publish
    expect(pub.publish).toHaveBeenCalled();

    await adapter.disconnect();
  });
});
