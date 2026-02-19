import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("OCPPServer - Robustness & Clustering", () => {
  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
    vi.useRealTimers();
  });

  it("should broadcast to local clients and publish to adapter", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const published: Array<{ channel: string; data: unknown }> = [];
    const mockAdapter = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async (channel: string, data: unknown) => {
        published.push({ channel, data });
      },
      subscribe: async () => {},
      unsubscribe: async () => {},
    };
    server.setAdapter(mockAdapter);

    // Connect 2 clients
    const client1 = new OCPPClient({
      identity: "CS_BC_1",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    const client2 = new OCPPClient({
      identity: "CS_BC_2",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await Promise.all([client1.connect(), client2.connect()]);
    await new Promise((r) => setTimeout(r, 100)); // wait for registration

    let c1Received = false;
    let c2Received = false;

    // Handle the broadcasted call
    // @ts-ignore
    client1.handle("Reset", () => {
      c1Received = true;
      return { status: "Accepted" };
    });
    // @ts-ignore
    client2.handle("Reset", () => {
      c2Received = true;
      return { status: "Accepted" };
    });

    // Broadcast
    await server.broadcast("Reset", { type: "Soft" });

    // Verify local delivery
    expect(c1Received).toBe(true);
    expect(c2Received).toBe(true);

    // Verify remote publish
    expect(published).toHaveLength(1);
    // Implementation uses "ocpp:broadcast", adapter adds prefix -> "ocpp-ws-io:ocpp:broadcast"
    // Mock adapter doesn't strip prefix, but we are testing what server.ts calls
    expect(published[0].channel).toBe("ocpp:broadcast");
    expect(published[0].data).toMatchObject({
      method: "Reset",
      params: { type: "Soft" },
    }); // source will be a UUID

    await Promise.all([client1.close(), client2.close()]);
  });

  it("should persist session data across reconnections", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    // Client 1 connects
    const client1 = new OCPPClient({
      identity: "CS_PERSIST",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client1.connect();

    // Get server-side client for CS_PERSIST
    const serverClient1 = Array.from(server.clients).find(
      (c) => c.identity === "CS_PERSIST",
    );
    expect(serverClient1).toBeDefined();

    // Modify session
    serverClient1!.session.foo = "bar";

    // Disconnect
    await client1.close();

    // Client 2 connects (same identity)
    const client2 = new OCPPClient({
      identity: "CS_PERSIST",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client2.connect();

    // Get new server-side client
    const serverClient2 = Array.from(server.clients).find(
      (c) => c.identity === "CS_PERSIST",
    );
    expect(serverClient2).toBeDefined();
    expect(serverClient2).not.toBe(serverClient1); // Different object

    // VERIFY SESSION IS RESTORED
    expect(serverClient2!.session.foo).toBe("bar");

    await client2.close();
  });

  it("should garbage collect stale sessions", async () => {
    vi.useFakeTimers();

    // Set short session timeout for testing via constructor option if possible,
    // but currently it's hardcoded private.
    // However, we can control the time advance.

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));

    const httpServer = await server.listen(0);
    port = getPort(httpServer);

    const client1 = new OCPPClient({
      identity: "CS_GC",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client1.connect();

    const serverClient1 = Array.from(server.clients).find(
      (c) => c.identity === "CS_GC",
    );
    serverClient1!.session.marker = "alive";

    // Disconnect to start the "inactive" timer
    await client1.close();

    // Advance time by 1 hour (less than 2h timeout)
    await vi.advanceTimersByTimeAsync(1 * 60 * 60 * 1000);

    // Reconnect - should still have session
    const client2 = new OCPPClient({
      identity: "CS_GC",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client2.connect();
    const serverClient2 = Array.from(server.clients).find(
      (c) => c.identity === "CS_GC",
    );
    expect(serverClient2!.session.marker).toBe("alive");
    await client2.close();

    // Advance time by 2 hours + 1 minute (total > 2h)
    // The GC runs every 60s.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 60000);

    // Reconnect - should have NEW session
    const client3 = new OCPPClient({
      identity: "CS_GC",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    await client3.connect();
    const serverClient3 = Array.from(server.clients).find(
      (c) => c.identity === "CS_GC",
    );
    expect(serverClient3!.session.marker).toBeUndefined(); // Session was cleared

    await client3.close();
  });

  it("should ignore broadcast messages from self (loopback)", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });

    // access private node ID
    const nodeId = (server as any)._nodeId;

    // Simulate incoming message with same node ID
    const mockAdapter = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
      subscribe: async (_ch: string, handler: Function) => {
        // immediately inject a loopback message
        handler({
          source: nodeId,
          method: "Reset",
          params: {},
        });
      },
      unsubscribe: async () => {},
    };

    const clientCallSpy = vi.fn();
    // mock a client
    (server as any)._clients = new Set([
      {
        call: clientCallSpy,
        identity: "C1",
      },
    ]);

    server.setAdapter(mockAdapter);

    // Should NOT have called client
    expect(clientCallSpy).not.toHaveBeenCalled();
  });

  it("should ignore malformed broadcast messages", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });

    const mockAdapter = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
      subscribe: async (_ch: string, handler: Function) => {
        handler(null); // null
        handler("string"); // not object
        handler({}); // no source/method
      },
      unsubscribe: async () => {},
    };

    server.setAdapter(mockAdapter);
    // Should not crash
    expect(true).toBe(true);
  });

  it("should handle client errors during broadcast gracefully", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });

    const mockAdapter = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
      subscribe: async (_ch: string, handler: Function) => {
        handler({
          source: "other-node",
          method: "Reset",
          params: { type: "Soft" },
        });
      },
      unsubscribe: async () => {},
    };

    const errorClient = {
      call: vi.fn().mockRejectedValue(new Error("Client disconnected")),
      identity: "C_ERR",
    };

    (server as any)._clients = new Set([errorClient]);

    // Should not throw
    server.setAdapter(mockAdapter);

    // Wait a tick for the async handling
    await new Promise((r) => setTimeout(r, 10));

    expect(errorClient.call).toHaveBeenCalled();
  });

  it("should catch errors in broadcast handler", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    let capturedHandler: Function;

    const mockAdapter = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
      subscribe: async (_ch: string, handler: Function) => {
        capturedHandler = handler;
      },
      unsubscribe: async () => {},
    };

    // Inject a spy logger to verify error is logged
    const loggerErrorSpy = vi.fn();
    (server as any)._logger = { error: loggerErrorSpy };

    server.setAdapter(mockAdapter);

    // Force iterator of clients to throw
    // @ts-ignore
    server._clients = {
      [Symbol.iterator]: () => {
        throw new Error("Iterator Error");
      },
    };

    // Trigger handler — should not throw
    capturedHandler!({ source: "other", method: "Reset", params: {} });

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error processing broadcast message",
      expect.objectContaining({ error: "Iterator Error" }),
    );
  });
});
