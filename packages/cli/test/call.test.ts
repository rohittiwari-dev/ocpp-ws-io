import { OCPPClient } from "ocpp-ws-io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callCommand } from "../src/commands/call.js";

vi.mock("ocpp-ws-io", () => {
  const ClientMock = vi.fn();
  ClientMock.prototype.connect = vi.fn();
  ClientMock.prototype.on = vi.fn();
  ClientMock.prototype.call = vi.fn();
  ClientMock.prototype.close = vi.fn();
  return { OCPPClient: ClientMock };
});

describe("callCommand", () => {
  let logSpy: any;
  let errorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "dir").mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should parse payload correctly and setup client connections", async () => {
    await callCommand("BootNotification", '{"chargePointVendor":"test"}', {
      endpoint: "ws://localhost:9000",
      identity: "TEST-CP-1",
    });

    expect(OCPPClient).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: "TEST-CP-1",
        endpoint: "ws://localhost:9000",
        protocols: ["ocpp1.6"],
      }),
    );

    expect(OCPPClient.prototype.on).toHaveBeenCalledWith(
      "open",
      expect.any(Function),
    );
    expect(OCPPClient.prototype.on).toHaveBeenCalledWith(
      "error",
      expect.any(Function),
    );
    expect(OCPPClient.prototype.connect).toHaveBeenCalled();
  });

  it("should exit with code 1 if payload is invalid JSON", async () => {
    await callCommand("BootNotification", "{invalid-json}", {});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error parsing JSON payload"),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("should perform the call when triggered and close automatically", async () => {
    await callCommand("Heartbeat", "{}", {});

    // Simulate the 'open' event being triggered
    const openCallback = vi
      .mocked(OCPPClient.prototype.on)
      .mock.calls.find((call) => call[0] === "open")![1];

    // Simulate successful call response
    vi.mocked(OCPPClient.prototype.call).mockResolvedValue({
      currentTime: "2023-01-01T00:00:00Z",
    });

    await openCallback();

    expect(OCPPClient.prototype.call).toHaveBeenCalledWith("Heartbeat", {});
    expect(OCPPClient.prototype.close).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("should handle call errors without throwing unhandled exceptions", async () => {
    await callCommand("Heartbeat", "{}", {});

    const openCallback = vi
      .mocked(OCPPClient.prototype.on)
      .mock.calls.find((call) => call[0] === "open")![1];

    // Simulate failed call
    vi.mocked(OCPPClient.prototype.call).mockRejectedValue(
      new Error("Network Timeout"),
    );

    await openCallback();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Network Timeout"),
    );
    expect(OCPPClient.prototype.close).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
