import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initLogger } from "../src/init-logger";
import { type LogEntry, type LogMiddleware } from "voltlog-io";

// Mock voltlog-io
const mockCreateLogger = vi.fn();
const mockConsoleTransport = vi.fn();
const mockPrettyTransport = vi.fn();

vi.mock("voltlog-io", () => ({
  createLogger: (args: any) => mockCreateLogger(args),
  consoleTransport: (args: any) => mockConsoleTransport(args),
  prettyTransport: (args: any) => mockPrettyTransport(args),
}));

describe("initLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateLogger.mockReturnValue({ child: vi.fn(), info: vi.fn() });
  });

  it("should return null if config is false", () => {
    expect(initLogger(false)).toBeNull();
  });

  it("should return null if config.enabled is false", () => {
    expect(initLogger({ enabled: false })).toBeNull();
  });

  it("should return custom handler if provided", () => {
    const customHandler = { info: vi.fn(), child: vi.fn() } as any;
    expect(initLogger({ handler: customHandler })).toBe(customHandler);
  });

  it("should call handler.child if defaultContext provided", () => {
    const childSpy = vi.fn().mockReturnValue("childLogger");
    const customHandler = { info: vi.fn(), child: childSpy } as any;
    const ctx = { identity: "test" };

    expect(initLogger({ handler: customHandler }, ctx)).toBe("childLogger");
    expect(childSpy).toHaveBeenCalledWith(ctx);
  });

  it("should create a default logger if config is undefined", () => {
    initLogger(undefined);
    expect(mockCreateLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "INFO",
        transports: expect.any(Array),
      }),
    );
    expect(mockConsoleTransport).toHaveBeenCalled();
  });

  it("should use prettyTransport if config.prettify is true", () => {
    initLogger({ prettify: true });
    expect(mockPrettyTransport).toHaveBeenCalled();
  });

  describe("Display Middleware", () => {
    // Helper to extract the middleware created by initLogger
    const getMiddleware = (config: any): LogMiddleware | undefined => {
      initLogger(config);
      const callArgs = mockCreateLogger.mock.calls[0][0];
      return callArgs.middleware ? callArgs.middleware[0] : undefined;
    };

    const runMiddleware = (
      middleware: LogMiddleware,
      entry: LogEntry,
    ): LogEntry => {
      let result = entry;
      middleware(entry, (e) => {
        result = e;
      });
      return result;
    };

    it("should NOT attach middleware if no display options set", () => {
      const mw = getMiddleware({});
      expect(mw).toBeUndefined();
    });

    it("should attach middleware if display options set", () => {
      const mw = getMiddleware({ showMetadata: false });
      expect(mw).toBeDefined();
    });

    it("should hide source context if showSourceMeta is false", () => {
      const mw = getMiddleware({ showSourceMeta: false })!;
      const entry: LogEntry = {
        level: 30,
        message: "test",
        context: { component: "Comp" },
        meta: {},
        timestamp: 0,
        id: "",
        levelName: "INFO",
      };

      const result = runMiddleware(mw, entry);
      expect(result.context).toBeUndefined();
    });

    it("should prettify source if prettifySource is true", () => {
      const mw = getMiddleware({ prettifySource: true })!;
      const entry: LogEntry = {
        level: 30,
        message: "hello",
        context: { component: "Comp", identity: "ID" },
        meta: {},
        timestamp: 0,
        id: "",
        levelName: "INFO",
      };

      const result = runMiddleware(mw, entry);
      expect(result.message).toBe("[Comp/ID] hello");
      expect(result.context).toBeUndefined();
    });

    it("should hide metadata if showMetadata is false", () => {
      const mw = getMiddleware({ showMetadata: false })!;
      const entry: LogEntry = {
        level: 30,
        message: "test",
        context: {},
        meta: { foo: "bar" },
        timestamp: 0,
        id: "",
        levelName: "INFO",
      };

      const result = runMiddleware(mw, entry);
      expect(result.meta).toEqual({});
    });

    it("should prettify metadata if prettifyMetadata is true", () => {
      const mw = getMiddleware({ prettifyMetadata: true })!;
      const entry: LogEntry = {
        level: 30,
        message: "hello",
        context: {},
        meta: { foo: "bar", num: 123 },
        timestamp: 0,
        id: "",
        levelName: "INFO",
      };

      const result = runMiddleware(mw, entry);
      expect(result.message).toBe("hello  foo=bar num=123");
      expect(result.meta).toEqual({});
    });

    it("should skip prettify source if context is missing", () => {
      const mw = getMiddleware({ prettifySource: true })!;
      const entry: LogEntry = {
        level: 30,
        message: "test",
        meta: {},
        timestamp: 0,
        id: "",
        levelName: "INFO",
      };
      const result = runMiddleware(mw, entry);
      expect(result.message).toBe("test");
    });
  });
});
