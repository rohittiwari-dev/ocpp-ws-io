import { describe, expect, it, afterEach, vi } from "vitest";
import { OCPPServer } from "../src/server.js";
import http from "node:http";
import { WebSocket } from "ws";
import type { HandshakeInfo } from "../src/types.js";

describe("OCPPServer - Express-like Routing", () => {
  let server: OCPPServer;
  let httpServer: http.Server;

  afterEach(async () => {
    if (server) await server.close();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  const getPort = () => {
    const address = httpServer.address();
    if (address && typeof address === "object") return address.port;
    return 0;
  };

  it("should match default fallback route (legacy behavior)", async () => {
    server = new OCPPServer();
    const authSpy = vi.fn((ctx) => {
      ctx.accept();
    });

    // No route specified
    server.auth(authSpy);
    httpServer = await server.listen(0);

    const ws = new WebSocket(`ws://localhost:${getPort()}/ocpp/CP-LEGACY`);

    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
    });

    expect(authSpy).toHaveBeenCalledTimes(1);
    const handshake = authSpy.mock.calls[0][0]
      .handshake as unknown as HandshakeInfo;
    expect(handshake.identity).toBe("CP-LEGACY");
    expect(handshake.pathname).toBe("/ocpp/CP-LEGACY");
    expect(handshake.params.identity).toBeUndefined(); // It was not extracted via router
  });

  it("should match string route and extract params", async () => {
    server = new OCPPServer();
    const authSpy = vi.fn((ctx) => ctx.accept());

    server.route("/api/v1/:tenant/:identity").auth(authSpy);
    httpServer = await server.listen(0);

    const ws = new WebSocket(
      `ws://localhost:${getPort()}/api/v1/acme-corp/CP-001`,
    );

    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
    });

    expect(authSpy).toHaveBeenCalledTimes(1);
    const handshake = authSpy.mock.calls[0][0]
      .handshake as unknown as HandshakeInfo;
    expect(handshake.identity).toBe("CP-001");
    expect(handshake.pathname).toBe("/api/v1/acme-corp/CP-001");
    expect(handshake.params).toEqual({
      tenant: "acme-corp",
      identity: "CP-001",
    });
  });

  it("should match RegExp route and extract named groups", async () => {
    server = new OCPPServer();
    const authSpy = vi.fn((ctx) => ctx.accept());

    // RegExp with named capture groups
    server
      .route(/^\/regexp\/(?<version>[^/]+)\/(?<identity>[^/]+)$/)
      .auth(authSpy);
    httpServer = await server.listen(0);

    const ws = new WebSocket(
      `ws://localhost:${getPort()}/regexp/1.6/CP-REGEXP`,
    );

    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
    });

    expect(authSpy).toHaveBeenCalledTimes(1);
    const handshake = authSpy.mock.calls[0][0]
      .handshake as unknown as HandshakeInfo;
    expect(handshake.identity).toBe("CP-REGEXP");
    expect(handshake.pathname).toBe("/regexp/1.6/CP-REGEXP");
    expect(handshake.params).toEqual({
      version: "1.6",
      identity: "CP-REGEXP",
    });
  });

  it("should reject connection if no route matches", async () => {
    server = new OCPPServer();
    const authSpy = vi.fn((ctx) => ctx.accept());

    // ONLY listen on this specific route
    server.route("/strict/:identity").auth(authSpy);
    httpServer = await server.listen(0);

    const ws = new WebSocket(`ws://localhost:${getPort()}/wrongpath/CP-REJECT`);

    const err = await new Promise<Error>((resolve) => {
      ws.on("error", (e) => resolve(e));
      ws.on("open", () => resolve(new Error("Should not have opened")));
    });

    // Node WS client usually gives "Unexpected server response: 404"
    expect(err.message).toMatch(/404/);
    expect(authSpy).not.toHaveBeenCalled();
  });

  it("should match most specific route by specificity (static segments beat params)", async () => {
    server = new OCPPServer();

    const spy1 = vi.fn((ctx) => ctx.accept());
    const spy2 = vi.fn((ctx) => ctx.accept());

    server.route("/api/:tenant/:identity").auth(spy1);
    server.route("/api/fallback/:identity").auth(spy2); // More specific — static "fallback" wins over :tenant

    httpServer = await server.listen(0);

    // This URL matches both routes, but `/api/fallback/:identity` is more specific
    // because "fallback" is a static segment (static > param in trie priority)
    const ws = new WebSocket(
      `ws://localhost:${getPort()}/api/fallback/CP-MULTI`,
    );

    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
    });

    // spy2's route is more specific (static "fallback"), so it provides the auth handler
    expect(spy2).toHaveBeenCalledTimes(1);
    const handshake = spy2.mock.calls[0][0]
      .handshake as unknown as HandshakeInfo;
    expect(handshake.params).toEqual({
      identity: "CP-MULTI",
    });
  });

  it("should reject connection if no route matches (strict mode)", async () => {
    server = new OCPPServer({ strictMode: true, protocols: ["ocpp1.6"] });
    const authSpy = vi.fn((ctx) => ctx.accept());

    // ONLY listen on this specific route
    server.route("/strict/:identity").auth(authSpy);
    httpServer = await server.listen(0);

    const ws = new WebSocket(`ws://localhost:${getPort()}/wrongpath/CP-REJECT`);

    const err = await new Promise<Error>((resolve) => {
      ws.on("error", (e) => resolve(e));
      ws.on("open", () => resolve(new Error("Should not have opened")));
    });

    expect(err.message).toMatch(/400/);
    expect(authSpy).not.toHaveBeenCalled();
  });

  it("should match Express-style wildcard routes securely", async () => {
    server = new OCPPServer();
    const authSpy = vi.fn((ctx) => ctx.accept());

    // Matches /api/v1.0 (with literal dot) and anything following
    server.route("/api/v1.0/*").auth(authSpy);
    httpServer = await server.listen(0);

    const ws = new WebSocket(
      `ws://localhost:${getPort()}/api/v1.0/any-unknown-tenant/CP-123`,
    );

    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
    });

    expect(authSpy).toHaveBeenCalledTimes(1);
    const handshake = authSpy.mock.calls[0][0]
      .handshake as unknown as HandshakeInfo;
    expect(handshake.pathname).toBe("/api/v1.0/any-unknown-tenant/CP-123");
  });

  it("should override timeout and ping configurations per router", async () => {
    server = new OCPPServer({
      pingIntervalMs: 30000,
      callTimeoutMs: 30000,
    });

    server
      .route("/custom/*")
      .config({
        pingIntervalMs: 60000,
        callTimeoutMs: 60000,
      })
      .auth((ctx) => ctx.accept());

    server.route("/default/*").auth((ctx) => ctx.accept());

    let customClientTimeout = 0;
    let defaultClientTimeout = 0;

    server.on("client", (client) => {
      if (client.identity === "CP-CUSTOM") {
        customClientTimeout = client.options.callTimeoutMs ?? 0;
      } else if (client.identity === "CP-DEFAULT") {
        defaultClientTimeout = client.options.callTimeoutMs ?? 0;
      }
    });

    httpServer = await server.listen(0);

    const ws1 = new WebSocket(`ws://localhost:${getPort()}/custom/CP-CUSTOM`);
    await new Promise<void>((resolve) => {
      ws1.on("open", () => {
        ws1.close();
        resolve();
      });
    });

    const ws2 = new WebSocket(`ws://localhost:${getPort()}/default/CP-DEFAULT`);
    await new Promise<void>((resolve) => {
      ws2.on("open", () => {
        ws2.close();
        resolve();
      });
    });

    // CP-CUSTOM should have the overridden 60000ms timeout
    expect(customClientTimeout).toBe(60000);
    // CP-DEFAULT should inherit the global 30000ms timeout
    expect(defaultClientTimeout).toBe(30000);
  });

  it("should enforce allowed subprotocols per router", async () => {
    // Global server supports both 1.6 and 2.0.1
    server = new OCPPServer({
      protocols: ["ocpp1.6", "ocpp2.0.1"],
    });

    // The legacy route ONLY supports 1.6
    server
      .route("/legacy/*")
      .config({ protocols: ["ocpp1.6"] })
      .auth((ctx) => ctx.accept());

    httpServer = await server.listen(0);

    // Connecting with ocpp1.6 should succeed
    const wsSuccess = new WebSocket(
      `ws://localhost:${getPort()}/legacy/CP-16`,
      ["ocpp1.6"],
    );

    const successError = await new Promise<Error | null>((resolve) => {
      wsSuccess.on("error", (e) => resolve(e));
      wsSuccess.on("open", () => {
        wsSuccess.close();
        resolve(null);
      });
    });
    expect(successError).toBeNull();

    // Connecting with ocpp2.0.1 to the legacy route should FAIL
    const wsFail = new WebSocket(`ws://localhost:${getPort()}/legacy/CP-201`, [
      "ocpp2.0.1",
    ]);

    const failError = await new Promise<Error>((resolve) => {
      wsFail.on("error", (e) => resolve(e));
      wsFail.on("open", () => resolve(new Error("Should not have opened")));
    });

    // Protocol mismatch causes immediate connection rejection
    expect(failError.message).toMatch(/400/);
  });
});
