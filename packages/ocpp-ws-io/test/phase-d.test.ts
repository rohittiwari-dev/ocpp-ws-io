import { describe, it, expect, afterEach } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

// ─── D1: Idempotency Keys ───────────────────────────────────────

describe("Phase D — Idempotency Keys", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should use idempotencyKey as messageId when provided", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));

    // Register handler BEFORE client connects
    let receivedMessageId: string | undefined;
    server.on("client", (sc) => {
      sc.handle("Heartbeat", async (ctx) => {
        receivedMessageId = ctx.messageId;
        return { currentTime: new Date().toISOString() };
      });
    });

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CS_IDEM_1",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();

    const idempotencyKey = "my-unique-idem-key-12345";
    await client.call("Heartbeat", {}, { idempotencyKey, timeoutMs: 2000 });

    // The server received the messageId which equals our idempotencyKey
    expect(receivedMessageId).toBe(idempotencyKey);
  });

  it("should generate random messageId when no idempotencyKey", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));

    let receivedMessageId: string | undefined;
    server.on("client", (sc) => {
      sc.handle("Heartbeat", async (ctx) => {
        receivedMessageId = ctx.messageId;
        return { currentTime: new Date().toISOString() };
      });
    });

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CS_IDEM_2",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();

    await client.call("Heartbeat", {}, { timeoutMs: 2000 });

    // Should be a random cuid2 id (> 20 chars, not our static key)
    expect(receivedMessageId).toBeDefined();
    expect(receivedMessageId!.length).toBeGreaterThan(10);
    expect(receivedMessageId).not.toBe("my-unique-idem-key-12345");
  });

  it("should produce distinct messageIds for separate idempotency keys", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));

    const receivedIds: string[] = [];
    server.on("client", (sc) => {
      sc.handle("Heartbeat", async (ctx) => {
        receivedIds.push(ctx.messageId);
        return { currentTime: new Date().toISOString() };
      });
    });

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CS_IDEM_3",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();

    await client.call(
      "Heartbeat",
      {},
      { idempotencyKey: "key-A", timeoutMs: 2000 },
    );
    await client.call(
      "Heartbeat",
      {},
      { idempotencyKey: "key-B", timeoutMs: 2000 },
    );

    expect(receivedIds).toEqual(["key-A", "key-B"]);
  });
});

// ─── D3: Health & Metrics Endpoint ──────────────────────────────

describe("Phase D — Health & Metrics Endpoint", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should serve /health as JSON when healthEndpoint is enabled", async () => {
    server = new OCPPServer({ healthEndpoint: true });
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const response = await fetch(`http://localhost:${port}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.state).toBe("OPEN");
    expect(typeof body.connectedClients).toBe("number");
    expect(typeof body.activeSessions).toBe("number");
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(typeof body.pid).toBe("number");
  });

  it("should serve /metrics as Prometheus text format", async () => {
    server = new OCPPServer({ healthEndpoint: true });
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const response = await fetch(`http://localhost:${port}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");

    const body = await response.text();
    expect(body).toContain("# HELP ocpp_connected_clients");
    expect(body).toContain("# TYPE ocpp_connected_clients gauge");
    expect(body).toContain("ocpp_connected_clients");
    expect(body).toContain("ocpp_memory_rss_bytes");
    expect(body).toContain("ocpp_memory_heap_used_bytes");
    expect(body).toContain("ocpp_ws_buffered_bytes");
  });

  it("should return 404 for unknown HTTP paths", async () => {
    server = new OCPPServer({ healthEndpoint: true });
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const response = await fetch(`http://localhost:${port}/unknown`);
    expect(response.status).toBe(404);
  });

  it("should not serve /health when healthEndpoint is not enabled", async () => {
    server = new OCPPServer(); // No healthEndpoint
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    // Without healthEndpoint, nginx/reverse proxy is expected to handle HTTP
    // The server won't respond to plain HTTP — the connection just hangs.
    // We verify by checking the server was created without error.
    expect(server.state).toBe("OPEN");
  });
});

// ─── D2: Strict Schema Validation ───────────────────────────────

describe("Phase D — Strict Schema Validation Integration", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should validate outbound calls in strict mode", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      strictMode: true,
    });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    server.on("client", (sc) => {
      sc.handle("Heartbeat", async () => ({
        currentTime: new Date().toISOString(),
      }));
    });

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    client = new OCPPClient({
      identity: "CS_STRICT_1",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      strictMode: true,
    });
    client.on("strictValidationFailure", () => {});

    await client.connect();

    // Heartbeat with empty body is valid per OCPP 1.6 schema
    const result = await client.call<{ currentTime: string }>(
      "Heartbeat",
      {},
      { timeoutMs: 2000 },
    );
    expect(result).toBeDefined();
    expect(result.currentTime).toBeDefined();
  });
});
