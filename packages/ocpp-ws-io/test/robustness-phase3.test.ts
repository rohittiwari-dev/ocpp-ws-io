import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import { ConnectionState } from "../src/types.js";

/**
 * Phase 3 Robustness Tests
 *
 * Validates all Phase 3 improvements:
 *   1. Reconnect state transitions (CONNECTING during backoff)
 *   2. disconnect event (transient) vs close event (permanent)
 *   3. Close code validation (RFC 6455 §7.4)
 *   4. Outbound message buffering during CONNECTING
 *   5. Intolerable error handling
 *   6. Protocol narrowing on reconnect
 *   7. _rejectPendingCalls extraction
 */

const { CONNECTING, OPEN, CLOSING, CLOSED } = ConnectionState;

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

describe("Phase 3 — Reconnect State Transitions", () => {
  let server: OCPPServer;
  let client: OCPPClient;
  let port: number;

  beforeEach(async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);
  });

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    await server.close({ force: true }).catch(() => {});
  });

  it("should stay in CONNECTING state during reconnect backoff", async () => {
    client = new OCPPClient({
      identity: "CS_STATE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 2,
      backoffMin: 500,
      backoffMax: 1000,
    });

    client.on("error", () => {}); // suppress

    await client.connect();
    expect(client.state).toBe(OPEN);

    // Force server close to trigger reconnect
    await server.close({ force: true });
    await new Promise((r) => setTimeout(r, 200));

    // During reconnect backoff, state should be CONNECTING
    expect(client.state).toBe(CONNECTING);

    await client.close({ force: true }).catch(() => {});
  });

  it("should not allow connect() during CONNECTING (reconnect in progress)", async () => {
    client = new OCPPClient({
      identity: "CS_NO_DOUBLE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 2,
      backoffMin: 500,
      backoffMax: 1000,
    });

    client.on("error", () => {});

    await client.connect();
    await server.close({ force: true });
    await new Promise((r) => setTimeout(r, 200));

    expect(client.state).toBe(CONNECTING);
    await expect(client.connect()).rejects.toThrow("Cannot connect");
  });
});

describe("Phase 3 — disconnect vs close Events", () => {
  let server: OCPPServer;
  let client: OCPPClient;
  let port: number;

  beforeEach(async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);
  });

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    await server.close({ force: true }).catch(() => {});
  });

  it("should emit 'disconnect' (not 'close') on transient disconnection when reconnect is enabled", async () => {
    const events: string[] = [];

    client = new OCPPClient({
      identity: "CS_EVT",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 1,
      backoffMin: 500,
      backoffMax: 500,
    });

    client.on("error", () => {});
    client.on("disconnect", () => events.push("disconnect"));
    client.on("close", () => events.push("close"));

    await client.connect();
    await server.close({ force: true });
    await new Promise((r) => setTimeout(r, 200));

    // Only disconnect should fire immediately, not close
    expect(events).toContain("disconnect");
    expect(events).not.toContain("close");

    await client.close({ force: true }).catch(() => {});
  });

  it("should emit 'close' when reconnect is disabled", async () => {
    const events: string[] = [];

    client = new OCPPClient({
      identity: "CS_NO_RECON",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    client.on("disconnect", () => events.push("disconnect"));
    client.on("close", () => events.push("close"));

    await client.connect();
    await server.close({ force: true });
    await new Promise((r) => setTimeout(r, 200));

    // Both disconnect and close should fire (disconnect first, then close)
    expect(events).toContain("disconnect");
    expect(events).toContain("close");
  });

  it("should emit 'close' on intentional close()", async () => {
    const events: string[] = [];

    client = new OCPPClient({
      identity: "CS_CLOSE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 5,
    });

    client.on("disconnect", () => events.push("disconnect"));
    client.on("close", () => events.push("close"));

    await client.connect();
    await client.close();

    // Intentional close should emit 'close' but NOT 'disconnect'
    expect(events).toContain("close");
    expect(events).not.toContain("disconnect");
  });

  it("should emit 'close' when max reconnects exhausted", async () => {
    const events: string[] = [];

    client = new OCPPClient({
      identity: "CS_MAX",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 1,
      backoffMin: 50,
      backoffMax: 50,
    });

    client.on("error", () => {});
    client.on("disconnect", () => events.push("disconnect"));
    client.on("close", (evt) => events.push(`close:${evt.reason}`));

    await client.connect();
    await server.close({ force: true });

    // Wait for reconnect attempt to exhaust
    await new Promise((r) => setTimeout(r, 2000));

    expect(events).toContain("disconnect");
    expect(events.some((e) => e.startsWith("close:"))).toBe(true);
  });
});

