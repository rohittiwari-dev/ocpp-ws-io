import { OCPPClient } from "ocpp-ws-io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { virtualStationCommand } from "../src/commands/virtual-station.js";

vi.mock("ocpp-ws-io", () => {
  const ClientMock = vi.fn();
  ClientMock.prototype.connect = vi.fn();
  ClientMock.prototype.on = vi.fn();
  ClientMock.prototype.call = vi.fn().mockResolvedValue({});
  ClientMock.prototype.handle = vi.fn();
  ClientMock.prototype.close = vi.fn();
  return { OCPPClient: ClientMock };
});

describe("virtualStationCommand", () => {
  let logSpy: any;
  let errorSpy: any;
  let exitSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should initialize and connect", async () => {
    await virtualStationCommand({ identity: "VS-1" });
    expect(OCPPClient).toHaveBeenCalledWith(
      expect.objectContaining({ identity: "VS-1" }),
    );
    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];
    expect(clientInstance.connect).toHaveBeenCalled();
  });

  it("should handle successful boot sequence", async () => {
    vi.useFakeTimers();
    await virtualStationCommand({});

    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];
    clientInstance.call.mockImplementation((method: string) => {
      if (method === "BootNotification")
        return Promise.resolve({ status: "Accepted", interval: 10 });
      if (method === "StatusNotification") return Promise.resolve({});
      if (method === "Heartbeat") return Promise.resolve({});
      return Promise.resolve({});
    });

    const onOpen = clientInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )[1];

    // Trigger open
    await onOpen();

    expect(clientInstance.call).toHaveBeenCalledWith(
      "BootNotification",
      expect.anything(),
    );
    expect(clientInstance.call).toHaveBeenCalledWith(
      "StatusNotification",
      expect.objectContaining({ status: "Available" }),
    );

    // Check heartbeat
    await vi.advanceTimersByTimeAsync(10000); // 10s
    expect(clientInstance.call).toHaveBeenCalledWith("Heartbeat", {});

    vi.useRealTimers();
  });

  it("should handle RemoteStartTransaction", async () => {
    vi.useFakeTimers();

    // Setup handlers map on prototype before instantiation
    const handlers: Record<string, Function> = {};
    (OCPPClient.prototype.handle as any).mockImplementation(
      (method: string, handler: Function) => {
        handlers[method] = handler;
      },
    );

    await virtualStationCommand({});

    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];

    // Run open to set state to Available
    clientInstance.call.mockImplementation((method: string) => {
      if (method === "BootNotification")
        return Promise.resolve({ status: "Accepted", interval: 10 });
      if (method === "Authorize")
        return Promise.resolve({ idTagInfo: { status: "Accepted" } });
      if (method === "StartTransaction")
        return Promise.resolve({
          transactionId: 123,
          idTagInfo: { status: "Accepted" },
        });
      return Promise.resolve({});
    });

    const onOpen = clientInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )[1];
    await onOpen();

    // Trigger RemoteStartTransaction
    const handler = handlers["RemoteStartTransaction"];
    expect(handler).toBeDefined();

    const res = await handler({ params: { idTag: "TAG1" } });
    expect(res).toEqual({ status: "Accepted" });

    // Process async start
    await vi.advanceTimersByTimeAsync(1000); // Wait for setTimeout inside handler

    expect(clientInstance.call).toHaveBeenCalledWith(
      "Authorize",
      expect.objectContaining({ idTag: "TAG1" }),
    );
    expect(clientInstance.call).toHaveBeenCalledWith(
      "StatusNotification",
      expect.objectContaining({ status: "Preparing" }),
    );
    expect(clientInstance.call).toHaveBeenCalledWith(
      "StartTransaction",
      expect.anything(),
    );
    expect(clientInstance.call).toHaveBeenCalledWith(
      "StatusNotification",
      expect.objectContaining({ status: "Charging" }),
    );

    vi.useRealTimers();
  });

  it("should handle RemoteStopTransaction", async () => {
    vi.useFakeTimers();

    const handlers: Record<string, Function> = {};
    (OCPPClient.prototype.handle as any).mockImplementation(
      (method: string, handler: Function) => {
        handlers[method] = handler;
      },
    );

    await virtualStationCommand({});

    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];

    // We need to be in Charging state first.
    // Reuse logic from previous test or simulate it?
    // State is local variable inside function closure.
    // We can trigger RemoteStartTransaction first.

    clientInstance.call.mockImplementation((method: string) => {
      if (method === "BootNotification")
        return Promise.resolve({ status: "Accepted", interval: 10 });
      if (method === "Authorize")
        return Promise.resolve({ idTagInfo: { status: "Accepted" } });
      if (method === "StartTransaction")
        return Promise.resolve({
          transactionId: 123,
          idTagInfo: { status: "Accepted" },
        });
      if (method === "StopTransaction")
        return Promise.resolve({ idTagInfo: { status: "Accepted" } });
      return Promise.resolve({});
    });

    const onOpen = clientInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )[1];
    await onOpen();

    const startHandler = handlers["RemoteStartTransaction"];
    await startHandler({ params: { idTag: "TAG1" } });
    await vi.advanceTimersByTimeAsync(1000);

    // Now in Charging state, transactionId is 123

    const stopHandler = handlers["RemoteStopTransaction"];
    const res = await stopHandler({ params: { transactionId: 123 } });
    expect(res).toEqual({ status: "Accepted" });

    await vi.advanceTimersByTimeAsync(1000);

    expect(clientInstance.call).toHaveBeenCalledWith(
      "StopTransaction",
      expect.objectContaining({ transactionId: 123 }),
    );
    expect(clientInstance.call).toHaveBeenCalledWith(
      "StatusNotification",
      expect.objectContaining({ status: "Finishing" }),
    );
    expect(clientInstance.call).toHaveBeenCalledWith(
      "StatusNotification",
      expect.objectContaining({ status: "Available" }),
    );

    vi.useRealTimers();
  });

  it("should handle ChangeAvailability", async () => {
    vi.useFakeTimers();

    const handlers: Record<string, Function> = {};
    (OCPPClient.prototype.handle as any).mockImplementation(
      (method: string, handler: Function) => {
        handlers[method] = handler;
      },
    );

    await virtualStationCommand({});
    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];

    // Mock call responses
    clientInstance.call.mockImplementation((method: string) => {
      if (method === "BootNotification")
        return Promise.resolve({ status: "Accepted", interval: 10 });
      if (method === "StatusNotification") return Promise.resolve({});
      if (method === "Heartbeat") return Promise.resolve({});
      return Promise.resolve({});
    });

    const onOpen = clientInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )[1];
    await onOpen();

    const handler = handlers["ChangeAvailability"];

    // Inoperative
    await handler({ params: { type: "Inoperative" } });
    expect(clientInstance.call).toHaveBeenCalledWith(
      "StatusNotification",
      expect.objectContaining({ status: "Unavailable" }),
    );

    // Operative
    await handler({ params: { type: "Operative" } });
    expect(clientInstance.call).toHaveBeenCalledWith(
      "StatusNotification",
      expect.objectContaining({ status: "Available" }),
    );

    vi.useRealTimers();
  });

  it("should handle Reset", async () => {
    vi.useFakeTimers();

    const handlers: Record<string, Function> = {};
    (OCPPClient.prototype.handle as any).mockImplementation(
      (method: string, handler: Function) => {
        handlers[method] = handler;
      },
    );

    await virtualStationCommand({});
    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];

    clientInstance.call.mockImplementation((method: string) => {
      if (method === "BootNotification")
        return Promise.resolve({ status: "Accepted", interval: 10 });
      if (method === "StatusNotification") return Promise.resolve({});
      return Promise.resolve({});
    });

    const onOpen = clientInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )[1];
    await onOpen();

    const handler = handlers["Reset"];
    const res = await handler({ params: { type: "Soft" } });
    expect(res).toEqual({ status: "Accepted" });

    // Wait for reboot
    await vi.advanceTimersByTimeAsync(2000);
    expect(clientInstance.close).toHaveBeenCalled();

    // Wait for reconnect
    await vi.advanceTimersByTimeAsync(5000);
    expect(clientInstance.connect).toHaveBeenCalledTimes(2); // Initial + reconnect

    vi.useRealTimers();
  });

  it("should handle UpdateFirmware", async () => {
    vi.useFakeTimers();

    const handlers: Record<string, Function> = {};
    (OCPPClient.prototype.handle as any).mockImplementation(
      (method: string, handler: Function) => {
        handlers[method] = handler;
      },
    );

    await virtualStationCommand({});
    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];

    clientInstance.call.mockImplementation((method: string) => {
      if (method === "BootNotification")
        return Promise.resolve({ status: "Accepted", interval: 10 });
      if (method === "FirmwareStatusNotification") return Promise.resolve({});
      return Promise.resolve({});
    });

    const onOpen = clientInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )[1];
    await onOpen();

    const handler = handlers["UpdateFirmware"];
    await handler({ params: { location: "http://fw.bin" } });

    await vi.advanceTimersByTimeAsync(1000);
    expect(clientInstance.call).toHaveBeenCalledWith(
      "FirmwareStatusNotification",
      { status: "Downloading" },
    );

    await vi.advanceTimersByTimeAsync(3000);
    expect(clientInstance.call).toHaveBeenCalledWith(
      "FirmwareStatusNotification",
      { status: "Downloaded" },
    );

    await vi.advanceTimersByTimeAsync(3000);
    expect(clientInstance.call).toHaveBeenCalledWith(
      "FirmwareStatusNotification",
      { status: "Installing" },
    );
    expect(clientInstance.call).toHaveBeenCalledWith(
      "FirmwareStatusNotification",
      { status: "Installed" },
    );

    vi.useRealTimers();
  });

  it("should handle GetDiagnostics", async () => {
    vi.useFakeTimers();

    const handlers: Record<string, Function> = {};
    (OCPPClient.prototype.handle as any).mockImplementation(
      (method: string, handler: Function) => {
        handlers[method] = handler;
      },
    );

    await virtualStationCommand({ identity: "VS-1" });
    const clientInstance = (OCPPClient as unknown as any).mock.instances[0];

    clientInstance.call.mockImplementation((method: string) => {
      if (method === "BootNotification")
        return Promise.resolve({ status: "Accepted", interval: 10 });
      if (method === "DiagnosticsStatusNotification")
        return Promise.resolve({});
      return Promise.resolve({});
    });

    const onOpen = clientInstance.on.mock.calls.find(
      (call: any) => call[0] === "open",
    )[1];
    await onOpen();

    const handler = handlers["GetDiagnostics"];
    const res = await handler({ params: { location: "http://upload" } });
    expect(res).toEqual({ fileName: "diagnostics-VS-1.zip" });

    await vi.advanceTimersByTimeAsync(1000);
    expect(clientInstance.call).toHaveBeenCalledWith(
      "DiagnosticsStatusNotification",
      { status: "Uploading" },
    );

    await vi.advanceTimersByTimeAsync(3000);
    expect(clientInstance.call).toHaveBeenCalledWith(
      "DiagnosticsStatusNotification",
      { status: "Uploaded" },
    );

    vi.useRealTimers();
  });

  it("should handle ClearCache", async () => {
    const handlers: Record<string, Function> = {};
    (OCPPClient.prototype.handle as any).mockImplementation(
      (method: string, handler: Function) => {
        handlers[method] = handler;
      },
    );

    await virtualStationCommand({});
    const handler = handlers["ClearCache"];
    const res = await handler({});
    expect(res).toEqual({ status: "Accepted" });
  });
});
