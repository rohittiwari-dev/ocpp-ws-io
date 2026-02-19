/**
 * Browser Client — Phase 3 Robustness Tests
 *
 * Validates that all Phase 3 improvements are correctly ported to BrowserOCPPClient:
 *   1. Reconnect state transitions (CONNECTING during backoff)
 *   2. disconnect event (transient) vs close event (permanent)
 *   3. Close code validation (RFC 6455 §7.4)
 *   4. Outbound message buffering during CONNECTING
 *   5. _rejectPendingCalls extraction
 *   6. Intolerable error handling
 *
 * Uses the same ws→globalThis.WebSocket shim as browser-client.test.ts.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import WebSocketModule from "ws";
import { OCPPServer } from "../src/server.js";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { ConnectionState } from "../src/browser/types.js";
import type { OCPPServerClient } from "../src/server-client.js";

// ─── Mock WebSocket shim ──────────────────────────────────────────
const OriginalWebSocket = (globalThis as any).WebSocket;

beforeAll(() => {
  (globalThis as any).WebSocket = WebSocketModule;
});

afterAll(() => {
  if (OriginalWebSocket) {
    (globalThis as any).WebSocket = OriginalWebSocket;
  } else {
    delete (globalThis as any).WebSocket;
  }
});

const { CONNECTING, OPEN, CLOSING, CLOSED } = ConnectionState;

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

describe("Browser Phase 3 — Reconnect State", () => {
  let server: OCPPServer;
  let client: BrowserOCPPClient;
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
    client = new BrowserOCPPClient({
      identity: "BR_STATE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 2,
      backoffMin: 500,
      backoffMax: 1000,
    });

    client.on("error", () => {});

    await client.connect();
    expect(client.state).toBe(OPEN);

    await server.close({ force: true });
    await new Promise((r) => setTimeout(r, 200));

    expect(client.state).toBe(CONNECTING);

    await client.close({ force: true }).catch(() => {});
  });

  it("should not allow connect() during CONNECTING (reconnect in progress)", async () => {
    client = new BrowserOCPPClient({
      identity: "BR_NO_DBL",
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

describe("Browser Phase 3 — disconnect vs close Events", () => {
  let server: OCPPServer;
  let client: BrowserOCPPClient;
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

  it("should emit 'disconnect' (not 'close') on transient disconnection", async () => {
    const events: string[] = [];

    client = new BrowserOCPPClient({
      identity: "BR_EVT",
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

    expect(events).toContain("disconnect");
    expect(events).not.toContain("close");

    await client.close({ force: true }).catch(() => {});
  });

  it("should emit 'close' when reconnect is disabled", async () => {
    const events: string[] = [];

    client = new BrowserOCPPClient({
      identity: "BR_NO_RC",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    client.on("disconnect", () => events.push("disconnect"));
    client.on("close", () => events.push("close"));

    await client.connect();
    await server.close({ force: true });
    await new Promise((r) => setTimeout(r, 200));

    expect(events).toContain("disconnect");
    expect(events).toContain("close");
  });

  it("should emit 'close' on intentional close()", async () => {
    const events: string[] = [];

    client = new BrowserOCPPClient({
      identity: "BR_INT_CLOSE",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: true,
      maxReconnects: 5,
    });

    client.on("disconnect", () => events.push("disconnect"));
    client.on("close", () => events.push("close"));

    await client.connect();
    await client.close();

    expect(events).toContain("close");
    expect(events).not.toContain("disconnect");
  });
});

describe("Browser Phase 3 — Close Code Validation", () => {
  let server: OCPPServer;
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
    const client = new BrowserOCPPClient({
      identity: "BR_VALID",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    const result = await client.close({ code: 1000 });
    expect(result.code).toBe(1000);
  });

  it("should normalize invalid close code to 1000", async () => {
    const client = new BrowserOCPPClient({
      identity: "BR_BAD",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    const result = await client.close({ code: 1005 });
    expect(result.code).toBe(1000);
  });
});

describe("Browser Phase 3 — Outbound Buffering", () => {
  let server: OCPPServer;
  let client: BrowserOCPPClient;
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

  it("should throw when sendRaw called in CLOSED state", () => {
    client = new BrowserOCPPClient({
      identity: "BR_CLOSED",
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

    client = new BrowserOCPPClient({
      identity: "BR_OPEN",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    client.sendRaw("immediate-msg");
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toBe(true);
  });

  it("should buffer sendRaw messages during CONNECTING and flush on open", async () => {
    const receivedMessages: string[] = [];

    server.on("client", (sc) => {
      sc.on("badMessage", (data) => {
        receivedMessages.push(data.message);
      });
    });

    client = new BrowserOCPPClient({
      identity: "BR_BUF",
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
    client.sendRaw("buf-msg-1");
    client.sendRaw("buf-msg-2");

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

    expect(receivedMessages).toContain("buf-msg-1");
    expect(receivedMessages).toContain("buf-msg-2");
  });
});

describe("Browser Phase 3 — Pending Call Rejection", () => {
  let server: OCPPServer;
  let client: BrowserOCPPClient;
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
    server.on("client", (sc) => {
      sc.handle("SlowAction" as string, async () => {
        await new Promise((r) => setTimeout(r, 60000));
        return {};
      });
    });

    client = new BrowserOCPPClient({
      identity: "BR_PENDING",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      callTimeoutMs: 30000,
    });

    await client.connect();

    const callPromise = client.call("SlowAction", {});
    const expectation =
      expect(callPromise).rejects.toThrow("Connection closed");

    await new Promise((r) => setTimeout(r, 100));
    await server.close({ force: true });

    await expectation;
  });
});