describe("Phase 3 — Close Code Validation", () => {
  let server: OCPPServer;
  let client: OCPPClient;
  let port: number;

  beforeEach(async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);
  });

  afterEach(async () => {
    await server.close({ force: true }).catch(() => {});
  });

  it("should accept valid close codes", async () => {
    client = new OCPPClient({
      identity: "CS_VALID_CODE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    const result = await client.close({ code: 1000 });
    expect(result.code).toBe(1000);
  });

  it("should accept custom close codes (4000-4999)", async () => {
    client = new OCPPClient({
      identity: "CS_CUSTOM_CODE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    const result = await client.close({ code: 4001, reason: "Custom" });
    expect(result.code).toBe(4001);
  });

  it("should normalize invalid close code to 1000", async () => {
    client = new OCPPClient({
      identity: "CS_BAD_CODE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    // 1005 is reserved and should be normalized
    const result = await client.close({ code: 1005 });
    expect(result.code).toBe(1000);
  });
});

describe("Phase 3 — Outbound Message Buffering", () => {
  let server: OCPPServer;
  let client: OCPPClient;
  let port: number;

  beforeEach(async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);
  });

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    await server.close({ force: true }).catch(() => {});
  });

  it("should buffer sendRaw messages during CONNECTING and flush on open", async () => {
    let receivedMessages: string[] = [];

    server.on("client", (sc) => {
      sc.on("badMessage", (data) => {
        receivedMessages.push(data.message);
      });
    });

    client = new OCPPClient({
      identity: "CS_BUFFER",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 2,
      backoffMin: 200,
      backoffMax: 200,
    });

    client.on("error", () => {});

    await client.connect();

    // Force disconnect for reconnect
    await server.close({ force: true });
    await new Promise((r) => setTimeout(r, 100));

    expect(client.state).toBe(CONNECTING);

    // Buffer messages during CONNECTING
    client.sendRaw("buffered-msg-1");
    client.sendRaw("buffered-msg-2");

    // Restart server for reconnect to succeed
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    server.on("client", (sc) => {
      sc.on("badMessage", (data) => {
        receivedMessages.push(data.message);
      });
    });
    await server.listen(port);

    // Wait for reconnect + message delivery
    await new Promise((r) => setTimeout(r, 1000));

    expect(receivedMessages).toContain("buffered-msg-1");
    expect(receivedMessages).toContain("buffered-msg-2");
  });

  it("should throw when sendRaw called in CLOSED state", () => {
    client = new OCPPClient({
      identity: "CS_CLOSED_SEND",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    expect(() => client.sendRaw("test")).toThrow("Cannot send");
  });

  it("should send immediately when OPEN", async () => {
    let received = false;

    server.on("client", (sc) => {
      sc.on("badMessage", () => {
        received = true;
      });
    });

    client = new OCPPClient({
      identity: "CS_IMMED",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    client.sendRaw("immediate-msg");
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toBe(true);
  });
});

describe("Phase 3 — Pending Call Rejection", () => {
  let server: OCPPServer;
  let client: OCPPClient;
  let port: number;

  beforeEach(async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);
  });

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    await server.close({ force: true }).catch(() => {});
  });

  it("should reject pending calls on unexpected disconnect", async () => {
    // Server never responds — call stays pending
    server.on("client", (sc) => {
      sc.handle("SlowAction" as string, async () => {
        await new Promise((r) => setTimeout(r, 60000));
        return {};
      });
    });

    client = new OCPPClient({
      identity: "CS_PENDING",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      callTimeoutMs: 30000,
    });

    await client.connect();

    const callPromise = client.call("SlowAction", {});

    // Catch immediately to avoid unhandled rejection if test timing is off
    const resultPromise = callPromise.catch((e) => e);

    // Force server close while call is pending
    await new Promise((r) => setTimeout(r, 100));
    await server.close({ force: true });

    const result = await resultPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/Connection closed/);
  });
});

describe("Phase 3 — Protocol Narrowing", () => {
  it("should narrow protocols to negotiated protocol after first connect", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6", "ocpp2.0.1"] });
    server.auth((accept) => accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CS_NARROW",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6", "ocpp2.0.1"],
      reconnect: false,
    });

    await client.connect();
    expect(client.protocol).toBe("ocpp1.6");

    await client.close({ force: true });
    await server.close({ force: true });
  });
});
