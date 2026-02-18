import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createLogger,
  redactionMiddleware,
  samplingMiddleware,
  ocppMiddleware,
  alertMiddleware,
  type LogEntry,
  type Transformer,
  type OcppExchangeMeta,
} from "../src/index.js";

describe("Middleware", () => {
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

  describe("redactionMiddleware", () => {
    it("should redact specified fields", () => {
      const logger = createLogger({
        transports: [testTransport],
        middleware: [redactionMiddleware({ paths: ["password", "idToken"] })],
      });

      logger.info("auth", {
        password: "s3cret",
        user: "admin",
        idToken: "tok123",
      } as any);
      expect(entries[0]!.meta).toEqual({
        password: "[REDACTED]",
        user: "admin",
        idToken: "[REDACTED]",
      });
    });

    it("should be case-insensitive", () => {
      const logger = createLogger({
        transports: [testTransport],
        middleware: [redactionMiddleware({ paths: ["password"] })],
      });

      logger.info("auth", { Password: "secret" } as any);
      expect((entries[0]!.meta as any).Password).toBe("[REDACTED]");
    });

    it("should deep redact nested objects", () => {
      const logger = createLogger({
        transports: [testTransport],
        middleware: [redactionMiddleware({ paths: ["password"] })],
      });

      logger.info("nested", {
        user: { password: "secret", name: "admin" },
      } as any);
      expect((entries[0]!.meta as any).user.password).toBe("[REDACTED]");
      expect((entries[0]!.meta as any).user.name).toBe("admin");
    });

    it("should use custom replacement value", () => {
      const logger = createLogger({
        transports: [testTransport],
        middleware: [
          redactionMiddleware({ paths: ["password"], replacement: "***" }),
        ],
      });

      logger.info("auth", { password: "secret" } as any);
      expect((entries[0]!.meta as any).password).toBe("***");
    });

    it("should redact context fields too", () => {
      const logger = createLogger({
        transports: [testTransport],
        middleware: [redactionMiddleware({ paths: ["secret"] })],
        context: { secret: "hidden" },
      });

      logger.info("test");
      expect(entries[0]!.context!.secret).toBe("[REDACTED]");
    });
  });

  describe("samplingMiddleware", () => {
    it("should allow entries under the limit", () => {
      const logger = createLogger({
        transports: [testTransport],
        middleware: [samplingMiddleware({ maxPerWindow: 3, windowMs: 60_000 })],
      });

      logger.info("msg1");
      logger.info("msg2");
      logger.info("msg3");
      expect(entries).toHaveLength(3);
    });

    it("should drop entries over the limit with same key", () => {
      const logger = createLogger({
        transports: [testTransport],
        middleware: [samplingMiddleware({ maxPerWindow: 2, windowMs: 60_000 })],
      });

      logger.info("same");
      logger.info("same");
      logger.info("same"); // should be dropped
      expect(entries).toHaveLength(2);
    });

    it("should use custom key function", () => {
      const logger = createLogger<{ action: string }>({
        transports: [testTransport as any],
        middleware: [
          samplingMiddleware({
            keyFn: (e) => (e.meta as any).action ?? "",
            maxPerWindow: 1,
            windowMs: 60_000,
          }),
        ],
      });

      logger.info("a", { action: "Boot" });
      logger.info("b", { action: "Boot" }); // dropped
      logger.info("c", { action: "Heartbeat" }); // different key — allowed
      expect(entries).toHaveLength(2);
    });
  });

  describe("ocppMiddleware", () => {
    it("should propagate correlationId to entry level", () => {
      const logger = createLogger<OcppExchangeMeta>({
        transports: [testTransport as any],
        middleware: [ocppMiddleware() as any],
      });

      logger.info("msg", { correlationId: "uuid-123", action: "Boot" });
      expect(entries[0]!.correlationId).toBe("uuid-123");
    });

    it("should auto-compute payloadSize", () => {
      const logger = createLogger<OcppExchangeMeta>({
        transports: [testTransport as any],
        middleware: [ocppMiddleware() as any],
      });

      logger.info("msg", { action: "Boot", messageType: "CALL" });
      expect(entries[0]!.meta).toHaveProperty("payloadSize");
      expect(typeof (entries[0]!.meta as any).payloadSize).toBe("number");
    });
  });

  describe("alertMiddleware", () => {
    it("should fire alert when threshold is met", () => {
      const alertFn = vi.fn();

      const logger = createLogger({
        transports: [testTransport],
        middleware: [
          alertMiddleware([
            {
              name: "error-alert",
              when: (e) => e.level >= 50,
              threshold: 2,
              onAlert: alertFn,
            },
          ]),
        ],
      });

      logger.error("err1");
      expect(alertFn).not.toHaveBeenCalled();
      logger.error("err2");
      expect(alertFn).toHaveBeenCalledTimes(1);
      expect(alertFn).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ message: "err1" }),
          expect.objectContaining({ message: "err2" }),
        ]),
      );
    });

    it("should not fire for non-matching entries", () => {
      const alertFn = vi.fn();

      const logger = createLogger({
        transports: [testTransport],
        middleware: [
          alertMiddleware([
            {
              name: "error-only",
              when: (e) => e.level >= 50,
              threshold: 1,
              onAlert: alertFn,
            },
          ]),
        ],
      });

      logger.info("info");
      expect(alertFn).not.toHaveBeenCalled();
    });

    it("should respect cooldown", () => {
      const alertFn = vi.fn();
      let now = 1000;

      const logger = createLogger({
        transports: [testTransport],
        timestamp: () => now,
        middleware: [
          alertMiddleware([
            {
              name: "cd-test",
              when: () => true,
              threshold: 1,
              cooldownMs: 5000,
              onAlert: alertFn,
            },
          ]),
        ],
      });

      logger.info("first");
      expect(alertFn).toHaveBeenCalledTimes(1);

      now = 2000; // within cooldown
      logger.info("second");
      expect(alertFn).toHaveBeenCalledTimes(1); // still 1

      now = 7000; // past cooldown
      logger.info("third");
      expect(alertFn).toHaveBeenCalledTimes(2);
    });

    it("should always pass entries through (never drop)", () => {
      const logger = createLogger({
        transports: [testTransport],
        middleware: [
          alertMiddleware([
            {
              name: "pass-through",
              when: () => true,
              threshold: 100, // high threshold
              onAlert: vi.fn(),
            },
          ]),
        ],
      });

      logger.info("test");
      expect(entries).toHaveLength(1); // entry passes through
    });
  });
});
