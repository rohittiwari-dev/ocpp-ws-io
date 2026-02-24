import { describe, it, expect, afterEach } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import { SecurityProfile } from "../src/types.js";
import WebSocket from "ws";
import type { SecurityEvent } from "../src/types.js";

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

// ─── I1: Payload Size Limits ──────────────────────────────────────

describe("Phase I — Payload Size Limits (maxPayloadBytes)", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should reject a WebSocket frame exceeding maxPayloadBytes", async () => {
    server = new OCPPServer({ maxPayloadBytes: 256 });
    server.auth((ctx) => ctx.accept());
    // Suppress the ws-level "Max payload" error that OCPPServerClient re-emits
    server.on("client", (sc) => sc.on("error", () => {}));

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/CP001`);
      let done = false;

      // Attach error early — it may fire before or after close
      ws.on("error", () => {
        if (!done) {
          done = true;
          resolve();
        }
      });

      ws.on("open", () => {
        const oversized = JSON.stringify([
          2,
          "msg-1",
          "BootNotification",
          { chargePointModel: "A".repeat(300) },
        ]);
        try {
          ws.send(oversized);
        } catch {
          // ws may already be closing — the close/error event will handle resolution
        }
      });

      ws.on("close", (code) => {
        if (!done) {
          done = true;
          expect(code).toBe(1009);
          resolve();
        }
      });

      setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error("Timed out"));
        }
      }, 3000);
    });
  });

  it("should allow a frame within maxPayloadBytes", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], maxPayloadBytes: 65536 });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    server.on("client", (sc) => {
      sc.handle("Heartbeat", async () => ({
        currentTime: new Date().toISOString(),
      }));
    });

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    const client = new OCPPClient({
      identity: "CP_PAYLOAD_OK",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await client.connect();
    const result = await client.call("Heartbeat", {}, { timeoutMs: 2000 });
    expect(result).toBeDefined();
    await client.close({ force: true });
  });

  it("should default to 65536 (64KB) when maxPayloadBytes is not set", () => {
    server = new OCPPServer();
    // @ts-expect-error — accessing private field for test coverage
    expect(server._wss.options.maxPayload).toBe(65536);
  });

  it("should use a custom maxPayloadBytes value when provided", () => {
    server = new OCPPServer({ maxPayloadBytes: 131072 });
    // @ts-expect-error — accessing private field for test coverage
    expect(server._wss.options.maxPayload).toBe(131072);
  });
});

// ─── I3: Security Event Emission ─────────────────────────────────

describe("Phase I — Security Event Emission (securityEvent)", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should emit AUTH_FAILED when auth callback rejects", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.reject(401, "Bad credentials"));

    const events: SecurityEvent[] = [];
    server.on("securityEvent", (e) => events.push(e));

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    // Use raw WebSocket so we can observe the rejection without OCPPClient reconnecting
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/CP_AUTH_FAIL`, [
        "ocpp1.6",
      ]);
      ws.on("close", () => resolve());
      ws.on("error", () => resolve());
      setTimeout(resolve, 2000);
    });

    // Flush the event loop to ensure emission
    await new Promise((r) => setTimeout(r, 50));

    const authFailed = events.find((e) => e.type === "AUTH_FAILED");
    expect(authFailed).toBeDefined();
    expect(authFailed!.identity).toBe("CP_AUTH_FAIL");
    expect(authFailed!.timestamp).toBeDefined();
    expect(authFailed!.details?.code).toBe(401);
  });

  it("should emit CONNECTION_RATE_LIMIT when IP exceeds connection rate", async () => {
    server = new OCPPServer({
      connectionRateLimit: { limit: 1, windowMs: 60000 },
    });
    server.auth((ctx) => ctx.accept());

    const events: SecurityEvent[] = [];
    server.on("securityEvent", (e) => events.push(e));

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    // First connection — consumes the bucket
    const ws1 = new WebSocket(`ws://localhost:${port}/CP_RATE_1`);
    await new Promise<void>((res, rej) => {
      ws1.once("open", res);
      ws1.once("error", rej);
      setTimeout(rej, 2000);
    });

    // Second connection from same localhost IP — should be rate-limited
    const ws2 = new WebSocket(`ws://localhost:${port}/CP_RATE_2`);
    await new Promise<void>((res) => {
      ws2.once("close", () => res());
      ws2.once("error", () => res());
      setTimeout(res, 1500);
    });

    ws1.close();

    const rateLimitEvent = events.find(
      (e) => e.type === "CONNECTION_RATE_LIMIT",
    );
    expect(rateLimitEvent).toBeDefined();
    expect(rateLimitEvent!.timestamp).toBeDefined();
  });

  it("should emit UPGRADE_ABORTED on handshake timeout", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      handshakeTimeoutMs: 50, // abort quickly
    });

    // Auth that never settles — triggers the AbortController timeout
    server.auth(() => new Promise(() => {}));

    const events: SecurityEvent[] = [];
    server.on("securityEvent", (e) => events.push(e));

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    await new Promise<void>((res) => {
      const ws = new WebSocket(`ws://localhost:${port}/CP_ABORT`, ["ocpp1.6"]);
      ws.once("close", () => res());
      ws.once("error", () => res());
      setTimeout(res, 1000);
    });

    // Flush
    await new Promise((r) => setTimeout(r, 100));

    const abortEvent = events.find((e) => e.type === "UPGRADE_ABORTED");
    expect(abortEvent).toBeDefined();
    expect(abortEvent!.timestamp).toBeDefined();
  });

  it("securityEvent timestamps are valid ISO 8601", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.reject(403, "Forbidden"));

    const events: SecurityEvent[] = [];
    server.on("securityEvent", (e) => events.push(e));

    const httpServer = await server.listen(0);
    const port = getPort(httpServer);

    await new Promise<void>((res) => {
      const ws = new WebSocket(`ws://localhost:${port}/CP_TS_CHECK`, [
        "ocpp1.6",
      ]);
      ws.once("close", () => res());
      ws.once("error", () => res());
      setTimeout(res, 500);
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
    }
  });
});

