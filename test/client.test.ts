import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    server.on("client", (serverClient: OCPPServerClient) => {
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
      server.on("client", async (serverClient: OCPPServerClient) => {
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
      server.on("client", async (serverClient: OCPPServerClient) => {
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

    client.handle("Test", async () => ({ result: "ok" }));
    client.removeHandler("Test");

    const serverCallPromise = new Promise<void>((resolve, reject) => {
      server.on("client", async (serverClient: OCPPServerClient) => {
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
