import EventEmitter from "events";
import http from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockCommand } from "../src/commands/mock.js";

vi.mock("http");

describe("mockCommand", () => {
  let logSpy: any;
  let exitSpy: any;
  let serverMock: any;
  let requestHandler: (req: any, res: any) => void;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    serverMock = {
      listen: vi.fn((port, cb) => cb && cb()),
      close: vi.fn(),
    };

    (http.createServer as any).mockImplementation((handler: any) => {
      requestHandler = handler;
      return serverMock;
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should start server on correct port", async () => {
    await mockCommand({ port: 9090 });

    expect(http.createServer).toHaveBeenCalled();
    expect(serverMock.listen).toHaveBeenCalledWith(9090, expect.any(Function));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Mock Server listening"),
    );
  });

  it("should handle /events request with SSE", async () => {
    vi.useFakeTimers();
    await mockCommand({});

    const req = new EventEmitter();
    (req as any).url = "/events";
    (req as any).method = "GET";

    const res = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };

    requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "Content-Type": "text/event-stream",
      }),
    );
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining("Mock Server Ready"),
    );

    // Advance timer to trigger interval
    vi.advanceTimersByTime(1000);

    expect(res.write).toHaveBeenCalledTimes(2); // 1 initial + 1 event

    // Check if event data is valid JSON
    const secondCall = (res.write as any).mock.calls[1][0];
    expect(secondCall).toContain("data: {");

    // Close request
    req.emit("close");

    // Advance timer again - should not write anymore
    vi.advanceTimersByTime(1000);
    expect(res.write).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("should handle 404 for other routes", async () => {
    await mockCommand({});

    const req = { url: "/other", method: "GET" };
    const res = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };

    requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(404, expect.anything());
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining("Not Found"));
  });

  it("should handle OPTIONS request", async () => {
    await mockCommand({});
    const req = { url: "/events", method: "OPTIONS" };
    const res = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };

    requestHandler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "*",
    );
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it("should handle SIGINT", async () => {
    await mockCommand({});

    process.emit("SIGINT");

    expect(serverMock.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
