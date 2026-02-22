import { createClient } from "redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { topCommand } from "../src/commands/top.js";

vi.mock("redis", () => ({
  createClient: vi.fn(),
}));

describe("topCommand", () => {
  let logSpy: any;
  let errorSpy: any;
  let exitSpy: any;
  let clearSpy: any;
  let clientMock: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    clearSpy = vi.spyOn(console, "clear").mockImplementation(() => {});

    clientMock = {
      connect: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      info: vi.fn().mockResolvedValue("used_memory_human:1M"),
    };
    (createClient as any).mockReturnValue(clientMock);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should connect to redis and start loop", async () => {
    vi.useFakeTimers();
    await topCommand({ redis: "redis://localhost:6379" });

    expect(createClient).toHaveBeenCalledWith({
      url: "redis://localhost:6379",
    });
    expect(clientMock.connect).toHaveBeenCalled();

    // Advance timer to trigger first loop iteration
    await vi.advanceTimersByTimeAsync(1000);

    expect(clientMock.keys).toHaveBeenCalledWith("ocpp:stats:*");
    expect(clearSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("should handle redis connection error", async () => {
    clientMock.connect.mockRejectedValue(new Error("Redis Error"));
    await topCommand({});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to connect"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should display stats when keys exist", async () => {
    vi.useFakeTimers();

    clientMock.keys.mockResolvedValue(["ocpp:stats:node1"]);
    clientMock.get.mockResolvedValue(
      JSON.stringify({ activeSessions: 10, connectedClients: 20 }),
    );

    await topCommand({});

    await vi.advanceTimersByTimeAsync(1000);

    expect(clientMock.get).toHaveBeenCalledWith("ocpp:stats:node1");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Active Server Nodes:"),
    );
    // We can't easily check the values printed because they are constructed with colors.
    // But we can check that log was called enough times.

    vi.useRealTimers();
  });

  it("should fallback to counting sessions if no stats keys", async () => {
    vi.useFakeTimers();

    clientMock.keys.mockImplementation((pattern: string) => {
      if (pattern === "ocpp:stats:*") return Promise.resolve([]);
      if (pattern === "ocpp:sessions:*")
        return Promise.resolve(["ocpp:sessions:1", "ocpp:sessions:2"]);
      return Promise.resolve([]);
    });

    await topCommand({});

    await vi.advanceTimersByTimeAsync(1000);

    expect(clientMock.keys).toHaveBeenCalledWith("ocpp:sessions:*");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Detailed node stats not found"),
    );

    vi.useRealTimers();
  });

  it("should handle errors inside loop", async () => {
    vi.useFakeTimers();

    clientMock.keys.mockRejectedValue(new Error("Loop Error"));

    await topCommand({});

    await vi.advanceTimersByTimeAsync(1000);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Metrics error"),
    );

    vi.useRealTimers();
  });
});
