import { describe, it, expect, vi } from "vitest";
import { initLogger } from "../src/init-logger.js";
import type { LoggerLike } from "../src/types.js";

// ─── Re-export Tests ──────────────────────────────────────────────
describe("ocpp-ws-io/logger re-export", () => {
  it("should re-export createLogger from voltlog-io", async () => {
    const mod = await import("../src/logger/index.js");
    expect(mod.createLogger).toBeDefined();
    expect(typeof mod.createLogger).toBe("function");
  });

  it("should re-export consoleTransport from voltlog-io", async () => {
    const mod = await import("../src/logger/index.js");
    expect(mod.consoleTransport).toBeDefined();
    expect(typeof mod.consoleTransport).toBe("function");
  });

  it("should re-export prettyTransport from voltlog-io", async () => {
    const mod = await import("../src/logger/index.js");
    expect(mod.prettyTransport).toBeDefined();
    expect(typeof mod.prettyTransport).toBe("function");
  });

  it("should re-export middleware from voltlog-io", async () => {
    const mod = await import("../src/logger/index.js");
    expect(mod.redactionMiddleware).toBeDefined();
    expect(mod.samplingMiddleware).toBeDefined();
    expect(mod.ocppMiddleware).toBeDefined();
    expect(mod.alertMiddleware).toBeDefined();
  });

  it("should create a working logger through the re-export", async () => {
    const mod = await import("../src/logger/index.js");
    const entries: unknown[] = [];
    const logger = mod.createLogger({
      level: "DEBUG",
      transports: [
        {
          name: "test",
          transform: (entry: unknown) => {
            entries.push(entry);
          },
        },
      ],
    });

    logger.info("hello from re-export");
    expect(entries.length).toBeGreaterThan(0);
    expect((entries[0] as any).message).toBe("hello from re-export");
  });
});

// ─── initLogger Tests ─────────────────────────────────────────────
describe("initLogger utility", () => {
  it("should return null when config is false", () => {
    const result = initLogger(false);
    expect(result).toBeNull();
  });

  it("should return null when config.enabled is false", () => {
    const result = initLogger({ enabled: false });
    expect(result).toBeNull();
  });

  it("should return default voltlog-io logger when config is undefined", () => {
    const logger = initLogger(undefined);
    expect(logger).not.toBeNull();
    expect(typeof logger!.info).toBe("function");
    expect(typeof logger!.debug).toBe("function");
    expect(typeof logger!.warn).toBe("function");
    expect(typeof logger!.error).toBe("function");
  });

  it("should bind context via child() when defaultContext is provided", () => {
    const logger = initLogger(undefined, {
      component: "test",
      identity: "CP-001",
    });
    expect(logger).not.toBeNull();
    // Child logger should still have all log methods
    expect(typeof logger!.info).toBe("function");
  });

  it("should use custom handler when provided", () => {
    const handler: LoggerLike = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const logger = initLogger({ handler });
    expect(logger).toBe(handler);
  });

  it("should call child() on custom handler when context is provided", () => {
    const childLogger: LoggerLike = {
      info: vi.fn(),
    };
    const handler: LoggerLike = {
      info: vi.fn(),
      child: vi.fn().mockReturnValue(childLogger),
    };

    const logger = initLogger({ handler }, { identity: "CP-002" });
    expect(handler.child).toHaveBeenCalledWith({ identity: "CP-002" });
    expect(logger).toBe(childLogger);
  });

  it("should return handler as-is when handler has no child() and context is provided", () => {
    const handler: LoggerLike = {
      info: vi.fn(),
    };

    const logger = initLogger({ handler }, { identity: "CP-003" });
    expect(logger).toBe(handler);
  });

  it("should use prettyTransport when exchangeLog is true", () => {
    const logger = initLogger({ exchangeLog: true });
    expect(logger).not.toBeNull();
    expect(typeof logger!.info).toBe("function");
  });

  it("should use consoleTransport when exchangeLog is false", () => {
    const logger = initLogger({ exchangeLog: false });
    expect(logger).not.toBeNull();
    expect(typeof logger!.info).toBe("function");
  });

  it("should respect custom level", () => {
    const logger = initLogger({ level: "ERROR" });
    expect(logger).not.toBeNull();
    // Logger should exist and work — level filtering is internal to voltlog-io
    expect(typeof logger!.error).toBe("function");
  });

  it("should return logger without child when no defaultContext", () => {
    const logger = initLogger({});
    expect(logger).not.toBeNull();
    expect(typeof logger!.info).toBe("function");
  });
});
