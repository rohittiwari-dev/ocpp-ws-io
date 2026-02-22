import { OCPPClient } from "ocpp-ws-io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditCommand } from "../src/commands/audit.js";

// Mock OCPPClient
vi.mock("ocpp-ws-io", () => {
  const ClientMock = vi.fn();
  ClientMock.prototype.connect = vi.fn();
  ClientMock.prototype.on = vi.fn();
  ClientMock.prototype.call = vi.fn();
  ClientMock.prototype.close = vi.fn();
  return { OCPPClient: ClientMock };
});

describe("auditCommand", () => {
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

  it("should initialize client with correct options", async () => {
    await auditCommand({ endpoint: "ws://localhost:9000" });

    expect(OCPPClient).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: "Compliance-Auditor",
        endpoint: "ws://localhost:9000",
        protocols: ["ocpp1.6"],
        strictMode: false,
      }),
    );
    expect(OCPPClient.prototype.connect).toHaveBeenCalled();
  });

  it("should handle successful audit", async () => {
    await auditCommand({});

    // Get the open callback
    const openCallback = (OCPPClient.prototype.on as any).mock.calls.find(
      (call: any) => call[0] === "open",
    )[1];

    // Mock successful responses where server rejects invalid payloads
    (OCPPClient.prototype.call as any).mockImplementation(
      async (method: string, payload: any) => {
        if (method === "BootNotification") {
          // Valid payload has chargePointModel
          if (payload.chargePointModel) {
            return { status: "Accepted" };
          }
          // Invalid payload should be rejected by server
          throw new Error("Validation Error");
        }
        if (method === "Heartbeat") {
          // Invalid payload (array) should be rejected by server
          if (Array.isArray(payload)) {
            throw new Error("Validation Error");
          }
          return {};
        }
        return {};
      },
    );

    // Execute the open callback
    await openCallback();

    expect(OCPPClient.prototype.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("CSMS Passed the Baseline Audit"),
    );
  });

  it("should handle failed audit", async () => {
    await auditCommand({});

    const openCallback = (OCPPClient.prototype.on as any).mock.calls.find(
      (call: any) => call[0] === "open",
    )[1];

    // Mock failures
    // 1. BootNotification rejected
    // 2. Server ACCEPTS invalid payload
    // 3. Server ACCEPTS array payload
    (OCPPClient.prototype.call as any).mockImplementation(
      async (method: string, payload: any) => {
        if (method === "BootNotification") {
          if (!payload.chargePointModel) {
            return { status: "Accepted" }; // Fail: Server accepted invalid
          }
          return { status: "Rejected" }; // Fail: Server rejected valid
        }
        if (method === "Heartbeat") {
          return {}; // Fail: Server accepted array
        }
        return {};
      },
    );

    await openCallback();

    expect(OCPPClient.prototype.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0); // It still exits 0 in the code? No, let's check code.
    // Code:
    // if (failed === 0) { ... } else { console.log(red(...)); }
    // await client.close();
    // process.exit(0);
    // Ah, it exits 0 even on failure? Yes, looking at lines 81-82.

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("CSMS Failed"));
  });

  it("should handle connection error", async () => {
    await auditCommand({});

    const errorCallback = (OCPPClient.prototype.on as any).mock.calls.find(
      (call: any) => call[0] === "error",
    )[1];

    errorCallback(new Error("Connection failed"));

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Critical failure"),
    );
  });
});
