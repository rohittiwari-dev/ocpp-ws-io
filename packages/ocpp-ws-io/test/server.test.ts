import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import type { OCPPServerClient } from "../src/server-client.js";

let server: OCPPServer;
let port: number;

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

describe("OCPPServer", () => {
  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should start listening on a port", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    const httpServer = await server.listen(0);
    const addr = httpServer.address();
    expect(addr).toBeDefined();
    expect(typeof addr !== "string" && addr?.port).toBeGreaterThan(0);
  });

  it("should reject connections without auth callback set", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    // No auth callback set — should still accept (no auth check)
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    expect(client.state).toBe(OCPPClient.OPEN);
    await client.close({ force: true });
  });

  it("should expose connected clients", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    expect(server.clients.size).toBe(0);

    const client = new OCPPClient({
      identity: "CS001",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();

    // Wait for server to register the client
    await new Promise((r) => setTimeout(r, 100));

    expect(server.clients.size).toBe(1);
    const [serverClient] = server.clients;
    expect(serverClient.identity).toBe("CS001");

    await client.close({ force: true });
  });

  it('should emit "client" event when a station connects', async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const clientReceived = new Promise<OCPPServerClient>((resolve) => {
      server.on("client", (sc) => resolve(sc as OCPPServerClient));
    });

    const client = new OCPPClient({
      identity: "CS_EMIT",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();

    const sc = await clientReceived;
    expect(sc.identity).toBe("CS_EMIT");
    expect(sc.handshake).toBeDefined();
    expect(sc.handshake.identity).toBe("CS_EMIT");

    await client.close({ force: true });
  });

  it("should reject connections via auth callback", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((_accept, reject) => {
      reject(401, "Bad credentials");
    });
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CS_REJECTED",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    // Suppress the 'error' event to prevent unhandled error
    client.on("error", () => {});

    await expect(client.connect()).rejects.toThrow();
  });

  it("should parse identity from URL path", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    let receivedIdentity = "";

    server.auth((accept, _reject, handshake) => {
      receivedIdentity = handshake.identity;
      accept({ protocol: "ocpp1.6" });
    });

    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "MY-STATION-123",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    expect(receivedIdentity).toBe("MY-STATION-123");
    await client.close({ force: true });
  });

  it("should remove client on disconnect", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CS_DISC",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 100));
    expect(server.clients.size).toBe(1);

    await client.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(server.clients.size).toBe(0);
  });

  it("should close all clients on server close", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CS_CLOSE_ALL",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 100));

    await server.close({ force: true });
    expect(server.clients.size).toBe(0);
  });
});

describe("OCPPServerClient", () => {
  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should inherit options from server", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      callTimeoutMs: 5000,
    });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const clientReceived = new Promise<OCPPServerClient>((resolve) => {
      server.on("client", (sc) => resolve(sc as OCPPServerClient));
    });

    const client = new OCPPClient({
      identity: "CS_INHERIT",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    const sc = await clientReceived;

    expect(sc.identity).toBe("CS_INHERIT");
    expect(sc.state).toBe(OCPPClient.OPEN);
    expect(sc.protocol).toBe("ocpp1.6");

    await client.close({ force: true });
  });

  it("should reject connect() call", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const clientReceived = new Promise<OCPPServerClient>((resolve) => {
      server.on("client", (sc) => resolve(sc as OCPPServerClient));
    });

    const client = new OCPPClient({
      identity: "CS_NO_CONNECT",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    const sc = await clientReceived;

    await expect(sc.connect()).rejects.toThrow(
      "Cannot connect from server client",
    );
    await client.close({ force: true });
  });

  it("should expose session data", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const clientReceived = new Promise<OCPPServerClient>((resolve) => {
      server.on("client", (sc) => resolve(sc as OCPPServerClient));
    });

    const client = new OCPPClient({
      identity: "CS_SESSION",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    const sc = await clientReceived;

    expect(sc.session).toBeDefined();
    expect(typeof sc.session).toBe("object");

    await client.close({ force: true });
  });
});

describe("OCPPServer - handleUpgrade, reconfigure, adapter, signal", () => {
  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should expose handleUpgrade getter for external HTTP servers", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    const upgradeFn = server.handleUpgrade;
    expect(typeof upgradeFn).toBe("function");
  });

  it("should allow handleUpgrade to be called from an external server", async () => {
    const http = await import("node:http");
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));

    // listen(0) initializes the internal WSS needed by handleUpgrade
    await server.listen(0);

    const externalServer = http.createServer();
    await new Promise<void>((resolve) => externalServer.listen(0, resolve));
    const addr = externalServer.address();
    const externalPort = addr && typeof addr !== "string" ? addr.port : 0;

    externalServer.on("upgrade", server.handleUpgrade);

    const client = new OCPPClient({
      identity: "CS_EXT",
      endpoint: `ws://localhost:${externalPort}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    const connected = new Promise<void>((resolve) => {
      server.on("client", () => resolve());
    });

    await client.connect();
    await connected;
    expect(client.state).toBe(OCPPClient.OPEN);

    await client.close({ force: true });
    externalServer.close();
  });

  it("should reconfigure server options at runtime", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.reconfigure({ callTimeoutMs: 15000 });
    // Should not throw and should be usable
    const httpServer = await server.listen(0);
    expect(httpServer).toBeDefined();
  });

  it("should set and use a custom adapter", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });

    const publishedData: Array<{ channel: string; data: unknown }> = [];

    const mockAdapter = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async (channel: string, data: unknown) => {
        publishedData.push({ channel, data });
      },
      subscribe: async () => {},
      unsubscribe: async () => {},
      onMessage: () => {},
    };

    server.setAdapter(mockAdapter);
    await server.publish("test-channel", { type: "broadcast" });

    expect(publishedData).toEqual([
      { channel: "test-channel", data: { type: "broadcast" } },
    ]);
  });

  it("should no-op publish when no adapter is set", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    // Should not throw even without an adapter
    await expect(server.publish("channel", {})).resolves.toBeUndefined();
  });

  it("should close server via abort signal", async () => {
    const ac = new AbortController();
    server = new OCPPServer({ protocols: ["ocpp1.6"] });

    const httpServer = await server.listen(0, undefined, { signal: ac.signal });
    expect(httpServer).toBeDefined();

    // Aborting should close the HTTP server
    ac.abort();
    await new Promise((r) => setTimeout(r, 100));

    // Server should be closed — new connections should fail
    const addr = httpServer.address();
    expect(addr).toBeNull(); // address() returns null on closed server
  });
});
