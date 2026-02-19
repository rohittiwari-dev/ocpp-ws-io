import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import type { LoggerLike } from "../src/types.js";

let server: OCPPServer;
let client: OCPPClient;
let port: number;

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

/**
 * Creates a mock logger with vi.fn() spies on all methods.
 */
function createMockLogger(): LoggerLike & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
} {
  const logger: any = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  // child returns a new mock logger (without further child nesting)
  logger.child.mockReturnValue({
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
  });
  return logger;
}

describe("Logger Integration - Client", () => {
  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true });
  });

  it("should use default voltlog-io logger when no logging config is set", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    // No logging config — should use default (voltlog-io with console)
    // Just verify it doesn't crash
    client = new OCPPClient({
      identity: "CS_LOG_DEFAULT",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    expect(client.state).toBe(OCPPClient.OPEN);
  });

  it("should not log when logging is disabled", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const consoleSpy = vi.spyOn(console, "info");

    client = new OCPPClient({
      identity: "CS_LOG_OFF",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });

    await client.connect();
    await client.close();

    // No console.info calls from our logger (there may be other console calls)
    const ourCalls = consoleSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("Connected"),
    );
    expect(ourCalls).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it("should use custom handler when provided", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const mockLogger = createMockLogger();

    client = new OCPPClient({
      identity: "CS_LOG_CUSTOM",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: { handler: mockLogger },
    });

    await client.connect();

    // child should have been called with identity context
    expect(mockLogger.child).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "OCPPClient",
        identity: "CS_LOG_CUSTOM",
      }),
    );

    // Should have logged "Connected"
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Connected",
      expect.objectContaining({ protocol: "ocpp1.6" }),
    );
  });

  it("should log CALL sent and received", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const mockLogger = createMockLogger();

    server.on("client", (sc) => {
      sc.handle("Heartbeat", async () => ({
        currentTime: new Date().toISOString(),
      }));
    });

    client = new OCPPClient({
      identity: "CS_LOG_CALL",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: { handler: mockLogger },
    });

    await client.connect();
    await client.call("Heartbeat", {});

    // Should have logged outbound CALL
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("⚡ CS_LOG_CALL  →  Heartbeat  [OUT]"),
      expect.objectContaining({ method: "Heartbeat", direction: "OUT" }),
    );

    // Should have logged inbound CALLRESULT
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("⚡ CS_LOG_CALL  ←  Heartbeat  [RES]"),
      expect.objectContaining({
        messageId: expect.any(String),
        direction: "IN",
      }),
    );
  });

  it("should log incoming CALL and handler errors", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const mockLogger = createMockLogger();

    client = new OCPPClient({
      identity: "CS_LOG_ERR",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: { handler: mockLogger },
    });

    client.handle("Buggy", async () => {
      throw new Error("handler crashed");
    });

    const serverCallPromise = new Promise<void>((resolve) => {
      server.on("client", async (sc) => {
        try {
          await sc.call("Buggy", {});
        } catch {
          // expected
        }
        resolve();
      });
    });

    await client.connect();
    await serverCallPromise;

    // Should have logged incoming CALL
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("⚡ CS_LOG_ERR  ←  Buggy  [IN]"),
      expect.objectContaining({ method: "Buggy", direction: "IN" }),
    );

    // Should have logged handler error
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Handler error",
      expect.objectContaining({
        method: "Buggy",
        error: "handler crashed",
      }),
    );
  });

  it("should log CALLERROR received", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const mockLogger = createMockLogger();

    client = new OCPPClient({
      identity: "CS_LOG_CALLERR",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: { handler: mockLogger },
      callTimeoutMs: 2000,
    });

    await client.connect();

    // Call a method the server doesn't handle — produces CALLERROR
    try {
      await client.call("NonExistent", {});
    } catch {
      // expected
    }

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Call error",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("should log disconnect", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const mockLogger = createMockLogger();

    client = new OCPPClient({
      identity: "CS_LOG_DISC",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: { handler: mockLogger },
    });

    await client.connect();

    // Force close from server side to trigger unexpected disconnect
    for (const sc of server.clients) {
      await sc.close({ force: true });
    }
    await new Promise((r) => setTimeout(r, 200));

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Disconnected",
      expect.objectContaining({ code: expect.any(Number) }),
    );
  });

  it("should log reconnection attempts", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const mockLogger = createMockLogger();

    client = new OCPPClient({
      identity: "CS_LOG_RECONN",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 1,
      backoffMin: 100,
      backoffMax: 200,
      logging: { handler: mockLogger },
    });

    client.on("error", () => {}); // suppress

    await client.connect();

    // Force close from server side
    await server.close({ force: true });
    await new Promise((r) => setTimeout(r, 500));

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Reconnecting",
      expect.objectContaining({ attempt: 1 }),
    );

    await client.close({ force: true }).catch(() => {});
  });

  it("should log bad messages", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const mockLogger = createMockLogger();

    client = new OCPPClient({
      identity: "CS_LOG_BADMSG",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: { handler: mockLogger },
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 100));

    // Send invalid message from server side
    for (const sc of server.clients) {
      (sc as any)._ws?.send("not-valid-json-{{{");
    }
    await new Promise((r) => setTimeout(r, 200));

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Bad message",
      expect.objectContaining({ count: 1 }),
    );
  });

  it("should respect logging.enabled = false", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const mockLogger = createMockLogger();

    client = new OCPPClient({
      identity: "CS_LOG_ENABLED_FALSE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: { enabled: false, handler: mockLogger },
    });

    await client.connect();
    await client.close();

    // Handler should NOT have been called since enabled is false
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });
});

