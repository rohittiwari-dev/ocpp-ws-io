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
