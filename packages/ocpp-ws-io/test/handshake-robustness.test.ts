import { createServer } from "node:http";
import { describe, it, expect, afterEach, vi } from "vitest";
import WebSocket from "ws";
import { OCPPServer } from "../src/server";
import { SecurityProfile } from "../src/types";

describe("OCPPServer - Handshake Robustness", () => {
  let server: ReturnType<typeof createServer>;
  let ocppServer: OCPPServer;
  let port: number;

  const startServer = async (opts?: { handshakeTimeoutMs?: number }) => {
    server = createServer();
    ocppServer = new OCPPServer({
      securityProfile: SecurityProfile.BASIC_AUTH,
      ...opts,
    });
    server.on("upgrade", ocppServer.handleUpgrade);
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    port = (server.address() as any).port;
  };

  afterEach(async () => {
    if (server) server.close();
    if (ocppServer) await ocppServer.close();
  });

  it("should emit upgradeAborted when client disconnects during auth", async () => {
    await startServer();

    const abortedPromise = new Promise<any>((resolve) => {
      ocppServer.on("upgradeAborted", resolve);
    });

    // Auth callback that never resolves
    ocppServer.auth((_ctx) => {
      // Intentionally never settle — simulate slow DB lookup
      return new Promise(() => {});
    });

    const ws = new WebSocket(
      `ws://localhost:${port}/abort-test-01`,
      ["ocpp1.6"],
      {
        headers: {
          Authorization:
            "Basic " + Buffer.from("abort-test-01:pass").toString("base64"),
        },
      },
    );

    ws.on("error", () => {}); // Suppress client error

    // Wait for connection to reach server
    await new Promise((r) => setTimeout(r, 100));

    // Kill client connection
    ws.terminate();

    // Verify upgradeAborted was emitted
    const aborted = await Promise.race([
      abortedPromise,
      new Promise((r) => setTimeout(() => r(null), 2000)),
    ]);

    expect(aborted).not.toBeNull();
    expect(aborted.identity).toBe("abort-test-01");
    expect(aborted.reason).toBe("Socket closed during handshake");
  });

  it("should abort handshake on timeout", async () => {
    await startServer({ handshakeTimeoutMs: 200 });

    const abortedPromise = new Promise<any>((resolve) => {
      ocppServer.on("upgradeAborted", resolve);
    });

    ocppServer.auth((_ctx) => {
      // Never settle — triggers timeout
      return new Promise(() => {});
    });

    const ws = new WebSocket(
      `ws://localhost:${port}/timeout-test-01`,
      ["ocpp1.6"],
      {
        headers: {
          Authorization:
            "Basic " + Buffer.from("timeout-test-01:pass").toString("base64"),
        },
      },
    );

    ws.on("error", () => {});

    const aborted = await Promise.race([
      abortedPromise,
      new Promise((r) => setTimeout(() => r(null), 2000)),
    ]);

    expect(aborted).not.toBeNull();
    expect(aborted.identity).toBe("timeout-test-01");
    expect(aborted.reason).toBe("Handshake timeout");

    ws.terminate();
  });

  it("should connect successfully with valid auth", async () => {
    await startServer();

    ocppServer.auth((ctx) => {
      if (ctx.handshake.password?.toString() === "correctpassword") {
        ctx.accept();
      }
    });

    const ws = new WebSocket(
      `ws://localhost:${port}/valid-test-01`,
      ["ocpp1.6"],
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from("valid-test-01:correctpassword").toString("base64"),
        },
      },
    );

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
      ws.on("error", reject);
    });
  });

  it("should support colons in identity via Basic Auth", async () => {
    await startServer();

    let capturedPassword: Buffer | undefined;

    ocppServer.auth((ctx) => {
      capturedPassword = ctx.handshake.password;
      ctx.accept();
    });

    const identity = "station:01";
    const password = "secret:password";
    const authString = `${identity}:${password}`;
    const authHeader = "Basic " + Buffer.from(authString).toString("base64");

    const ws = new WebSocket(
      `ws://localhost:${port}/${encodeURIComponent(identity)}`,
      ["ocpp1.6"],
      { headers: { Authorization: authHeader } },
    );

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
      ws.on("error", reject);
    });

    expect(capturedPassword).toBeDefined();
    expect(capturedPassword?.toString()).toBe(password);
  });
});