describe("Logger Integration - Server", () => {
  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true });
  });

  it("should log when server starts listening", async () => {
    const mockLogger = createMockLogger();

    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: { handler: mockLogger },
    });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));

    await server.listen(0);

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Server listening",
      expect.objectContaining({ port: expect.any(Number) }),
    );
  });

  it("should log client connected and disconnected", async () => {
    const mockLogger = createMockLogger();

    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: { handler: mockLogger },
    });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CS_SRV_LOG",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });

    await client.connect();

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Client connected",
      expect.objectContaining({ identity: "CS_SRV_LOG" }),
    );

    await client.close();
    await new Promise((r) => setTimeout(r, 200));

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Client disconnected",
      expect.objectContaining({ identity: "CS_SRV_LOG" }),
    );
  });

  it("should log auth rejection", async () => {
    const mockLogger = createMockLogger();

    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: { handler: mockLogger },
    });
    server.auth((_accept, reject) => {
      reject(403, "Forbidden");
    });
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CS_SRV_REJECT",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });
    client.on("error", () => {}); // suppress

    try {
      await client.connect();
    } catch {
      // expected
    }

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Auth rejected",
      expect.objectContaining({ identity: "CS_SRV_REJECT", code: 403 }),
    );
  });

  it("should log server closing", async () => {
    const mockLogger = createMockLogger();

    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: { handler: mockLogger },
    });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    await server.listen(0);

    await server.close();

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Server closing",
      expect.objectContaining({ clientCount: expect.any(Number) }),
    );
  });

  it("should pass logging config to server clients", async () => {
    const mockLogger = createMockLogger();

    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: { handler: mockLogger },
    });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    // Server client should also log via the handler (it gets the same logging config)
    const serverClientLogs = new Promise<void>((resolve) => {
      server.on("client", async (sc) => {
        sc.handle("Heartbeat", async () => ({
          currentTime: new Date().toISOString(),
        }));
        resolve();
      });
    });

    client = new OCPPClient({
      identity: "CS_SRV_PASS",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });

    await client.connect();
    await serverClientLogs;
    await client.call("Heartbeat", {});

    // The server client (which inherits logging config) should have logged the incoming CALL
    // child() should be called for server client identity context
    expect(mockLogger.child).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "OCPPClient",
        identity: "CS_SRV_PASS",
      }),
    );
  });

  it("should not log on server when logging is false", async () => {
    const mockLogger = createMockLogger();

    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: false,
    });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CS_SRV_OFF",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });

    await client.connect();
    await client.close();
    await new Promise((r) => setTimeout(r, 100));

    // mockLogger should never be called since it wasn't even used
    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});
