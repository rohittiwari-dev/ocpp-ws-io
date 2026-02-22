import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { proxyCommand } from "../src/commands/proxy.js";

vi.mock("ws", () => {
  const WebSocketMock = vi.fn();
  WebSocketMock.prototype.on = vi.fn();
  WebSocketMock.prototype.send = vi.fn();
  WebSocketMock.prototype.close = vi.fn();
  WebSocketMock.prototype.readyState = 1; // OPEN
  (WebSocketMock as any).OPEN = 1;

  const WebSocketServerMock = vi.fn();
  WebSocketServerMock.prototype.on = vi.fn();

  return {
    default: WebSocketMock,
    WebSocketServer: WebSocketServerMock,
  };
});

describe("proxyCommand", () => {
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

  it("should exit if no target provided", async () => {
    await proxyCommand({ listen: 8080 });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Please specify a target"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should start proxy server", async () => {
    await proxyCommand({ target: "ws://target.com", listen: 9090 });
    expect(WebSocketServer).toHaveBeenCalledWith({ port: 9090 });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Listening locally"),
    );
  });

  it("should handle client connection and proxy messages", async () => {
    await proxyCommand({ target: "ws://target.com" });

    const wssInstance = (WebSocketServer as unknown as any).mock.instances[0];
    const connectionHandler = wssInstance.on.mock.calls.find(
      (call: any) => call[0] === "connection",
    )[1];

    const clientSocket = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1,
      close: vi.fn(),
    };
    const req = {
      url: "/CP1",
      headers: { "sec-websocket-protocol": "ocpp1.6" },
    };

    connectionHandler(clientSocket, req);

    expect(WebSocket).toHaveBeenCalledWith("ws://target.com/CP1", ["ocpp1.6"]);
    const serverSocket = (WebSocket as unknown as any).mock.instances[0];

    // Simulate Client -> Server message
    const clientMsgHandler = clientSocket.on.mock.calls.find(
      (call: any) => call[0] === "message",
    )![1];
    clientMsgHandler(JSON.stringify([2, "123", "BootNotification", {}]));

    expect(serverSocket.send).toHaveBeenCalledWith(
      expect.stringContaining("BootNotification"),
    );

    // Simulate Server -> Client message
    const serverMsgHandler = serverSocket.on.mock.calls.find(
      (call: any) => call[0] === "message",
    )![1];
    serverMsgHandler(JSON.stringify([3, "123", { status: "Accepted" }]));

    expect(clientSocket.send).toHaveBeenCalledWith(
      expect.stringContaining("Accepted"),
    );
  });

  it("should handle disconnection", async () => {
    await proxyCommand({ target: "ws://target.com" });

    const wssInstance = (WebSocketServer as unknown as any).mock.instances[0];
    const connectionHandler = wssInstance.on.mock.calls.find(
      (call: any) => call[0] === "connection",
    )[1];

    const clientSocket = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1,
      close: vi.fn(),
    };
    connectionHandler(clientSocket, { url: "/CP1", headers: {} });

    const serverSocket = (WebSocket as unknown as any).mock.instances[0];

    // Client closes
    const clientCloseHandler = clientSocket.on.mock.calls.find(
      (call: any) => call[0] === "close",
    )![1];
    clientCloseHandler();
    expect(serverSocket.close).toHaveBeenCalled();

    // Server closes
    const serverCloseHandler = serverSocket.on.mock.calls.find(
      (call: any) => call[0] === "close",
    )![1];
    serverCloseHandler();
    expect(clientSocket.close).toHaveBeenCalled();
  });
});
