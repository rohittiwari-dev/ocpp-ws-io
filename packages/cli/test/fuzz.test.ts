import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { fuzzCommand } from "../src/commands/fuzz.js";

vi.mock("ws", () => {
  const WebSocketMock = vi.fn();
  WebSocketMock.prototype.on = vi.fn();
  WebSocketMock.prototype.send = vi.fn();
  WebSocketMock.prototype.close = vi.fn();
  WebSocketMock.prototype.readyState = 1; // OPEN
  (WebSocketMock as any).OPEN = 1;
  return { default: WebSocketMock };
});

describe("fuzzCommand", () => {
  let logSpy: any;
  let exitSpy: any;
  let stdoutSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should start fuzzing with correct options", async () => {
    await fuzzCommand({ endpoint: "ws://localhost:9000", workers: 2 });

    expect(WebSocket).toHaveBeenCalledTimes(2);
    expect(WebSocket).toHaveBeenCalledWith("ws://localhost:9000/CP-Fuzzer-0");
    expect(WebSocket).toHaveBeenCalledWith("ws://localhost:9000/CP-Fuzzer-1");
  });

  it("should send attacks when connected", async () => {
    vi.useFakeTimers();

    await fuzzCommand({ workers: 1 });

    const wsInstance = (WebSocket as unknown as any).mock.instances[0];
    const onOpen = wsInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )[1];

    // Trigger open
    // The loop runs immediately once
    onOpen();

    expect(wsInstance.send).toHaveBeenCalled();

    // Stop the loop by closing the socket
    wsInstance.readyState = 3; // CLOSED

    // Clear any pending timers to avoid infinite loop warnings
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("should handle server messages (rejects)", async () => {
    await fuzzCommand({ workers: 1 });
    const wsInstance = (WebSocket as unknown as any).mock.instances[0];
    // Set readyState to CLOSED to prevent loop from running endlessly if onOpen is triggered
    wsInstance.readyState = 3;

    const onMessage = wsInstance.on.mock.calls.find(
      (call: any) => call[0] === "message",
    )[1];

    // Simulate rejection message [4, ...]
    onMessage(JSON.stringify([4, "msgId", "Error", "Description"]));

    expect(stdoutSpy).toHaveBeenCalled();
    const lastCall = stdoutSpy.mock.calls[stdoutSpy.mock.calls.length - 1][0];
    expect(lastCall).toContain("Graceful Schema Rejects: 1");
  });

  it("should exit when all threads die", async () => {
    await fuzzCommand({ workers: 1 });
    const wsInstance = (WebSocket as unknown as any).mock.instances[0];
    wsInstance.readyState = 3; // Stop loop

    const onClose = wsInstance.on.mock.calls.find(
      (call: any) => call[0] === "close",
    )[1];

    onClose(1006); // Abnormal close

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("All fuzzing threads collapsed"),
    );
  });
});
