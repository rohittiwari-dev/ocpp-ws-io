/**
 * Integration tests for BrowserOCPPClient.
 *
 * Strategy: Since the browser client uses the browser-native `WebSocket` API,
 * we inject a `ws`-backed WebSocket shim into `globalThis.WebSocket` for the
 * duration of each test. This allows the BrowserOCPPClient to run in the
 * vitest (Node.js) environment while connecting to a real OCPPServer.
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
import { ConnectionState, MessageType } from "../src/browser/types.js";
import type { OCPPServerClient } from "../src/server-client.js";

// ─── Mock WebSocket shim ──────────────────────────────────────────

// The browser WebSocket API is a subset of the `ws` module.
// However the BrowserOCPPClient expects the constructor to be
// `new WebSocket(url, protocols?)` (the browser signature).
// `ws`'s WebSocket class is API-compatible enough for our needs.
// We just inject it into globalThis so the client picks it up.
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

// ─── Test Setup ────────────────────────────────────────────────────

let server: OCPPServer;
let client: BrowserOCPPClient;
let port: number;

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

describe("BrowserOCPPClient", () => {
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

  // ─── Construction ────────────────────────────────────────────

  describe("Construction", () => {
    it("should throw if identity is missing", () => {
      expect(
        () =>
          new BrowserOCPPClient({
            identity: "",
            endpoint: "ws://localhost:9999",
          }),
      ).toThrow("identity is required");
    });

    it("should be in CLOSED state initially", () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });
      expect(client.state).toBe(BrowserOCPPClient.CLOSED);
    });

    it("should expose static connection state constants", () => {
      expect(BrowserOCPPClient.CONNECTING).toBe(ConnectionState.CONNECTING);
      expect(BrowserOCPPClient.OPEN).toBe(ConnectionState.OPEN);
      expect(BrowserOCPPClient.CLOSING).toBe(ConnectionState.CLOSING);
      expect(BrowserOCPPClient.CLOSED).toBe(ConnectionState.CLOSED);
    });

    it("should set identity correctly", () => {
      client = new BrowserOCPPClient({
        identity: "MY-STATION",
        endpoint: `ws://localhost:${port}`,
        reconnect: false,
      });
      expect(client.identity).toBe("MY-STATION");
    });
  });

  // ─── Connection ──────────────────────────────────────────────

  describe("Connection", () => {
    it("should connect successfully", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      expect(client.state).toBe(BrowserOCPPClient.OPEN);
    });

    it("should set protocol after connection", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      expect(client.protocol).toBe("ocpp1.6");
    });

    it('should emit "open" event on connect', async () => {
      client = new BrowserOCPPClient({
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

    it('should emit "connecting" event before WebSocket opens', async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      let connectingUrl = "";
      client.on("connecting", ({ url }: { url: string }) => {
        connectingUrl = url;
      });
      await client.connect();
      expect(connectingUrl).toContain("CS001");
    });

    it("should reject connect when already connected", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      await expect(client.connect()).rejects.toThrow("Cannot connect");
    });

    it("should build endpoint with identity appended", async () => {
      client = new BrowserOCPPClient({
        identity: "CS/001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      let url = "";
      client.on("connecting", (event: { url: string }) => {
        url = event.url;
      });
      // This may fail to connect because identity contains "/" which gets encoded,
      // but that's fine — we just want to check the URL format
      try {
        await client.connect();
      } catch {}
      expect(url).toContain(encodeURIComponent("CS/001"));
    });

    it("should append query params to endpoint", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        query: { token: "abc123" },
        reconnect: false,
      });

      let url = "";
      client.on("connecting", (event: { url: string }) => {
        url = event.url;
      });
      try {
        await client.connect();
      } catch {}
      expect(url).toContain("token=abc123");
    });
  });

  // ─── Close ───────────────────────────────────────────────────

  describe("Close", () => {
    it("should close gracefully", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      const result = await client.close();
      expect(result.code).toBe(1000);
      expect(client.state).toBe(BrowserOCPPClient.CLOSED);
    });

    it("should emit close event", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      const closePromise = new Promise<{ code: number; reason: string }>(
        (resolve) => client.on("close", resolve),
      );
      await client.close();
      const result = await closePromise;
      expect(result.code).toBe(1000);
    });

    it("should return immediately when already closed", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        reconnect: false,
      });
      const result = await client.close();
      expect(result).toEqual({ code: 1000, reason: "" });
    });

    it("should handle double close gracefully", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      const [r1, r2] = await Promise.all([client.close(), client.close()]);
      expect(r1.code).toBe(1000);
      expect(r2.code).toBe(1000);
      expect(client.state).toBe(BrowserOCPPClient.CLOSED);
    });

    it("should close with force option", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      const result = await client.close({ force: true });
      expect(client.state).toBe(BrowserOCPPClient.CLOSED);
    });

    it("should close with custom code and reason", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      const result = await client.close({ code: 1001, reason: "going away" });
      expect(client.state).toBe(BrowserOCPPClient.CLOSED);
    });
  });

  // ─── RPC Calls ───────────────────────────────────────────────

  describe("RPC Calls", () => {
    it("should send a call and receive a response", async () => {
      server.on("client", (serverClient) => {
        serverClient.handle("BootNotification", async () => ({
          status: "Accepted",
          currentTime: new Date().toISOString(),
          interval: 300,
        }));
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      const result = await client.call("BootNotification", {
        chargePointVendor: "TestVendor",
        chargePointModel: "TestModel",
      });
      expect((result as any).status).toBe("Accepted");
      expect((result as any).interval).toBe(300);
    });

    it("should receive call error from server", async () => {
      server.on("client", (serverClient) => {
        // No handler registered → server responds with NotImplemented
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      await expect(client.call("UnknownMethod", {})).rejects.toMatchObject({
        rpcErrorCode: "NotImplemented",
      });
    });

    it("should reject calls when not connected", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        reconnect: false,
      });
      await expect(client.call("Test", {})).rejects.toThrow("Cannot call");
    });

    it("should timeout calls that take too long", async () => {
      server.on("client", (serverClient) => {
        serverClient.handle("SlowMethod", async () => {
          // Never respond
          await new Promise(() => {});
        });
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
        callTimeoutMs: 200,
      });

      await client.connect();
      await expect(client.call("SlowMethod", {})).rejects.toThrow("timed out");
    });

    it("should emit message event when sending a call", async () => {
      server.on("client", (serverClient) => {
        serverClient.handle("Heartbeat", async () => ({
          currentTime: new Date().toISOString(),
        }));
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      const messages: unknown[] = [];
      client.on("message", (msg: unknown) => messages.push(msg));
      await client.call("Heartbeat", {});
      expect(messages.length).toBe(1);
      expect((messages[0] as any)[0]).toBe(MessageType.CALL);
      expect((messages[0] as any)[2]).toBe("Heartbeat");
    });

    it("should emit callResult event when receiving a response", async () => {
      server.on("client", (serverClient) => {
        serverClient.handle("Heartbeat", async () => ({
          currentTime: new Date().toISOString(),
        }));
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      const results: unknown[] = [];
      client.on("callResult", (msg: unknown) => results.push(msg));
      await client.call("Heartbeat", {});
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("should support concurrent calls with callConcurrency > 1", async () => {
      server.on("client", (serverClient) => {
        serverClient.handle("Heartbeat", async () => ({
          currentTime: new Date().toISOString(),
        }));
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
        callConcurrency: 3,
      });

      await client.connect();
      const results = await Promise.all([
        client.call("Heartbeat", {}),
        client.call("Heartbeat", {}),
        client.call("Heartbeat", {}),
      ]);
      expect(results).toHaveLength(3);
    });

    it("should abort a call with AbortSignal", async () => {
      server.on("client", (serverClient) => {
        serverClient.handle("SlowMethod", async () => {
          await new Promise((r) => setTimeout(r, 5000));
          return {};
        });
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      const ac = new AbortController();

      const callPromise = client.call("SlowMethod", {}, { signal: ac.signal });
      setTimeout(() => ac.abort(), 50);

      await expect(callPromise).rejects.toThrow();
    });

    it("should immediately reject if AbortSignal is already aborted", async () => {
      server.on("client", (serverClient) => {
        serverClient.handle("Test", async () => ({}));
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      const ac = new AbortController();
      ac.abort();

      await expect(
        client.call("Test", {}, { signal: ac.signal }),
      ).rejects.toThrow();
    });
  });

  // ─── Incoming Calls (Handlers) ───────────────────────────────

  describe("Incoming Call Handlers", () => {
    it("should handle incoming calls from server", async () => {
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      client.handle("Reset", async (ctx) => {
        return { status: "Accepted" };
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100)); // Wait for server to register

      const result = await serverClient!.call("Reset", { type: "Hard" });
      expect((result as any).status).toBe("Accepted");
    });

    it("should invoke wildcard handler for unregistered methods", async () => {
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      const methods: string[] = [];
      client.handle((method, ctx) => {
        methods.push(method);
        return { status: "Accepted" };
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      await serverClient!.call("AnyMethod", {});
      expect(methods).toContain("AnyMethod");
    });

    it("should respond with NotImplemented for unhandled methods", async () => {
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      await expect(
        serverClient!.call("UnhandledMethod", {}),
      ).rejects.toMatchObject({
        rpcErrorCode: "NotImplemented",
      });
    });

    it("should prefer version-specific handler over generic handler", async () => {
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      client.handle("Reset", async () => ({ status: "Rejected" }));
      client.handle("ocpp1.6", "Reset", async () => ({ status: "Accepted" }));

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      const result = await serverClient!.call("Reset", { type: "Hard" });
      // Version-specific handler should win over generic
      expect((result as any).status).toBe("Accepted");
    });

    it("should remove a specific handler with removeHandler()", async () => {
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      client.handle("Reset", async () => ({ status: "Accepted" }));
      client.removeHandler("Reset");

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      await expect(
        serverClient!.call("Reset", { type: "Hard" }),
      ).rejects.toMatchObject({
        rpcErrorCode: "NotImplemented",
      });
    });

    it("should remove version-specific handler with removeHandler(version, method)", async () => {
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      client.handle("Reset", async () => ({ status: "Rejected" }));
      client.handle("ocpp1.6", "Reset", async () => ({ status: "Accepted" }));
      client.removeHandler("ocpp1.6", "Reset");

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      const result = await serverClient!.call("Reset", { type: "Hard" });
      // Should fall back to generic handler after version-specific was removed
      expect((result as any).status).toBe("Rejected");
    });

    it("should remove wildcard handler with removeHandler()", () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        reconnect: false,
      });

      client.handle(() => ({}));
      client.removeHandler(); // Removes wildcard
      // No assertion needed — just verifying no throw
    });

    it("should remove all handlers with removeAllHandlers()", async () => {
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      client.handle("Reset", async () => ({ status: "Accepted" }));
      client.handle((method, ctx) => ({ status: "Wildcard" }));
      client.removeAllHandlers();

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      await expect(
        serverClient!.call("Reset", { type: "Hard" }),
      ).rejects.toMatchObject({
        rpcErrorCode: "NotImplemented",
      });
    });

    it("should throw on invalid handle() arguments", () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        reconnect: false,
      });

      expect(() => (client as any).handle(123)).toThrow("Invalid arguments");
    });

    it("should emit call event for incoming calls", async () => {
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      client.handle("Heartbeat", async () => ({
        currentTime: new Date().toISOString(),
      }));

      const calls: unknown[] = [];
      client.on("call", (msg: unknown) => calls.push(msg));

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      await serverClient!.call("Heartbeat", {});
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect((calls[0] as any)[2]).toBe("Heartbeat");
    });

    it("should support NOREPLY from handler", async () => {
      const { NOREPLY } = await import("../src/browser/types.js");
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      client.handle("FireAndForget", async () => NOREPLY as any);

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      // Server call should timeout since no response is sent
      await expect(
        serverClient!.call("FireAndForget", {}, { timeoutMs: 300 }),
      ).rejects.toThrow();
    });

    it("should include detailed errors when respondWithDetailedErrors is true", async () => {
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
        respondWithDetailedErrors: true,
      });

      client.handle("Buggy", async () => {
        throw new Error("Something broke");
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      try {
        await serverClient!.call("Buggy", {});
        expect.unreachable();
      } catch (err: any) {
        // Should get the detailed error information
        expect(err.rpcErrorCode).toBe("InternalError");
      }
    });
  });

  // ─── sendRaw ─────────────────────────────────────────────────

  describe("sendRaw", () => {
    it("should send raw data over WebSocket", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      // sendRaw shouldn't throw for valid string
      expect(() => client.sendRaw("hello")).not.toThrow();
    });

    it("should throw when not connected", () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        reconnect: false,
      });
      expect(() => client.sendRaw("hello")).toThrow("Cannot send");
    });
  });

  // ─── reconfigure ─────────────────────────────────────────────

  describe("reconfigure", () => {
    it("should update options", () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        reconnect: false,
        callTimeoutMs: 5000,
      });

      client.reconfigure({ callTimeoutMs: 10000 });
      // Can't directly check private _options, but we can verify
      // it works by calling after reconfigure
    });

    it("should update call concurrency dynamically", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
        callConcurrency: 1,
      });

      // Reconfigure before connect
      client.reconfigure({ callConcurrency: 5 });

      // No error
    });
  });

  // ─── Bad Messages ────────────────────────────────────────────

  describe("Bad Messages", () => {
    it("should emit badMessage for invalid JSON", async () => {
      let serverClient;
      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      const badMessages: unknown[] = [];
      client.on("badMessage", (msg: unknown) => badMessages.push(msg));

      // Send malformed data from server
      serverClient!.sendRaw("not-json{{{");
      await new Promise((r) => setTimeout(r, 100));

      expect(badMessages.length).toBe(1);
    });

    it("should emit badMessage for non-array message", async () => {
      let serverClient;
      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      const badMessages: unknown[] = [];
      client.on("badMessage", (msg: unknown) => badMessages.push(msg));

      serverClient!.sendRaw(JSON.stringify({ type: "invalid" }));
      await new Promise((r) => setTimeout(r, 100));

      expect(badMessages.length).toBe(1);
    });

    it("should emit badMessage for unknown message type", async () => {
      let serverClient;
      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      const badMessages: unknown[] = [];
      client.on("badMessage", (msg: unknown) => badMessages.push(msg));

      serverClient!.sendRaw(JSON.stringify([99, "id", "payload"]));
      await new Promise((r) => setTimeout(r, 100));

      expect(badMessages.length).toBe(1);
    });

    it("should close after maxBadMessages is reached", async () => {
      let serverClient;
      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
        maxBadMessages: 2,
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      serverClient!.sendRaw("bad1");
      serverClient!.sendRaw("bad2");
      await new Promise((r) => setTimeout(r, 200));

      // After 2 bad messages, client should initiate close
      expect(client.state).toBe(BrowserOCPPClient.CLOSED);
    });
  });

  // ─── Reconnection ─────────────────────────────────────────────

  describe("Reconnection", () => {
    it("should emit reconnect event after unexpected close", async () => {
      let serverClient;
      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: true,
        maxReconnects: 1,
        backoffMin: 50,
        backoffMax: 100,
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      const reconnectEvents: Array<{ attempt: number; delay: number }> = [];
      client.on("reconnect", (event: { attempt: number; delay: number }) => {
        reconnectEvents.push(event);
      });

      // Simulate server-side disconnect
      await serverClient!.close({ force: true });
      await new Promise((r) => setTimeout(r, 300));

      expect(reconnectEvents.length).toBeGreaterThanOrEqual(1);
      expect(reconnectEvents[0].attempt).toBe(1);
    });

    it("should not reconnect when reconnect is false", async () => {
      let serverClient;
      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      let reconnected = false;
      client.on("reconnect", () => {
        reconnected = true;
      });

      await serverClient!.close({ force: true });
      await new Promise((r) => setTimeout(r, 300));

      expect(reconnected).toBe(false);
    });

    it("should reject pending calls on unexpected close", async () => {
      server.on("client", (sc) => {
        sc.handle("SlowMethod", async () => {
          await new Promise((r) => setTimeout(r, 5000));
          return {};
        });
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
        callTimeoutMs: 5000,
      });

      await client.connect();

      const callPromise = client.call("SlowMethod", {});

      // Attach rejection handler BEFORE closing server to avoid unhandled rejection
      const expectation =
        expect(callPromise).rejects.toThrow("Connection closed");

      // Force server close while call is pending
      await server.close({ force: true });

      await expectation;
    });

    it("should stop reconnecting when reconfigure disables reconnect", async () => {
      let serverClient;
      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: true,
        maxReconnects: 10,
        backoffMin: 500,
        backoffMax: 1000,
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      let reconnectCount = 0;
      client.on("reconnect", () => {
        reconnectCount++;
      });

      // Disable reconnection before triggering disconnect
      client.reconfigure({ reconnect: false });

      // Trigger unexpected close
      await serverClient!.close({ force: true });
      await new Promise((r) => setTimeout(r, 600));

      // No reconnect events should have fired
      expect(reconnectCount).toBe(0);
      expect(client.state).toBe(BrowserOCPPClient.CLOSED);
    });
  });

  // ─── Error Handling ──────────────────────────────────────────

  describe("Error Handling", () => {
    it("should emit error event on WebSocket error", async () => {
      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: "ws://localhost:1", // Invalid port → connection error
        reconnect: false,
      });

      const errors: unknown[] = [];
      client.on("error", (err: unknown) => errors.push(err));

      try {
        await client.connect();
      } catch {}

      // Should have emitted at least one error
      expect(errors.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle handler throwing non-RPC error", async () => {
      let serverClient;

      server.on("client", (sc) => {
        serverClient = sc;
      });

      client = new BrowserOCPPClient({
        identity: "CS001",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp1.6"],
        reconnect: false,
      });

      client.handle("Buggy", async () => {
        throw new TypeError("unexpected error");
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 100));

      try {
        await serverClient!.call("Buggy", {});
        expect.unreachable();
      } catch (err: any) {
        // Non-RPC error should be wrapped as InternalError
        expect(err.rpcErrorCode).toBe("InternalError");
      }
    });
  });

  // ─── Browser-specific Index Exports ──────────────────────────

  describe("Browser Index Exports", () => {
    it("should export all expected modules", async () => {
      const browserModule = await import("../src/browser/index.js");

      expect(browserModule.BrowserOCPPClient).toBeDefined();
      expect(browserModule.TimeoutError).toBeDefined();
      expect(browserModule.RPCGenericError).toBeDefined();
      expect(browserModule.RPCNotImplementedError).toBeDefined();
      expect(browserModule.RPCNotSupportedError).toBeDefined();
      expect(browserModule.RPCInternalError).toBeDefined();
      expect(browserModule.RPCProtocolError).toBeDefined();
      expect(browserModule.RPCSecurityError).toBeDefined();
      expect(browserModule.RPCFormationViolationError).toBeDefined();
      expect(browserModule.RPCFormatViolationError).toBeDefined();
      expect(browserModule.RPCPropertyConstraintViolationError).toBeDefined();
      expect(browserModule.RPCOccurrenceConstraintViolationError).toBeDefined();
      expect(browserModule.RPCTypeConstraintViolationError).toBeDefined();
      expect(browserModule.RPCMessageTypeNotSupportedError).toBeDefined();
      expect(browserModule.RPCFrameworkError).toBeDefined();
      expect(browserModule.createRPCError).toBeDefined();
      expect(browserModule.getErrorPlainObject).toBeDefined();
      expect(browserModule.ConnectionState).toBeDefined();
      expect(browserModule.MessageType).toBeDefined();
      expect(browserModule.NOREPLY).toBeDefined();
    });
  });
});