// ─── I2: updateTLS ───────────────────────────────────────────────

describe("Phase I — updateTLS()", () => {
  let server: OCPPServer;

  afterEach(async () => {
    if (server) await server.close({ force: true }).catch(() => {});
  });

  it("should throw when called on a non-TLS server (Profile NONE)", () => {
    server = new OCPPServer(); // SecurityProfile.NONE by default
    expect(() => server.updateTLS({ cert: "cert", key: "key" })).toThrow(
      "updateTLS() requires a TLS Security Profile",
    );
  });

  it("should throw when called with BASIC_AUTH (Profile 1 — no TLS)", () => {
    server = new OCPPServer({ securityProfile: SecurityProfile.BASIC_AUTH });
    expect(() => server.updateTLS({ cert: "cert", key: "key" })).toThrow(
      "updateTLS() requires a TLS Security Profile",
    );
  });

  it("should not throw for TLS_BASIC_AUTH profile (even without active server)", () => {
    // No listen() — _httpServers is empty. Should not throw, just log 0 updated.
    server = new OCPPServer({
      securityProfile: SecurityProfile.TLS_BASIC_AUTH,
      tls: { cert: "original", key: "original-key" },
    });
    expect(() =>
      server.updateTLS({ cert: "new-cert", key: "new-key" }),
    ).not.toThrow();
  });

  it("should not throw for TLS_CLIENT_CERT profile", () => {
    server = new OCPPServer({
      securityProfile: SecurityProfile.TLS_CLIENT_CERT,
      tls: { cert: "original", key: "original-key" },
    });
    expect(() => server.updateTLS({ cert: "rotated-cert" })).not.toThrow();
  });

  it("should persist updated tls.cert and tls.key on the options object", () => {
    server = new OCPPServer({
      securityProfile: SecurityProfile.TLS_BASIC_AUTH,
      tls: { cert: "original-cert", key: "original-key" },
    });

    server.updateTLS({ cert: "new-cert", key: "new-key" });

    // @ts-expect-error — private field access for assertions
    expect(server._options.tls?.cert).toBe("new-cert");
    // @ts-expect-error
    expect(server._options.tls?.key).toBe("new-key");
  });

  it("should do a shallow merge — unchanged fields are preserved", () => {
    server = new OCPPServer({
      securityProfile: SecurityProfile.TLS_CLIENT_CERT,
      tls: { cert: "old-cert", key: "stable-key", ca: "ca-cert" },
    });

    // Only rotate the cert
    server.updateTLS({ cert: "rotated-cert" });

    // @ts-expect-error
    const tls = server._options.tls;
    expect(tls?.cert).toBe("rotated-cert");
    expect(tls?.key).toBe("stable-key"); // unchanged
    expect(tls?.ca).toBe("ca-cert"); // unchanged
  });
});
