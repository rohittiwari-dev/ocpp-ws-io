import { describe, it, expect, vi } from "vitest";
import {
  createDriver,
  IoRedisDriver,
  NodeRedisDriver,
} from "../src/adapters/redis/helpers.js";

describe("Redis Driver Factory", () => {
  it("should detect Node Redis v4 client", () => {
    const mockNodeRedis = {
      isOpen: true,
      subscribe: vi.fn(),
      publish: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
    };

    const driver = createDriver(mockNodeRedis, mockNodeRedis);
    expect(driver).toBeInstanceOf(NodeRedisDriver);
  });

  it("should detect IoRedis client (default)", () => {
    const mockIoRedis = {
      // No isOpen property
      on: vi.fn(),
      subscribe: vi.fn(),
      publish: vi.fn(),
      unsubscribe: vi.fn(),
      quit: vi.fn(),
    };

    const driver = createDriver(mockIoRedis, mockIoRedis);
    expect(driver).toBeInstanceOf(IoRedisDriver);
  });

  it("should fallback to IoRedisDriver for unknown objects", () => {
    const unknownClient = {
      something: "else",
    };
    // @ts-ignore
    const driver = createDriver(unknownClient, unknownClient);
    expect(driver).toBeInstanceOf(IoRedisDriver);
  });
});

// ─── M2 / M1 / M3 / M4 — adapter-level driver behavior ──────────

import { RedisAdapter } from "../src/adapters/redis/index.js";
import type { RedisPubSubDriver } from "../src/adapters/redis/helpers.js";

function stubDriver(
  overrides: Partial<RedisPubSubDriver> = {},
): RedisPubSubDriver {
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
    ...overrides,
  };
}

describe("RedisAdapter driver option (M2)", () => {
  it("uses a provided driver directly", async () => {
    const driver = stubDriver();
    const adapter = new RedisAdapter({ driver });
    await adapter.publish("ocpp:broadcast", { hello: 1 });
    expect(driver.publish).toHaveBeenCalledWith(
      "ocpp-ws-io:ocpp:broadcast",
      JSON.stringify({ hello: 1 }),
    );
    await adapter.disconnect();
  });

  it("throws without driver or pub/sub clients", () => {
    expect(() => new RedisAdapter({} as any)).toThrow(/driver|pubClient/i);
  });
});

describe("non-blocking poll fallback (M1)", () => {
  it("polls without BLOCK when the driver has no blocking client", async () => {
    const driver = stubDriver(); // hasBlockingClient undefined → no blocking
    const adapter = new RedisAdapter({ driver });
    await adapter.subscribe("ocpp:node:n1", () => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(driver.xread).toHaveBeenCalled();
    const lastArgs = (driver.xread as any).mock.calls.at(-1);
    expect(lastArgs[2]).toBeUndefined(); // no BLOCK
    await adapter.disconnect();
  });

  it("polls with BLOCK 1000 when a blocking client exists", async () => {
    // Real blocking XREADs wait server-side; emulate that so the poll loop
    // doesn't hot-spin against an instantly-resolving stub.
    const driver = stubDriver({
      hasBlockingClient: true,
      xread: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return null;
      }),
    } as any);
    const adapter = new RedisAdapter({ driver });
    await adapter.subscribe("ocpp:node:n2", () => {});
    await new Promise((r) => setTimeout(r, 50));
    const lastArgs = (driver.xread as any).mock.calls.at(-1);
    expect(lastArgs[2]).toBe(1000);
    await adapter.disconnect();
  });
});

describe("publish does not mutate payloads (M3)", () => {
  it("no __seq is injected into unicast payloads", async () => {
    const driver = stubDriver();
    const adapter = new RedisAdapter({ driver });
    const payload = {
      source: "n1",
      target: "CP-1",
      method: "Reset",
      params: {},
    };
    await adapter.publish("ocpp:node:abc", payload);
    expect("__seq" in payload).toBe(false);
    const xaddArgs = (driver.xadd as any).mock.calls[0];
    expect(JSON.parse(xaddArgs[1].message)).not.toHaveProperty("__seq");
    await adapter.disconnect();
  });
});

describe("stream offset preservation (M4)", () => {
  it("re-subscribe resumes after the last consumed id (no replay)", async () => {
    const driver = stubDriver();
    const adapter = new RedisAdapter({ driver });
    await adapter.subscribe("ocpp:node:n3", () => {});
    const offsets = (adapter as any)._streamOffsets as Map<string, string>;
    const key = "ocpp-ws-io:ocpp:node:n3";
    offsets.set(key, "42-1"); // simulate consumed messages

    await adapter.unsubscribe("ocpp:node:n3");
    await adapter.subscribe("ocpp:node:n3", () => {});

    expect(offsets.get(key)).toBe("42-1"); // not reset to "0"
    await adapter.disconnect();
  });
});
