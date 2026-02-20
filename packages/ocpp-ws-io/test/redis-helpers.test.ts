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

  test("set with TTL", async () => {
    await driver.set("k", "v", 10);
    expect(pub.set).toHaveBeenCalledWith("k", "v", { EX: 10 });
  });

  test("xadd uses xAdd with options", async () => {
    pub.xAdd.mockResolvedValue("1-0");
    await driver.xadd("s", { f: "v" }, 100);
    // Verify arguments structure matches Node Redis v4
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
  });

  test("disconnect calls disconnect", async () => {
    await driver.disconnect();
    expect(pub.disconnect).toHaveBeenCalled();
    expect(sub.disconnect).toHaveBeenCalled();
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
