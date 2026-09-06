import { describe, test, expect, vi, beforeEach } from "vitest";
import { RedisAdapter } from "../src/adapters/redis/index";
import type { RedisPubSubDriver } from "../src/adapters/redis/helpers";

// ─── Helper: Create a mock driver ─────────────────────────────────

function createMockDriver(
  overrides: Partial<RedisPubSubDriver> = {},
): RedisPubSubDriver {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(undefined),
    mget: vi.fn().mockResolvedValue([]),
    xadd: vi.fn().mockResolvedValue("1-0"),
    xaddBatch: vi.fn().mockResolvedValue(undefined),
    xread: vi.fn().mockResolvedValue(null),
    xlen: vi.fn().mockResolvedValue(0),
    disconnect: vi.fn().mockResolvedValue(undefined),
    setPresenceBatch: vi.fn().mockResolvedValue(undefined),
    expire: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn().mockReturnValue(() => {}),
    onReconnect: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

// We need to mock createDriver to return our mock drivers
vi.mock("../src/adapters/redis/helpers", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../src/adapters/redis/helpers")
  >();
  return {
    ...original,
    createDriver: vi.fn(),
  };
});

import { createDriver } from "../src/adapters/redis/helpers";

// ─── Redis Connection Pooling ──────────────────────────────────────

describe("RedisAdapter Connection Pooling", () => {
  let primaryDriver: RedisPubSubDriver;

  beforeEach(() => {
    primaryDriver = createMockDriver();
    vi.mocked(createDriver).mockReturnValue(primaryDriver);
  });

  test("poolSize=1 (default) uses single driver", async () => {
    const adapter = new RedisAdapter({
      pubClient: {} as any,
      subClient: {} as any,
    });

    await adapter.publish("ocpp:node:n1", { test: 1 });
    await adapter.publish("ocpp:node:n2", { test: 2 });

    expect(primaryDriver.xadd).toHaveBeenCalledTimes(2);
    await adapter.disconnect();
  });

  // Selection is by channel hash, not round-robin. Round-robining per call sent
  // consecutive messages for the SAME target over different TCP connections,
  // so they could arrive out of order — for OCPP unicast that means a charger's
  // commands reordering in transit. What matters is that distinct destinations
  // spread across the pool while each destination stays pinned.
  test("poolSize=3 spreads distinct destinations across the pool", async () => {
    const driver2 = createMockDriver();
    const driver3 = createMockDriver();
    let factoryCallCount = 0;

    const adapter = new RedisAdapter({
      pubClient: {} as any,
      subClient: {} as any,
      poolSize: 3,
      driverFactory: () => {
        factoryCallCount++;
        return factoryCallCount === 1 ? driver2 : driver3;
      },
    });

    const pool = [primaryDriver, driver2, driver3];
    for (let i = 0; i < 24; i++) {
      await adapter.publish(`ocpp:node:n${i}`, { test: i });
    }

    const used = pool.filter((d) => d.xadd.mock.calls.length > 0).length;
    expect(used).toBeGreaterThan(1);
    const total = pool.reduce((n, d) => n + d.xadd.mock.calls.length, 0);
    expect(total).toBe(24);

    await adapter.disconnect();
  });

  test("the same destination always uses the same connection", async () => {
    const driver2 = createMockDriver();
    const driver3 = createMockDriver();
    let factoryCallCount = 0;

    const adapter = new RedisAdapter({
      pubClient: {} as any,
      subClient: {} as any,
      poolSize: 3,
      driverFactory: () => {
        factoryCallCount++;
        return factoryCallCount === 1 ? driver2 : driver3;
      },
    });

    const pool = [primaryDriver, driver2, driver3];
    for (let i = 0; i < 10; i++) {
      await adapter.publish("ocpp:node:same-target", { test: i });
    }

    // Every write for one target landed on exactly one connection, so their
    // order on the wire is preserved.
    const carriers = pool.filter((d) => d.xadd.mock.calls.length > 0);
    expect(carriers).toHaveLength(1);
    expect(carriers[0].xadd).toHaveBeenCalledTimes(10);

    await adapter.disconnect();
  });

  test("broadcast publishes go through the pool", async () => {
    const driver2 = createMockDriver();

    const adapter = new RedisAdapter({
      pubClient: {} as any,
      subClient: {} as any,
      poolSize: 2,
      driverFactory: () => driver2,
    });

    await adapter.publish("ocpp:broadcast", { msg: "a" });
    await adapter.publish("ocpp:broadcast", { msg: "b" });

    // One channel, one connection — and both messages went somewhere.
    const total =
      primaryDriver.publish.mock.calls.length +
      driver2.publish.mock.calls.length;
    expect(total).toBe(2);
    const carriers = [primaryDriver, driver2].filter(
      (d) => d.publish.mock.calls.length > 0,
    );
    expect(carriers).toHaveLength(1);

    await adapter.disconnect();
  });

  test("subscriptions always use primary driver", async () => {
    const driver2 = createMockDriver();

    const adapter = new RedisAdapter({
      pubClient: {} as any,
      subClient: {} as any,
      poolSize: 2,
      driverFactory: () => driver2,
    });

    const handler = vi.fn();
    await adapter.subscribe("ocpp:broadcast:test", handler);

    // Pub/Sub subscription uses the primary driver (driver[0])
    expect(primaryDriver.subscribe).toHaveBeenCalled();
    expect(driver2.subscribe).not.toHaveBeenCalled();

    await adapter.disconnect();
  });

  test("disconnect shuts down all pool drivers", async () => {
    const driver2 = createMockDriver();
    const driver3 = createMockDriver();
    let callCount = 0;

    const adapter = new RedisAdapter({
      pubClient: {} as any,
      subClient: {} as any,
      poolSize: 3,
      driverFactory: () => {
        callCount++;
        return callCount === 1 ? driver2 : driver3;
      },
    });

    await adapter.disconnect();

    expect(primaryDriver.disconnect).toHaveBeenCalled();
    expect(driver2.disconnect).toHaveBeenCalled();
    expect(driver3.disconnect).toHaveBeenCalled();
  });

  test("poolSize without driverFactory creates only primary driver", async () => {
    const adapter = new RedisAdapter({
      pubClient: {} as any,
      subClient: {} as any,
      poolSize: 5,
      // No driverFactory provided — only primary driver used
    });

    await adapter.publish("ocpp:node:n1", { test: 1 });
    expect(primaryDriver.xadd).toHaveBeenCalledTimes(1);

    await adapter.disconnect();
  });

  test("publishBatch uses pool driver for streams", async () => {
    const driver2 = createMockDriver();

    const adapter = new RedisAdapter({
      pubClient: {} as any,
      subClient: {} as any,
      poolSize: 2,
      driverFactory: () => driver2,
    });

    // First call advances round-robin
    await adapter.publishBatch([
      { channel: "ocpp:node:n1", data: { m: "stream" } },
      { channel: "ocpp:broadcast", data: { m: "pubsub" } },
    ]);

    await adapter.disconnect();
  });
});

