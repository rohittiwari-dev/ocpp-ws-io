import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCommand } from "../src/commands/parse.js";

describe("parseCommand", () => {
  let logSpy: any;
  let errorSpy: any;
  let dirSpy: any;
  let exitSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dirSpy = vi.spyOn(console, "dir").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should successfully parse a valid OCPP Call payload", async () => {
    const rawPayload = `[2, "msg_123", "Heartbeat", {}]`;
    await parseCommand(rawPayload, {});

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    expect(dirSpy).toHaveBeenCalledWith({}, expect.any(Object));
  });

  it("should successfully parse a valid OCPP CallResult payload", async () => {
    const rawPayload = `[3, "msg_123", {"currentTime": "2023-01-01T00:00:00.000Z"}]`;
    await parseCommand(rawPayload, {});

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    expect(dirSpy).toHaveBeenCalledWith(
      { currentTime: "2023-01-01T00:00:00.000Z" },
      expect.any(Object),
    );
  });

  it("should successfully parse a valid OCPP CallError payload", async () => {
    const rawPayload = `[4, "msg_123", "NotSupported", "Feature not found", {}]`;
    await parseCommand(rawPayload, {});

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    expect(dirSpy).toHaveBeenCalledWith({}, expect.any(Object));
  });

  it("should log an error if payload is not a valid JSON array", async () => {
    const rawPayload = `{"type": "Heartbeat"}`;
    await parseCommand(rawPayload, {});

    expect(errorSpy).toHaveBeenCalled();
    const errorCall = errorSpy.mock.calls.find((call: any) =>
      call[0].includes("Parse Error"),
    );
    expect(errorCall).toBeTruthy();
  });

  it("should log an error if JSON is malformed", async () => {
    const rawPayload = `[2, "msg_123", "Heartbeat", {]`; // Malformed
    await parseCommand(rawPayload, {});

    expect(errorSpy).toHaveBeenCalled();
  });
});
