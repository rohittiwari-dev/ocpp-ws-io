import { describe, it, expect, afterEach, vi } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import type { OCPPServerClient } from "../src/server-client.js";

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

// ─── B1: Offline Queue ───────────────────────────────────────────

describe("Phase B — Offline Queue", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should queue calls while disconnected and flush on reconnect", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));

    // Register a handler for incoming calls
    server.on("client", (sc: OCPPServerClient) => {
      // @ts-ignore
      sc.handle("Heartbeat", () => ({
        currentTime: new Date().toISOString(),
      }));
    });

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    // Create client with offline queue enabled
    const client = new OCPPClient({
      identity: "CS_OFFLINE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      offlineQueue: true,
      offlineQueueMaxSize: 10,
    });

    // Queue a call before connecting (client is in CLOSED state)
    // @ts-ignore
    const heartbeatPromise = client.call("Heartbeat", {});

    // Now connect — should flush the queue
    await client.connect();
    await new Promise((r) => setTimeout(r, 200));

    // The queued call should have been flushed and resolved
    const result = await heartbeatPromise;
    expect(result).toBeDefined();
    expect((result as any).currentTime).toBeDefined();

    await client.close({ force: true });
  });

  it("should drop oldest messages when offline queue capacity is exceeded", async () => {
    const client = new OCPPClient({
      identity: "CS_OVERFLOW",
      endpoint: "ws://localhost:9999",
      protocols: ["ocpp1.6"],
      reconnect: false,
      offlineQueue: true,
      offlineQueueMaxSize: 3,
    });

    // Queue 5 calls — queue should keep only the last 3
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) {
      // @ts-ignore
      promises.push(client.call("Method" + i, {}));
    }

    // Check internal queue size
    // @ts-expect-error — accessing private field
    expect(client._offlineQueue.length).toBe(3);

    // The queue should hold Method2, Method3, Method4 (dropped Method0, Method1)
    // @ts-expect-error
    expect(client._offlineQueue[0].method).toBe("Method2");
    // @ts-expect-error
    expect(client._offlineQueue[1].method).toBe("Method3");
    // @ts-expect-error
    expect(client._offlineQueue[2].method).toBe("Method4");
  });
});

// ─── B2: Call Retry with Full Jitter ─────────────────────────────

describe("Phase B — Call Retry with Full Jitter", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should retry on timeout and eventually succeed", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));

    let callCount = 0;

    server.on("client", (sc: OCPPServerClient) => {
      // @ts-ignore
      sc.handle("Reset", () => {
        callCount++;
        if (callCount < 3) {
          // Simulate timeout by not responding (never resolving)
          return new Promise(() => {}); // Never resolves
        }
        return { status: "Accepted" };
      });
    });

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CS_RETRY",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      callTimeoutMs: 200, // Short timeout for testing
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 50));

    // Call with retries — first 2 will timeout, 3rd succeeds
    // @ts-ignore
    const result = await client.call(
      "Reset",
      { type: "Soft" },
      {
        retries: 3,
        retryDelayMs: 50,
        retryMaxDelayMs: 100,
      },
    );

    expect(result).toEqual({ status: "Accepted" });
    expect(callCount).toBe(3);

    await client.close({ force: true });
  });
});

// ─── B3: Backpressure ────────────────────────────────────────────

describe("Phase B — Backpressure _safeSend", () => {
  it("should expose _safeSend method on client", () => {
    const client = new OCPPClient({
      identity: "CS_BP",
      endpoint: "ws://localhost:9999",
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    // Verify _safeSend exists as a private method
    // @ts-expect-error — accessing private method
    expect(typeof client._safeSend).toBe("function");
  });

  it("should have backpressure threshold configured", () => {
    // @ts-expect-error — accessing private static
    expect(OCPPClient._BACKPRESSURE_THRESHOLD).toBe(512 * 1024);
  });
});

// ─── B4: Graceful Server Shutdown ────────────────────────────────

describe("Phase B — Graceful Server Shutdown", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should close gracefully waiting for buffer drain", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CS_GRACEFUL",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 50));

    // Close server gracefully (no force) — should wait for buffers
    await server.close({ code: 1000, reason: "Goodbye" });
    expect(server.clients.size).toBe(0);
  });

  it("should close immediately when force=true", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CS_FORCE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 50));

    // Force close — should skip drain wait
    await server.close({ force: true });
    expect(server.clients.size).toBe(0);
  });
});
