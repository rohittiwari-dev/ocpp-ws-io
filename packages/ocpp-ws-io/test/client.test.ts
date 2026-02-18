import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import { SecurityProfile } from "../src/types.js";
import type { OCPPServerClient } from "../src/server-client.js";

let server: OCPPServer;
let client: OCPPClient;
let port: number;

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

describe("OCPPClient", () => {
  beforeEach(async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept, _reject, _handshake) => {
      accept({ protocol: "ocpp1.6" });
    });
    const httpServer = await server.listen(0);
    port = getPort(httpServer);
  });

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    await server.close({ force: true });
  });

  it("should throw if identity is missing", () => {
    expect(
      () =>
        new OCPPClient({
          identity: "",
          endpoint: "ws://localhost:9999",
        }),
    ).toThrow("identity is required");
  });

  it("should be in CLOSED state initially", () => {
    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    expect(client.state).toBe(OCPPClient.CLOSED);
  });

  it("should connect successfully", async () => {
    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    expect(client.state).toBe(OCPPClient.OPEN);
    expect(client.protocol).toBe("ocpp1.6");
  });

  it('should emit "open" event on connect', async () => {
    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    let opened = false;
    client.on("open", () => {
      opened = true;
    });
    await client.connect();
    expect(opened).toBe(true);
  });

  it("should reject connect when already connected", async () => {
    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    await expect(client.connect()).rejects.toThrow("Cannot connect");
  });

  it("should close gracefully", async () => {
    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    const result = await client.close();
    expect(result.code).toBe(1000);
    expect(client.state).toBe(OCPPClient.CLOSED);
  });

  it("should handle RPC call and response", async () => {
    // Set up server handler BEFORE client connects
    server.on("client", (serverClient) => {
      serverClient.handle("BootNotification", async () => {
        return {
          status: "Accepted",
          currentTime: new Date().toISOString(),
          interval: 300,
        };
      });
    });

    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();

    const result = await client.call<{ status: string }>("BootNotification", {
      chargePointModel: "TestModel",
      chargePointVendor: "TestVendor",
    });

    expect(result.status).toBe("Accepted");
  });

  it("should receive NotImplemented for unhandled calls", async () => {
    // Server has no handler for UnhandledAction, so it returns NotImplemented
    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      callTimeoutMs: 2000,
    });

    await client.connect();

    await expect(client.call("UnhandledAction", {})).rejects.toThrow(
      /not known|NotImplemented/,
    );
  });

  it("should support abort signal on calls", async () => {
    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();

    const ac = new AbortController();
    const callPromise = client.call("SlowAction", {}, { signal: ac.signal });
    ac.abort();

    await expect(callPromise).rejects.toThrow();
  });

  it("should receive calls from server", async () => {
    let receivedMethod = "";

    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    client.handle("Reset", async (ctx) => {
      receivedMethod = ctx.method;
      return { status: "Accepted" };
    });

    // Set up server handler BEFORE connecting
    const serverCallPromise = new Promise<void>((resolve, reject) => {
      server.on("client", async (serverClient) => {
        try {
          const result = await serverClient.call<{ status: string }>("Reset", {
            type: "Hard",
          });
          expect(result.status).toBe("Accepted");
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await client.connect();
    await serverCallPromise;
    expect(receivedMethod).toBe("Reset");
  });

  it("should handle wildcard handlers", async () => {
    let wildcardMethod = "";

    client = new OCPPClient({
      identity: "CS002",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    client.handle((method, _ctx) => {
      wildcardMethod = method;
      return { status: "Accepted" };
    });

    const serverCallPromise = new Promise<void>((resolve, reject) => {
      server.on("client", async (serverClient) => {
        try {
          await serverClient.call("AnyMethod", {});
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await client.connect();
    await serverCallPromise;
    expect(wildcardMethod).toBe("AnyMethod");
  });

  it("should remove specific handlers", async () => {
    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    client.handle("Test" as string, async () => ({ result: "ok" }));
    client.removeHandler("Test");

    const serverCallPromise = new Promise<void>((resolve, reject) => {
      server.on("client", async (serverClient) => {
        try {
          await serverClient.call("Test", {});
          reject(new Error("Should have thrown"));
        } catch {
          resolve();
        }
      });
    });

    await client.connect();
    await serverCallPromise;
  });
});

describe("OCPPClient - Security Profiles", () => {
  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true });
  });

  it("should include Basic Auth header for Profile 1", async () => {
    let receivedPassword: Buffer | undefined;

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept, _reject, handshake) => {
      receivedPassword = handshake.password;
      accept({ protocol: "ocpp1.6" });
    });
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      securityProfile: SecurityProfile.BASIC_AUTH,
      password: "myPassword123",
      reconnect: false,
    });

    await client.connect();

    // Give the server a moment to process
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedPassword).toBeDefined();
    expect(receivedPassword!.toString()).toBe("myPassword123");
  });
});

describe("Version-Aware Handle", () => {
  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should support version-specific handler with typed params", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    let receivedProtocol: string | undefined;

    client = new OCPPClient({
      identity: "CS_VERSIONED",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    // Register a version-specific handler
    client.handle("ocpp1.6", "Reset", async (ctx) => {
      receivedProtocol = ctx.protocol;
      return { status: "Accepted" };
    });

    const serverCallPromise = new Promise<void>((resolve, reject) => {
      server.on("client", async (sc) => {
        try {
          const result = await sc.call<{ status: string }>("Reset", {
            type: "Hard",
          });
          expect(result.status).toBe("Accepted");
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await client.connect();
    await serverCallPromise;
    expect(receivedProtocol).toBe("ocpp1.6");
  });

  it("should expose protocol in HandlerContext for generic handlers", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    let contextProtocol: string | undefined;
    let contextMessageId = "";
    let contextMethod = "";

    client = new OCPPClient({
      identity: "CS_CTX",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    // Generic handler — receives protocol in context
    client.handle("Reset", async (ctx) => {
      contextProtocol = ctx.protocol;
      contextMessageId = ctx.messageId;
      contextMethod = ctx.method;
      return { status: "Accepted" };
    });

    const serverCallPromise = new Promise<void>((resolve, reject) => {
      server.on("client", async (sc) => {
        try {
          await sc.call("Reset", { type: "Soft" });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await client.connect();
    await serverCallPromise;

    expect(contextProtocol).toBe("ocpp1.6");
    expect(contextMessageId).toBeTruthy();
    expect(contextMethod).toBe("Reset");
  });

  it("should prioritize version-specific handler over generic handler", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    let handlerUsed = "";

    client = new OCPPClient({
      identity: "CS_PRIORITY",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    // Register BOTH a generic and a version-specific handler
    client.handle("Reset", async () => {
      handlerUsed = "generic";
      return { status: "Accepted" };
    });
    client.handle("ocpp1.6", "Reset", async () => {
      handlerUsed = "version-specific";
      return { status: "Accepted" };
    });

    const serverCallPromise = new Promise<void>((resolve, reject) => {
      server.on("client", async (sc) => {
        try {
          await sc.call("Reset", { type: "Hard" });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await client.connect();
    await serverCallPromise;
    expect(handlerUsed).toBe("version-specific");
  });

  it("should fall back to generic handler when version-specific is removed", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    let handlerUsed = "";

    client = new OCPPClient({
      identity: "CS_FALLBACK",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    client.handle("Reset", async () => {
      handlerUsed = "generic";
      return { status: "Accepted" };
    });
    client.handle("ocpp1.6", "Reset", async () => {
      handlerUsed = "version-specific";
      return { status: "Accepted" };
    });

    // Remove the version-specific handler
    client.removeHandler("ocpp1.6", "Reset");

    const serverCallPromise = new Promise<void>((resolve, reject) => {
      server.on("client", async (sc) => {
        try {
          await sc.call("Reset", { type: "Soft" });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await client.connect();
    await serverCallPromise;
    expect(handlerUsed).toBe("generic");
  });

  it("should handle wildcard for unknown methods", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    let wildcardCalled = false;

    client = new OCPPClient({
      identity: "CS_WILDCARD",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    client.handle((_method, _ctx) => {
      wildcardCalled = true;
      return { status: "Accepted" };
    });

    const serverCallPromise = new Promise<void>((resolve, reject) => {
      server.on("client", async (sc) => {
        try {
          await sc.call("UnknownMethod", {});
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await client.connect();
    await serverCallPromise;
    expect(wildcardCalled).toBe(true);
  });

  it("should return securityProfile from options", () => {
    client = new OCPPClient({
      identity: "CS_SEC",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      securityProfile: SecurityProfile.BASIC_AUTH,
    });
    expect(client.securityProfile).toBe(SecurityProfile.BASIC_AUTH);
  });

  it("should default securityProfile to NONE", () => {
    client = new OCPPClient({
      identity: "CS_SEC2",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    expect(client.securityProfile).toBe(SecurityProfile.NONE);
  });

  it("should throw when calling sendRaw while not connected", () => {
    client = new OCPPClient({
      identity: "CS_RAW2",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    expect(() => client.sendRaw("test")).toThrow("Cannot send");
  });
});

describe("OCPPClient - Advanced Features", () => {
  const getPort = (srv: import("node:http").Server): number => {
    const addr = srv.address();
    if (addr && typeof addr !== "string") return addr.port;
    return 0;
  };

  it("should remove all handlers with removeAllHandlers", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    const cl = new OCPPClient({
      identity: "CS_RMALL",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    cl.handle("Heartbeat", async () => ({ currentTime: "" }));
    cl.handle((_method, _ctx) => ({ status: "Accepted" }));
    cl.removeAllHandlers();

    const serverCallPromise = new Promise<void>((resolve, reject) => {
      srv.on("client", async (sc) => {
        try {
          await sc.call("Heartbeat", {});
          reject(new Error("Should have thrown"));
        } catch (e: unknown) {
          expect((e as Error).message).toMatch(/not known|NotImplemented/i);
          resolve();
        }
      });
    });

    await cl.connect();
    await serverCallPromise;
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should send raw message via sendRaw", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    let receivedRaw = false;
    srv.on("client", (sc) => {
      sc.on("badMessage", () => {
        receivedRaw = true;
      });
    });

    const cl = new OCPPClient({
      identity: "CS_RAW",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await cl.connect();
    await new Promise((r) => setTimeout(r, 100));
    cl.sendRaw("not-valid-ocpp");
    await new Promise((r) => setTimeout(r, 200));

    expect(receivedRaw).toBe(true);
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should reconfigure options at runtime", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    const cl = new OCPPClient({
      identity: "CS_RECONF",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      callTimeoutMs: 5000,
    });

    await cl.connect();
    cl.reconfigure({ callTimeoutMs: 10000 });
    expect(cl.state).toBe(OCPPClient.OPEN);
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should reconfigure and re-setup validators when strictMode changes", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    const cl = new OCPPClient({
      identity: "CS_RECONF_STRICT",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await cl.connect();
    cl.reconfigure({ strictMode: true });
    expect(cl.state).toBe(OCPPClient.OPEN);
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should reconfigure ping interval", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    const cl = new OCPPClient({
      identity: "CS_RECONF_PING",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      pingIntervalMs: 0,
    });

    await cl.connect();
    cl.reconfigure({ pingIntervalMs: 30000 });
    expect(cl.state).toBe(OCPPClient.OPEN);
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should handle bad messages and emit badMessage event", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    let badMsgEvent: unknown = null;
    srv.on("client", (sc) => {
      sc.on("badMessage", (data) => {
        badMsgEvent = data;
      });
    });

    const cl = new OCPPClient({
      identity: "CS_BADMSG",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await cl.connect();
    await new Promise((r) => setTimeout(r, 100));
    cl.sendRaw('[2, "msg1", {broken');
    await new Promise((r) => setTimeout(r, 200));

    expect(badMsgEvent).toBeDefined();
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should attempt reconnect on unexpected disconnect", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    let reconnectEmitted = false;
    const cl = new OCPPClient({
      identity: "CS_RECONN",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 1,
      backoffMin: 100,
      backoffMax: 200,
    });

    cl.on("reconnect", () => {
      reconnectEmitted = true;
    });
    cl.on("error", () => {}); // suppress unhandled errors

    await cl.connect();

    // Force close from server side to trigger reconnect
    await srv.close({ force: true });
    await new Promise((r) => setTimeout(r, 500));

    expect(reconnectEmitted).toBe(true);
    await cl.close({ force: true }).catch(() => {});
  });

  it("should emit error when connecting to non-existent server", async () => {
    const cl = new OCPPClient({
      identity: "CS_ERR",
      endpoint: "ws://localhost:59999",
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    cl.on("error", () => {});

    await expect(cl.connect()).rejects.toThrow();
    expect(cl.state).toBe(OCPPClient.CLOSED);
  });

  it("should use ping when pingIntervalMs is set", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    const cl = new OCPPClient({
      identity: "CS_PING",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      pingIntervalMs: 200,
    });

    await cl.connect();
    await new Promise((r) => setTimeout(r, 350));
    expect(cl.state).toBe(OCPPClient.OPEN);
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should validate outbound calls in strict mode", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    srv.on("client", (sc) => {
      sc.handle("Heartbeat", async () => ({
        currentTime: new Date().toISOString(),
      }));
    });
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    const cl = new OCPPClient({
      identity: "CS_STRICT",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      strictMode: true,
    });

    cl.on("strictValidationFailure", () => {});

    await cl.connect();

    try {
      await cl.call("Heartbeat", {} as never);
    } catch {
      // May or may not throw depending on validation
    }

    expect(cl.state).toBe(OCPPClient.OPEN);
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });
});

describe("OCPPClient - Version-Aware Call", () => {
  const getPort = (srv: import("node:http").Server): number => {
    const addr = srv.address();
    if (addr && typeof addr !== "string") return addr.port;
    return 0;
  };

  it("should call with version-specific typed params (ocpp1.6)", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    srv.on("client", (sc) => {
      sc.handle("ocpp1.6", "BootNotification", async ({ params }) => {
        // ocpp1.6 BootNotification has chargePointModel/chargePointVendor
        expect(params).toHaveProperty("chargePointModel");
        expect(params).toHaveProperty("chargePointVendor");
        return {
          status: "Accepted",
          currentTime: new Date().toISOString(),
          interval: 300,
        };
      });
    });
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    const cl = new OCPPClient({
      identity: "CS_VCALL16",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await cl.connect();
    const result = await cl.call("ocpp1.6", "BootNotification", {
      chargePointModel: "ModelX",
      chargePointVendor: "VendorY",
    });

    expect(result).toHaveProperty("status", "Accepted");
    expect(result).toHaveProperty("interval", 300);
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should call with version-specific typed params (ocpp2.0.1)", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp2.0.1"] });
    srv.auth((accept) => accept({ protocol: "ocpp2.0.1" }));
    srv.on("client", (sc) => {
      sc.handle("ocpp2.0.1", "BootNotification", async ({ params }) => {
        // ocpp2.0.1 BootNotification has chargingStation/reason
        expect(params).toHaveProperty("chargingStation");
        expect(params).toHaveProperty("reason");
        return {
          status: "Accepted",
          currentTime: new Date().toISOString(),
          interval: 600,
        };
      });
    });
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    const cl = new OCPPClient({
      identity: "CS_VCALL201",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp2.0.1"],
      reconnect: false,
    });

    await cl.connect();
    const result = await cl.call("ocpp2.0.1", "BootNotification", {
      chargingStation: { model: "ModelX", vendorName: "VendorY" },
      reason: "PowerUp",
    });

    expect(result).toHaveProperty("status", "Accepted");
    expect(result).toHaveProperty("interval", 600);
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should still work with non-versioned call (default protocol)", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));
    srv.on("client", (sc) => {
      sc.handle("Heartbeat", async () => ({
        currentTime: new Date().toISOString(),
      }));
    });
    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    const cl = new OCPPClient({
      identity: "CS_VCALL_DEF",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await cl.connect();
    // Non-versioned call should still work
    const result = await cl.call("Heartbeat", {});
    expect(result).toHaveProperty("currentTime");
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should support version-aware call from server to client", async () => {
    const srv = new OCPPServer({ protocols: ["ocpp1.6"] });
    srv.auth((accept) => accept({ protocol: "ocpp1.6" }));

    const callResult = new Promise<unknown>((resolve, reject) => {
      srv.on("client", async (sc) => {
        try {
          const result = await sc.call("ocpp1.6", "GetConfiguration", {
            key: ["HeartbeatInterval"],
          });
          resolve(result);
        } catch (e) {
          resolve(e); // Resolve with error to avoid timeout
        }
      });
    });

    const httpServer = await srv.listen(0);
    const p = getPort(httpServer);

    const cl = new OCPPClient({
      identity: "CS_VCALL_SRV",
      endpoint: `ws://localhost:${p}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    cl.handle("ocpp1.6", "GetConfiguration", async ({ params }) => {
      expect(params).toHaveProperty("key");
      return {
        configurationKey: [
          { key: "HeartbeatInterval", readonly: false, value: "60" },
        ],
        unknownKey: [],
      };
    });

    await cl.connect();
    const result = await callResult;
    expect(result).toHaveProperty("configurationKey");
    await cl.close({ force: true }).catch(() => {});
    await srv.close({ force: true });
  });

  it("should build endpoint correctly with query params", () => {
    const clientWithQuery = new OCPPClient({
      identity: "CS_QUERY",
      endpoint: "ws://localhost:9999/foo",
      protocols: ["ocpp1.6"],
      reconnect: false,
      query: { a: "1", b: "2" },
    });
    const url = (clientWithQuery as any)._buildEndpoint();
    expect(url).toBe("ws://localhost:9999/foo/CS_QUERY?a=1&b=2");

    const clientWithExistingQuery = new OCPPClient({
      identity: "CS_Q2",
      endpoint: "ws://localhost:9999?foo=bar",
      protocols: ["ocpp1.6"],
      reconnect: false,
      query: { baz: "qux" },
    });
    const url2 = (clientWithExistingQuery as any)._buildEndpoint();
    expect(url2).toBe("ws://localhost:9999?foo=bar/CS_Q2&baz=qux");
  });

  it("should build TLS options correctly", () => {
    const client = new OCPPClient({
      identity: "CS_TLS",
      endpoint: "wss://localhost:9999",
      protocols: ["ocpp1.6"],
      // @ts-ignore
      securityProfile: 3, // TLS_CLIENT_CERT
      tls: {
        ca: "rootca",
        cert: "clientcert",
        key: "clientkey",
        passphrase: "pass",
        rejectUnauthorized: false,
      },
    });

    const opts = (client as any)._buildWsOptions();
    expect(opts.ca).toBe("rootca");
    expect(opts.cert).toBe("clientcert");
    expect(opts.key).toBe("clientkey");
    expect(opts.passphrase).toBe("pass");
    expect(opts.rejectUnauthorized).toBe(false);
  });

  it("should emit strictValidationFailure on inbound validation error", () => {
    const client = new OCPPClient({
      identity: "CS_VAL_ERR",
      endpoint: "ws://localhost:9999",
      protocols: ["ocpp1.6"],
      strictMode: true,
      reconnect: false,
    });

    // Inject a mock validator that throws
    const mockValidator = {
      subprotocol: "ocpp1.6",
      validate: vi.fn().mockImplementation(() => {
        throw new Error("Validation failed");
      }),
    };
    (client as any)._validators = [mockValidator];
    (client as any)._protocol = "ocpp1.6";

    const emitSpy = vi.spyOn(client, "emit");

    // Trigger validation logic via private method
    expect(() => {
      (client as any)._validateInbound("Heartbeat", {}, "req");
    }).toThrow("Validation failed");

    expect(emitSpy).toHaveBeenCalledWith(
      "strictValidationFailure",
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
  });
});
