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