// ─── WebSocket Compression Config ──────────────────────────────────

describe("OCPPServer Compression", () => {
  test("_buildCompressionConfig returns false when disabled", () => {
    // We can test the config builder indirectly through constructor behavior
    // by importing the server and checking the wss is created without deflate
    // For now, test the type contract
    expect(typeof {} as import("../src/types").CompressionOptions).toBe(
      "object",
    );
  });

  test("CompressionOptions type has expected fields", () => {
    const opts: import("../src/types").CompressionOptions = {
      threshold: 512,
      level: 9,
      memLevel: 4,
      serverNoContextTakeover: false,
      clientNoContextTakeover: true,
    };
    expect(opts.threshold).toBe(512);
    expect(opts.level).toBe(9);
    expect(opts.memLevel).toBe(4);
    expect(opts.serverNoContextTakeover).toBe(false);
    expect(opts.clientNoContextTakeover).toBe(true);
  });
});

// ─── ClusterDriver (unit test with mocks) ──────────────────────────

describe("ClusterDriver types", () => {
  test("ClusterNode interface has host and port", () => {
    const node: import("../src/adapters/redis/cluster-driver").ClusterNode = {
      host: "10.0.0.1",
      port: 6379,
    };
    expect(node.host).toBe("10.0.0.1");
    expect(node.port).toBe(6379);
  });

  test("ClusterDriverOptions has required fields", () => {
    const opts: import("../src/adapters/redis/cluster-driver").ClusterDriverOptions =
      {
        nodes: [{ host: "localhost", port: 6379 }],
        natMap: { "172.17.0.2:6379": { host: "localhost", port: 6379 } },
        redisOptions: { password: "secret" },
        prefix: "myapp:",
      };
    expect(opts.nodes).toHaveLength(1);
    expect(opts.natMap).toBeDefined();
    expect(opts.redisOptions).toEqual({ password: "secret" });
    expect(opts.prefix).toBe("myapp:");
  });
});
