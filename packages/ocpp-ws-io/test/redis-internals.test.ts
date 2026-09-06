import { describe, expect, test, vi } from "vitest";
import { IoRedisDriver, NodeRedisDriver } from "../src/adapters/redis/helpers.js";
import { RedisAdapter } from "../src/adapters/redis/index.js";

/** Minimal ioredis-shaped stub. */
function ioredisStub(overrides: Record<string, unknown> = {}) {
  return {
    pipeline: vi.fn(() => {
      const cmds: unknown[] = [];
      const p = {
        set: vi.fn(() => p),
        xadd: vi.fn(() => p),
        exec: vi.fn(async () => cmds),
        _cmds: cmds,
      };
      return p;
    }),
    set: vi.fn(async () => "OK"),
    get: vi.fn(async () => null),
    mget: vi.fn(async (...keys: string[]) => keys.map(() => null)),
    del: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    xadd: vi.fn(async () => "1-1"),
    xread: vi.fn(async () => null),
    xlen: vi.fn(async () => 0),
    publish: vi.fn(async () => 1),
    subscribe: vi.fn(async () => 1),
    unsubscribe: vi.fn(async () => 1),
    on: vi.fn(),
    removeListener: vi.fn(),
    quit: vi.fn(async () => "OK"),
    ...overrides,
  };
}

describe("redis driver internals", () => {
  // pipeline.exec() resolves with per-command results rather than rejecting, so
  // discarding the reply reported a total failure to the caller as success.
  test("a failed command in a pipeline surfaces instead of reporting success", async () => {
    const pub = ioredisStub({
      pipeline: vi.fn(() => {
        const p: Record<string, unknown> = {};
        p.set = vi.fn(() => p);
        p.exec = vi.fn(async () => [
          [null, "OK"],
          [new Error("READONLY You can't write against a read only replica"), null],
        ]);
        return p;
      }),
    });
    const driver = new IoRedisDriver(pub as never, ioredisStub() as never);

    await expect(
      driver.setPresenceBatch([
        { key: "a", value: "1", ttlSeconds: 10 },
        { key: "b", value: "2", ttlSeconds: 10 },
      ]),
    ).rejects.toThrow(/READONLY/);
  });

  test("a clean pipeline still resolves", async () => {
    const pub = ioredisStub();
    const driver = new IoRedisDriver(pub as never, ioredisStub() as never);
    await expect(
      driver.setPresenceBatch([{ key: "a", value: "1", ttlSeconds: 10 }]),
    ).resolves.toBeUndefined();
  });

  // The blocking client is a third connection and was never closed: a leaked
  // Redis connection per adapter, and an open socket keeping Node alive.
  test("disconnect closes the blocking client too", async () => {
    const pub = ioredisStub();
    const sub = ioredisStub();
    const blocking = ioredisStub();
    const driver = new IoRedisDriver(
      pub as never,
      sub as never,
      blocking as never,
    );

    await driver.disconnect();

    expect(pub.quit).toHaveBeenCalled();
    expect(sub.quit).toHaveBeenCalled();
    expect(blocking.quit).toHaveBeenCalled();
  });

  test("node-redis disconnect closes the blocking client too", async () => {
    const mk = () => ({
      disconnect: vi.fn(async () => {}),
      on: vi.fn(),
      removeListener: vi.fn(),
      subscribe: vi.fn(async () => {}),
      unsubscribe: vi.fn(async () => {}),
    });
    const pub = mk();
    const sub = mk();
    const blocking = mk();
    const driver = new NodeRedisDriver(
      pub as never,
      sub as never,
      blocking as never,
    );

    await driver.disconnect();
    expect(blocking.disconnect).toHaveBeenCalled();
  });

  // ioredis can hand back an empty array where node-redis returns nil. The poll
  // loop treats a truthy result as "got something", so an empty array skipped
  // its backoff sleep and spun the loop hot.
  test("an empty XREAD reads as no-data, matching the other driver", async () => {
    const pub = ioredisStub({ xread: vi.fn(async () => []) });
    const driver = new IoRedisDriver(pub as never, ioredisStub() as never);
    await expect(driver.xread([{ key: "s", id: "0" }])).resolves.toBeNull();
  });

  // Unbounded batches occupy the Redis event loop for everyone else on the
  // instance — one presence refresh used to be a single 100k-command pipeline.
  test("large batches are split into several pipelines", async () => {
    const pub = ioredisStub();
    const driver = new IoRedisDriver(pub as never, ioredisStub() as never);

    await driver.setPresenceBatch(
      Array.from({ length: 1200 }, (_, i) => ({
        key: `k${i}`,
        value: "n",
        ttlSeconds: 10,
      })),
    );

    expect(pub.pipeline.mock.calls.length).toBeGreaterThan(1);
  });

  test("large MGETs are split as well", async () => {
    const pub = ioredisStub();
    const driver = new IoRedisDriver(pub as never, ioredisStub() as never);

    const out = await driver.mget(Array.from({ length: 1200 }, (_, i) => `k${i}`));

    expect(out).toHaveLength(1200);
    expect(pub.mget.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("RedisAdapter logging", () => {
  function mockDriver() {
    return {
      publish: vi.fn(async () => {}),
      subscribe: vi.fn(async () => {}),
      unsubscribe: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      set: vi.fn(async () => {}),
      get: vi.fn(async () => null),
      mget: vi.fn(async () => []),
      del: vi.fn(async () => {}),
      setPresenceBatch: vi.fn(async () => {}),
      expire: vi.fn(async () => {}),
      xadd: vi.fn(async () => "1-1"),
      xaddBatch: vi.fn(async () => {}),
      xread: vi.fn(async () => null),
      xlen: vi.fn(async () => 0),
      onError: vi.fn((h: (e: Error) => void) => {
        (mockDriver as never as { _h?: unknown })._h = h;
        return () => {};
      }),
    };
  }

  // Errors went to a hardcoded console.error, invisible to structured logging.
  test("connection errors go to the supplied logger", async () => {
    const error = vi.fn();
    let captured: ((e: Error) => void) | undefined;
    const driver = {
      ...mockDriver(),
      onError: (h: (e: Error) => void) => {
        captured = h;
        return () => {};
      },
    };

    const adapter = new RedisAdapter({
      driver: driver as never,
      logger: { error, warn: vi.fn() },
    });

    captured?.(new Error("connection refused"));

    expect(error).toHaveBeenCalled();
    expect(String(error.mock.calls[0][0])).toContain("Redis connection error");
    await adapter.disconnect();
  });

  test("metrics report stream-poll health", async () => {
    const adapter = new RedisAdapter({ driver: mockDriver() as never });
    const m = await adapter.metrics();
    expect(m).toHaveProperty("pollErrors", 0);
    await adapter.disconnect();
  });
});
