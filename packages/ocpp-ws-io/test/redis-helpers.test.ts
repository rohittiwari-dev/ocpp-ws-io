import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  IoRedisDriver,
  NodeRedisDriver,
  createDriver,
} from "../src/adapters/redis/helpers";

describe("IoRedisDriver", () => {
  let pub: any;
  let sub: any;
  let blocking: any;
  let driver: IoRedisDriver;

  beforeEach(() => {
    pub = {
      publish: vi.fn(),
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      xadd: vi.fn(),
      xread: vi.fn(),
      quit: vi.fn(),
    };
    sub = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      on: vi.fn(),
      quit: vi.fn(),
    };
    blocking = {
      xread: vi.fn(),
      quit: vi.fn(),
    };
    driver = new IoRedisDriver(pub, sub, blocking);
  });

  test("publish calls pub.publish", async () => {
    await driver.publish("chan", "msg");
    expect(pub.publish).toHaveBeenCalledWith("chan", "msg");
  });

  test("subscribe sets handler and calls sub.subscribe", async () => {
    const handler = vi.fn();
    await driver.subscribe("chan", handler);
    expect(sub.subscribe).toHaveBeenCalledWith("chan");
    // Simulate message
    const onCallback = sub.on.mock.calls[0][1];
    onCallback("chan", "hello");
    expect(handler).toHaveBeenCalledWith("hello");
  });

  test("unsubscribe calls sub.unsubscribe", async () => {
    await driver.unsubscribe("chan");
    expect(sub.unsubscribe).toHaveBeenCalledWith("chan");
  });

  test("set/get/del delegate to pub", async () => {
    await driver.set("k", "v");
    expect(pub.set).toHaveBeenCalledWith("k", "v");

    await driver.set("k", "v", 10);
    expect(pub.set).toHaveBeenCalledWith("k", "v", "EX", 10);

    pub.get.mockResolvedValue("res");
    expect(await driver.get("k")).toBe("res");

    pub.get.mockResolvedValue(null);
    expect(await driver.get("k")).toBe(null);

    await driver.del("k");
    expect(pub.del).toHaveBeenCalledWith("k");
  });

  test("xadd formats arguments correctly", async () => {
    pub.xadd.mockResolvedValue("1-0");
    const res = await driver.xadd("s", { foo: "bar" });
    expect(pub.xadd).toHaveBeenCalledWith("s", "*", "foo", "bar");
    expect(res).toBe("1-0");

    await driver.xadd("s", { a: "b" }, 100);
    expect(pub.xadd).toHaveBeenCalledWith(
      "s",
      "MAXLEN",
      "~",
      "100",
      "*",
      "a",
      "b",
    );
  });

  test("xread handles blocking and non-blocking", async () => {
    // Non-blocking
    pub.xread.mockResolvedValue([["s", [["1-0", ["k", "v"]]]]]);
    const res1 = await driver.xread([{ key: "s", id: "0" }]);
    expect(pub.xread).toHaveBeenCalledWith("STREAMS", "s", "0");
    expect(res1).toEqual([
      { stream: "s", messages: [{ id: "1-0", data: { k: "v" } }] },
    ]);

    // Blocking
    blocking.xread.mockResolvedValue([["s", [["1-1", ["a", "b"]]]]]);
    const res2 = await driver.xread([{ key: "s", id: "$" }], 5, 1000);
    expect(blocking.xread).toHaveBeenCalledWith(
      "COUNT",
      5,
      "BLOCK",
      1000,
      "STREAMS",
      "s",
      "$",
    );
    expect(res2).toEqual([
      { stream: "s", messages: [{ id: "1-1", data: { a: "b" } }] },
    ]);

    // Null result
    pub.xread.mockResolvedValue(null);
    expect(await driver.xread([{ key: "s", id: "0" }])).toBeNull();
  });

  test("disconnect quits all clients", async () => {
    await driver.disconnect();
    expect(pub.quit).toHaveBeenCalled();
    expect(sub.quit).toHaveBeenCalled();
  });

  test("disconnect uses disconnect() if quit is unavailable", async () => {
    const pubNoQuit = {
      ...pub,
      quit: undefined,
      disconnect: vi.fn(),
    };
    const subNoQuit = {
      ...sub,
      quit: undefined,
      disconnect: vi.fn(),
    };
    const d = new IoRedisDriver(pubNoQuit, subNoQuit);
    await d.disconnect();
    expect(pubNoQuit.disconnect).toHaveBeenCalled();
    expect(subNoQuit.disconnect).toHaveBeenCalled();
  });

  test("xaddBatch uses pipeline", async () => {
    const exec = vi.fn();
    pub.pipeline = vi.fn().mockReturnValue({
      xadd: vi.fn(),
      exec,
    });
    await driver.xaddBatch(
      [
        { stream: "s1", args: { a: "1" } },
        { stream: "s2", args: { b: "2" } },
      ],
      50,
    );
    expect(pub.pipeline).toHaveBeenCalled();
    expect(exec).toHaveBeenCalled();
  });

  test("xaddBatch returns early for empty messages", async () => {
    pub.pipeline = vi.fn();
    await driver.xaddBatch([]);
    expect(pub.pipeline).not.toHaveBeenCalled();
  });

  test("xlen delegates to pub.xlen", async () => {
    pub.xlen = vi.fn().mockResolvedValue(42);
    const result = await driver.xlen("mystream");
    expect(pub.xlen).toHaveBeenCalledWith("mystream");
    expect(result).toBe(42);
  });

  test("mget delegates to pub.mget", async () => {
    pub.mget = vi.fn().mockResolvedValue(["v1", null, "v3"]);
    const result = await driver.mget(["k1", "k2", "k3"]);
    expect(pub.mget).toHaveBeenCalledWith("k1", "k2", "k3");
    expect(result).toEqual(["v1", null, "v3"]);
  });

  test("mget returns empty array for empty keys", async () => {
    const result = await driver.mget([]);
    expect(result).toEqual([]);
  });

  test("setPresenceBatch uses pipeline", async () => {
    const exec = vi.fn();
    pub.pipeline = vi.fn().mockReturnValue({
      set: vi.fn(),
      exec,
    });
    await driver.setPresenceBatch([
      { key: "p:1", value: "node1", ttlSeconds: 60 },
      { key: "p:2", value: "node2", ttlSeconds: 120 },
    ]);
    expect(pub.pipeline).toHaveBeenCalled();
    expect(exec).toHaveBeenCalled();
  });

  test("setPresenceBatch returns early for empty entries", async () => {
    pub.pipeline = vi.fn();
    await driver.setPresenceBatch([]);
    expect(pub.pipeline).not.toHaveBeenCalled();
  });

  test("expire delegates to pub.expire", async () => {
    pub.expire = vi.fn();
    await driver.expire("key", 300);
    expect(pub.expire).toHaveBeenCalledWith("key", 300);
  });

  test("onError subscribes and returns unsubscribe function", () => {
    pub.on = vi.fn();
    pub.removeListener = vi.fn();
    const handler = vi.fn();
    const unsub = driver.onError(handler);
    expect(pub.on).toHaveBeenCalledWith("error", handler);

    unsub();
    expect(pub.removeListener).toHaveBeenCalledWith("error", handler);
  });

  test("onReconnect subscribes and returns unsubscribe function", () => {
    pub.on = vi.fn();
    pub.removeListener = vi.fn();
    const handler = vi.fn();
    const unsub = driver.onReconnect(handler);
    expect(pub.on).toHaveBeenCalledWith("connect", handler);

    unsub();
    expect(pub.removeListener).toHaveBeenCalledWith("connect", handler);
  });
});

