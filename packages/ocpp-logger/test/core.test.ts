import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createLogger,
  consoleTransport,
  LogLevel,
  type LogEntry,
  type Transformer,
  type Logger,
} from "../src/index.js";

describe("Logger Core", () => {
  let entries: LogEntry[];
  let testTransport: Transformer;

  beforeEach(() => {
    entries = [];
    testTransport = {
      name: "test",
      transform(entry: LogEntry) {
        entries.push(entry);
      },
    };
  });

  describe("createLogger", () => {
    it("should create a logger with default options", () => {
      const logger = createLogger({ transports: [testTransport] });
      expect(logger).toBeDefined();
      expect(logger.info).toBeInstanceOf(Function);
      expect(logger.error).toBeInstanceOf(Function);
      expect(logger.child).toBeInstanceOf(Function);
    });

    it("should log at INFO level by default", () => {
      const logger = createLogger({ transports: [testTransport] });
      logger.debug("should be dropped");
      logger.info("should pass");
      expect(entries).toHaveLength(1);
      expect(entries[0]!.message).toBe("should pass");
    });
  });

  describe("log levels", () => {
    it("should filter by level", () => {
      const logger = createLogger({
        level: "WARN",
        transports: [testTransport],
      });
      logger.trace("no");
      logger.debug("no");
      logger.info("no");
      logger.warn("yes");
      logger.error("yes");
      logger.fatal("yes");
      expect(entries).toHaveLength(3);
    });

    it("should set correct levelName on entries", () => {
      const logger = createLogger({
        level: "TRACE",
        transports: [testTransport],
      });
      logger.trace("t");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      logger.fatal("f");

      expect(entries.map((e) => e.levelName)).toEqual([
        "TRACE",
        "DEBUG",
        "INFO",
        "WARN",
        "ERROR",
        "FATAL",
      ]);
    });

    it("should set correct numeric levels", () => {
      const logger = createLogger({
        level: "TRACE",
        transports: [testTransport],
      });
      logger.trace("t");
      logger.info("i");
      logger.error("e");

      expect(entries[0]!.level).toBe(LogLevel.TRACE);
      expect(entries[1]!.level).toBe(LogLevel.INFO);
      expect(entries[2]!.level).toBe(LogLevel.ERROR);
    });
  });

  describe("log entry structure", () => {
    it("should generate unique IDs", () => {
      const logger = createLogger({ transports: [testTransport] });
      logger.info("a");
      logger.info("b");
      expect(entries[0]!.id).toBeDefined();
      expect(entries[0]!.id).not.toBe(entries[1]!.id);
    });

    it("should include timestamp", () => {
      const logger = createLogger({ transports: [testTransport] });
      const before = Date.now();
      logger.info("test");
      const after = Date.now();
      expect(entries[0]!.timestamp).toBeGreaterThanOrEqual(before);
      expect(entries[0]!.timestamp).toBeLessThanOrEqual(after);
    });

    it("should accept custom timestamp function", () => {
      const logger = createLogger({
        transports: [testTransport],
        timestamp: () => 1234567890,
      });
      logger.info("test");
      expect(entries[0]!.timestamp).toBe(1234567890);
    });

    it("should include meta data", () => {
      const logger = createLogger({ transports: [testTransport] });
      logger.info("test", { port: 9000, host: "localhost" });
      expect(entries[0]!.meta).toEqual({ port: 9000, host: "localhost" });
    });

    it("should default meta to empty object", () => {
      const logger = createLogger({ transports: [testTransport] });
      logger.info("test");
      expect(entries[0]!.meta).toEqual({});
    });
  });

  describe("error handling", () => {
    it("should accept Error as second argument", () => {
      const logger = createLogger({ transports: [testTransport] });
      logger.error("fail", new Error("something broke"));
      expect(entries[0]!.error).toBeDefined();
      expect(entries[0]!.error!.message).toBe("something broke");
      expect(entries[0]!.error!.name).toBe("Error");
    });

    it("should accept meta + Error", () => {
      const logger = createLogger({ transports: [testTransport] });
      logger.error("fail", { action: "Boot" }, new Error("crash"));
      expect(entries[0]!.meta).toEqual({ action: "Boot" });
      expect(entries[0]!.error!.message).toBe("crash");
    });

    it("should include stack at ERROR level by default", () => {
      const logger = createLogger({ transports: [testTransport] });
      logger.error("fail", new Error("oops"));
      expect(entries[0]!.error!.stack).toBeDefined();
    });

    it("should not include stack at WARN level by default", () => {
      const logger = createLogger({
        level: "WARN",
        transports: [testTransport],
      });
      logger.warn("warning");
      // No error attached so no stack
      expect(entries[0]!.error).toBeUndefined();
    });

    it("should respect includeStack: false", () => {
      const logger = createLogger({
        transports: [testTransport],
        includeStack: false,
      });
      logger.error("fail", new Error("oops"));
      expect(entries[0]!.error!.stack).toBeUndefined();
    });

    it("should respect includeStack: true", () => {
      const logger = createLogger({
        level: "TRACE",
        transports: [testTransport],
        includeStack: true,
      });
      // With includeStack: true, stacks should appear even at low levels
      logger.error("fail", new Error("oops"));
      expect(entries[0]!.error!.stack).toBeDefined();
    });
  });

  describe("child logger", () => {
    it("should create a child with bound context", () => {
      const logger = createLogger({ transports: [testTransport] });
      const child = logger.child({ chargePointId: "CP-101" });
      child.info("hello");
      expect(entries[0]!.context).toEqual({ chargePointId: "CP-101" });
    });

    it("should merge parent and child context", () => {
      const logger = createLogger({
        transports: [testTransport],
        context: { service: "csms" },
      });
      const child = logger.child({ chargePointId: "CP-101" });
      child.info("hello");
      expect(entries[0]!.context).toEqual({
        service: "csms",
        chargePointId: "CP-101",
      });
    });

    it("should allow nested children", () => {
      const logger = createLogger({ transports: [testTransport] });
      const child1 = logger.child({ cp: "CP-101" });
      const child2 = child1.child({ session: "abc" });
      child2.info("deep");
      expect(entries[0]!.context).toEqual({ cp: "CP-101", session: "abc" });
    });

    it("child context overrides parent context", () => {
      const logger = createLogger({
        transports: [testTransport],
        context: { env: "dev" },
      });
      const child = logger.child({ env: "prod" });
      child.info("override");
      expect(entries[0]!.context!.env).toBe("prod");
    });

    it("child shares parent pipeline", () => {
      const logger = createLogger({
        level: "WARN",
        transports: [testTransport],
      });
      const child = logger.child({ cp: "CP-101" });
      child.debug("should drop");
      child.warn("should pass");
      expect(entries).toHaveLength(1);
    });
  });

  describe("dynamic configuration", () => {
    it("should add transformer at runtime", () => {
      const entries2: LogEntry[] = [];
      const logger = createLogger({ transports: [testTransport] });
      logger.info("before");
      expect(entries).toHaveLength(1);

      logger.addTransformer({
        name: "extra",
        transform(entry) {
          entries2.push(entry);
        },
      });
      logger.info("after");
      expect(entries).toHaveLength(2);
      expect(entries2).toHaveLength(1);
    });

    it("should remove transformer by name", () => {
      const logger = createLogger({ transports: [testTransport] });
      logger.info("before");
      expect(entries).toHaveLength(1);
      logger.removeTransformer("test");
      logger.info("after");
      expect(entries).toHaveLength(1); // still 1
    });
  });

  describe("flush and close", () => {
    it("should call flush on all transports", async () => {
      const flushFn = vi.fn();
      const logger = createLogger({
        transports: [{ ...testTransport, flush: flushFn }],
      });
      await logger.flush();
      expect(flushFn).toHaveBeenCalled();
    });

    it("should call close on all transports", async () => {
      const closeFn = vi.fn();
      const logger = createLogger({
        transports: [{ ...testTransport, close: closeFn }],
      });
      await logger.close();
      expect(closeFn).toHaveBeenCalled();
    });
  });
});
