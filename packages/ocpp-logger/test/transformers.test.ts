import { describe, it, expect, vi, beforeEach } from "vitest";
import { Writable } from "node:stream";
import {
  createLogger,
  consoleTransport,
  prettyTransport,
  jsonStreamTransport,
  batchTransport,
  type LogEntry,
  type Transformer,
} from "../src/index.js";

describe("Transformers", () => {
  describe("consoleTransport", () => {
    it("should output JSON to console", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      const logger = createLogger({
        transports: [consoleTransport({ useConsoleLevels: false })],
      });
      logger.info("hello");

      expect(spy).toHaveBeenCalledTimes(1);
      const output = spy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.message).toBe("hello");
      expect(parsed.levelName).toBe("INFO");

      spy.mockRestore();
    });

    it("should use console.error for ERROR level", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      const logger = createLogger({
        transports: [consoleTransport()],
      });
      logger.error("oops");

      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("should use console.warn for WARN level", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const logger = createLogger({
        transports: [consoleTransport()],
      });
      logger.warn("careful");

      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("should accept custom formatter", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      const logger = createLogger({
        transports: [
          consoleTransport({
            useConsoleLevels: false,
            formatter: (entry) => `[${entry.levelName}] ${entry.message}`,
          }),
        ],
      });
      logger.info("custom");

      expect(spy).toHaveBeenCalledWith("[INFO] custom");
      spy.mockRestore();
    });
  });

  describe("prettyTransport", () => {
    it("should output human-readable format", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      const logger = createLogger({
        transports: [prettyTransport({ colors: false })],
      });
      logger.info("Server started");

      expect(spy).toHaveBeenCalledTimes(1);
      const output = spy.mock.calls[0]![0] as string;
      expect(output).toContain("INFO");
      expect(output).toContain("Server started");

      spy.mockRestore();
    });

    it("should format OCPP exchange logs", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      const logger = createLogger({
        transports: [prettyTransport({ colors: false })],
      });
      logger.info("exchange", {
        chargePointId: "CP-101",
        action: "BootNotification",
        messageType: "CALL",
        direction: "IN",
      } as any);

      expect(spy).toHaveBeenCalledTimes(1);
      const output = spy.mock.calls[0]![0] as string;
      expect(output).toContain("CP-101");
      expect(output).toContain("BootNotification");
      expect(output).toContain("CALL");

      spy.mockRestore();
    });
  });

  describe("jsonStreamTransport", () => {
    it("should write NDJSON to stream", () => {
      const chunks: string[] = [];
      const writable = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk.toString());
          callback();
        },
      });

      const logger = createLogger({
        transports: [jsonStreamTransport({ stream: writable })],
      });
      logger.info("line1");
      logger.info("line2");

      expect(chunks).toHaveLength(2);
      expect(JSON.parse(chunks[0]!).message).toBe("line1");
      expect(JSON.parse(chunks[1]!).message).toBe("line2");
    });

    it("should accept custom serializer", () => {
      const chunks: string[] = [];
      const writable = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk.toString());
          callback();
        },
      });

      const logger = createLogger({
        transports: [
          jsonStreamTransport({
            stream: writable,
            serializer: (entry) => `${entry.levelName}: ${entry.message}\n`,
          }),
        ],
      });
      logger.info("test");

      expect(chunks[0]).toBe("INFO: test\n");
    });
  });

  describe("batchTransport", () => {
    it("should buffer entries and flush at batch size", () => {
      const results: LogEntry[] = [];
      const inner: Transformer = {
        name: "inner",
        transform(entry) {
          results.push(entry);
        },
      };

      const logger = createLogger({
        transports: [
          batchTransport(inner, { batchSize: 3, flushIntervalMs: 60000 }),
        ],
      });

      logger.info("1");
      logger.info("2");
      expect(results).toHaveLength(0); // not yet flushed

      logger.info("3"); // triggers flush
      expect(results).toHaveLength(3);
    });

    it("should flush remaining on explicit flush", async () => {
      const results: LogEntry[] = [];
      const inner: Transformer = {
        name: "inner",
        transform(entry) {
          results.push(entry);
        },
      };

      const logger = createLogger({
        transports: [
          batchTransport(inner, { batchSize: 100, flushIntervalMs: 60000 }),
        ],
      });

      logger.info("partial");
      expect(results).toHaveLength(0);

      await logger.flush();
      expect(results).toHaveLength(1);
    });
  });
});