describe("NodeRedisDriver", () => {
  let pub: any;
  let sub: any;
  let driver: NodeRedisDriver;

  beforeEach(() => {
    pub = {
      publish: vi.fn(),
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      xAdd: vi.fn(),
      xRead: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    sub = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
    };
    driver = new NodeRedisDriver(pub, sub);
  });

  test("publish calls pub.publish", async () => {
    await driver.publish("chan", "msg");
    expect(pub.publish).toHaveBeenCalledWith("chan", "msg");
  });

  test("subscribe calls sub.subscribe with handler", async () => {
    const handler = vi.fn();
    await driver.subscribe("chan", handler);
    expect(sub.subscribe).toHaveBeenCalledWith("chan", handler);
  });

  test("unsubscribe calls sub.unsubscribe", async () => {
    await driver.unsubscribe("chan");
    expect(sub.unsubscribe).toHaveBeenCalledWith("chan");
  });

  test("set with TTL", async () => {
    await driver.set("k", "v", 10);
    expect(pub.set).toHaveBeenCalledWith("k", "v", { EX: 10 });
  });

  test("set without TTL", async () => {
    await driver.set("k", "v");
    expect(pub.set).toHaveBeenCalledWith("k", "v");
  });

  test("get delegates to pub.get", async () => {
    pub.get.mockResolvedValue("val");
    expect(await driver.get("k")).toBe("val");
    pub.get.mockResolvedValue(null);
    expect(await driver.get("k")).toBe(null);
  });

  test("del delegates to pub.del", async () => {
    await driver.del("k");
    expect(pub.del).toHaveBeenCalledWith("k");
  });

  test("mget delegates to pub.mGet", async () => {
    pub.mGet = vi.fn().mockResolvedValue(["a", null]);
    const result = await driver.mget(["k1", "k2"]);
    expect(pub.mGet).toHaveBeenCalledWith(["k1", "k2"]);
    expect(result).toEqual(["a", null]);
  });

  test("mget returns empty array for empty keys", async () => {
    const result = await driver.mget([]);
    expect(result).toEqual([]);
  });

  test("xadd without maxLen", async () => {
    pub.xAdd.mockResolvedValue("1-0");
    await driver.xadd("s", { f: "v" });
    expect(pub.xAdd).toHaveBeenCalledWith(
      "s",
      "*",
      { f: "v" },
      { TRIM: undefined },
    );
  });

  test("xadd uses xAdd with options", async () => {
    pub.xAdd.mockResolvedValue("1-0");
    await driver.xadd("s", { f: "v" }, 100);
    expect(pub.xAdd).toHaveBeenCalledWith(
      "s",
      "*",
      { f: "v" },
      {
        TRIM: {
          strategy: "MAXLEN",
          strategyModifier: "~",
          threshold: 100,
        },
      },
    );
  });

  test("xaddBatch uses multi", async () => {
    const exec = vi.fn();
    pub.multi = vi.fn().mockReturnValue({
      xAdd: vi.fn(),
      exec,
    });
    await driver.xaddBatch([{ stream: "s1", args: { a: "1" } }], 50);
    expect(pub.multi).toHaveBeenCalled();
    expect(exec).toHaveBeenCalled();
  });

  test("xaddBatch returns early for empty messages", async () => {
    pub.multi = vi.fn();
    await driver.xaddBatch([]);
    expect(pub.multi).not.toHaveBeenCalled();
  });

  test("xread uses xRead with options", async () => {
    const mockResult = [
      { name: "s", messages: [{ id: "1-0", message: { k: "v" } }] },
    ];
    pub.xRead.mockResolvedValue(mockResult);

    const res = await driver.xread([{ key: "s", id: "0" }], 5, 1000);
    expect(pub.xRead).toHaveBeenCalledWith([{ key: "s", id: "0" }], {
      COUNT: 5,
      BLOCK: 1000,
    });
    expect(res).toEqual([
      { stream: "s", messages: [{ id: "1-0", data: { k: "v" } }] },
    ]);

    // Empty result
    pub.xRead.mockResolvedValue(null);
    expect(await driver.xread([{ key: "s", id: "0" }])).toBeNull();

    // Empty array result
    pub.xRead.mockResolvedValue([]);
    expect(await driver.xread([{ key: "s", id: "0" }])).toBeNull();
  });

  test("xread uses blocking client when block is set", async () => {
    const blockingClient = {
      xRead: vi
        .fn()
        .mockResolvedValue([
          { name: "s", messages: [{ id: "1-0", message: { k: "v" } }] },
        ]),
    };
    const driverWithBlocking = new NodeRedisDriver(pub, sub, blockingClient);
    await driverWithBlocking.xread([{ key: "s", id: "0" }], 5, 1000);
    expect(blockingClient.xRead).toHaveBeenCalled();
    expect(pub.xRead).not.toHaveBeenCalled();
  });

  test("xlen delegates to pub.xLen", async () => {
    pub.xLen = vi.fn().mockResolvedValue(10);
    const result = await driver.xlen("mystream");
    expect(pub.xLen).toHaveBeenCalledWith("mystream");
    expect(result).toBe(10);
  });

  test("disconnect calls disconnect", async () => {
    await driver.disconnect();
    expect(pub.disconnect).toHaveBeenCalled();
    expect(sub.disconnect).toHaveBeenCalled();
  });

  test("setPresenceBatch uses multi", async () => {
    const exec = vi.fn();
    pub.multi = vi.fn().mockReturnValue({
      set: vi.fn(),
      exec,
    });
    await driver.setPresenceBatch([
      { key: "p:1", value: "n1", ttlSeconds: 60 },
    ]);
    expect(pub.multi).toHaveBeenCalled();
    expect(exec).toHaveBeenCalled();
  });

  test("setPresenceBatch returns early for empty entries", async () => {
    pub.multi = vi.fn();
    await driver.setPresenceBatch([]);
    expect(pub.multi).not.toHaveBeenCalled();
  });

  test("expire delegates to pub.expire", async () => {
    pub.expire = vi.fn();
    await driver.expire("key", 60);
    expect(pub.expire).toHaveBeenCalledWith("key", 60);
  });

  test("onError subscribes and returns unsubscribe function", () => {
    const handler = vi.fn();
    const unsub = driver.onError(handler);
    expect(pub.on).toHaveBeenCalledWith("error", handler);

    unsub();
    expect(pub.removeListener).toHaveBeenCalledWith("error", handler);
  });

  test("onReconnect subscribes and returns unsubscribe function", () => {
    const handler = vi.fn();
    const unsub = driver.onReconnect(handler);
    expect(pub.on).toHaveBeenCalledWith("connect", handler);

    unsub();
    expect(pub.removeListener).toHaveBeenCalledWith("connect", handler);
  });
});

describe("createDriver", () => {
  test("detects NodeRedis via isOpen", () => {
    const mockNodeRedis = { isOpen: true, subscribe: () => {} };
    const d = createDriver(mockNodeRedis, mockNodeRedis);
    expect(d).toBeInstanceOf(NodeRedisDriver);
  });

  test("defaults to IoRedisDriver", () => {
    const mockIoRedis = { on: () => {} };
    const d = createDriver(mockIoRedis, mockIoRedis);
    expect(d).toBeInstanceOf(IoRedisDriver);
  });
});
