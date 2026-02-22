import * as readline from "node:readline/promises";
import { OCPPClient } from "ocpp-ws-io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { simulateCommand } from "../src/commands/simulate.js";

vi.mock("node:readline/promises");
vi.mock("ocpp-ws-io", () => {
  const ClientMock = vi.fn();
  ClientMock.prototype.connect = vi.fn();
  ClientMock.prototype.on = vi.fn();
  ClientMock.prototype.call = vi.fn().mockResolvedValue({});
  ClientMock.prototype.close = vi.fn();
  return { OCPPClient: ClientMock };
});

describe("simulateCommand", () => {
  let logSpy: any;
  let errorSpy: any;
  let exitSpy: any;
  let rlMock: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // process.exit should throw to stop execution flow
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`PROCESS_EXIT_${code}`);
    }) as any);

    rlMock = {
      question: vi.fn(),
      close: vi.fn(),
    };
    (readline.createInterface as any).mockReturnValue(rlMock);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should exit if endpoint is invalid", async () => {
    try {
      await simulateCommand({ endpoint: "invalid-url" });
    } catch (e: any) {
      expect(e.message).toBe("PROCESS_EXIT_1");
    }
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid endpoint URL"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should connect and handle user commands", async () => {
    rlMock.question
      .mockResolvedValueOnce("B")
      .mockResolvedValueOnce("H")
      .mockResolvedValueOnce("S")
      .mockResolvedValueOnce("Q");

    await simulateCommand({ identity: "TEST-CP" });

    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];
    const onOpen = clientInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )![1];

    try {
      await onOpen();
    } catch (e: any) {
      expect(e.message).toBe("PROCESS_EXIT_0");
    }

    expect(clientInstance.call).toHaveBeenCalledWith(
      "BootNotification",
      expect.anything(),
    );
    expect(clientInstance.call).toHaveBeenCalledWith(
      "Heartbeat",
      expect.anything(),
    );
    expect(clientInstance.call).toHaveBeenCalledWith(
      "StatusNotification",
      expect.anything(),
    );
    expect(clientInstance.close).toHaveBeenCalled();
  });

  it("should handle command errors", async () => {
    rlMock.question.mockResolvedValueOnce("B").mockResolvedValueOnce("Q");

    await simulateCommand({});
    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];
    clientInstance.call.mockRejectedValue(new Error("Network Error"));

    const onOpen = clientInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )![1];

    try {
      await onOpen();
    } catch (e: any) {
      expect(e.message).toBe("PROCESS_EXIT_0");
    }

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Command failed"),
    );
  });

  it("should handle unknown commands", async () => {
    rlMock.question.mockResolvedValueOnce("UNKNOWN").mockResolvedValueOnce("Q");

    await simulateCommand({});
    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];
    const onOpen = clientInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )![1];

    try {
      await onOpen();
    } catch (e: any) {
      expect(e.message).toBe("PROCESS_EXIT_0");
    }

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown command"),
    );
  });
});
