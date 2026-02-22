import { createClient } from "redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tailCommand } from "../src/commands/tail.js";

vi.mock("redis", () => ({
  createClient: vi.fn(),
}));

describe("tailCommand", () => {
  let logSpy: any;
  let errorSpy: any;
  let exitSpy: any;
  let subscriberMock: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    subscriberMock = {
      connect: vi.fn().mockResolvedValue(undefined),
      pSubscribe: vi.fn().mockResolvedValue(undefined),
    };
    (createClient as any).mockReturnValue(subscriberMock);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should connect to redis and subscribe", async () => {
    await tailCommand({ redis: "redis://localhost:6379" });
    expect(createClient).toHaveBeenCalledWith({
      url: "redis://localhost:6379",
    });
    expect(subscriberMock.connect).toHaveBeenCalled();
    expect(subscriberMock.pSubscribe).toHaveBeenCalledWith(
      "ocpp:stream:*",
      expect.any(Function),
    );
  });

  it("should handle redis connection error", async () => {
    subscriberMock.connect.mockRejectedValue(new Error("Redis Error"));
    await tailCommand({});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to subscribe"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should filter messages by identity", async () => {
    await tailCommand({ identity: "CP1" });

    const callback = subscriberMock.pSubscribe.mock.calls[0][1];

    // Valid message matching filter
    const payload1 = JSON.stringify({
      connectionId: "1",
      identity: "CP1",
      isOutbound: false,
      rawData: JSON.stringify([2, "msg1", "BootNotification", {}]),
    });
    callback(payload1, "channel");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("CP1"));

    logSpy.mockClear();

    // Message NOT matching filter
    const payload2 = JSON.stringify({
      connectionId: "2",
      identity: "CP2",
      isOutbound: false,
      rawData: JSON.stringify([2, "msg2", "BootNotification", {}]),
    });
    callback(payload2, "channel");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("should filter messages by method", async () => {
    await tailCommand({ method: "BootNotification" });

    const callback = subscriberMock.pSubscribe.mock.calls[0][1];

    // Matching method
    const payload1 = JSON.stringify({
      connectionId: "1",
      identity: "CP1",
      isOutbound: false,
      rawData: JSON.stringify([2, "msg1", "BootNotification", {}]),
    });
    callback(payload1, "channel");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("BootNotification"),
    );

    logSpy.mockClear();

    // Non-matching method
    const payload2 = JSON.stringify({
      connectionId: "1",
      identity: "CP1",
      isOutbound: false,
      rawData: JSON.stringify([2, "msg2", "Heartbeat", {}]),
    });
    callback(payload2, "channel");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("should handle malformed messages gracefully", async () => {
    await tailCommand({});
    const callback = subscriberMock.pSubscribe.mock.calls[0][1];

    // Malformed JSON
    callback("invalid-json", "channel");

    // Should not crash
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("CP"));
  });
});
