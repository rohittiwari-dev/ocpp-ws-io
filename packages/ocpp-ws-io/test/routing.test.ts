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
    const authSpy = vi.fn((accept, reject, handshake) => {
      accept();
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
    const handshake = authSpy.mock.calls[0][2] as unknown as HandshakeInfo;
    expect(handshake.identity).toBe("CP-LEGACY");
    expect(handshake.pathname).toBe("/ocpp/CP-LEGACY");
    expect(handshake.params.identity).toBeUndefined(); // It was not extracted via router
  });

  it("should match string route and extract params", async () => {
    server = new OCPPServer();
    const authSpy = vi.fn((accept, reject, handshake) => accept());

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
    const handshake = authSpy.mock.calls[0][2] as unknown as HandshakeInfo;
    expect(handshake.identity).toBe("CP-001");
    expect(handshake.pathname).toBe("/api/v1/acme-corp/CP-001");
    expect(handshake.params).toEqual({
      tenant: "acme-corp",
      identity: "CP-001",
    });
  });

  it("should match RegExp route and extract named groups", async () => {
    server = new OCPPServer();
    const authSpy = vi.fn((accept, reject, handshake) => accept());

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
    const handshake = authSpy.mock.calls[0][2] as unknown as HandshakeInfo;
    expect(handshake.identity).toBe("CP-REGEXP");
    expect(handshake.pathname).toBe("/regexp/1.6/CP-REGEXP");
    expect(handshake.params).toEqual({
      version: "1.6",
      identity: "CP-REGEXP",
    });
  });

  it("should reject connection if no route matches", async () => {
    server = new OCPPServer();
    const authSpy = vi.fn((accept, reject, handshake) => accept());

    // ONLY listen on this specific route
    server.route("/strict/:identity").auth(authSpy);
    httpServer = await server.listen(0);

    const ws = new WebSocket(`ws://localhost:${getPort()}/wrongpath/CP-REJECT`);

    const err = await new Promise<Error>((resolve) => {
      ws.on("error", (e) => resolve(e));
      ws.on("open", () => resolve(new Error("Should not have opened")));
    });

    // Node WS client usually gives "Unexpected server response: 400"
    expect(err.message).toMatch(/400/);
    expect(authSpy).not.toHaveBeenCalled();
  });

  it("should match first registered route if multiple match (order matters)", async () => {
    server = new OCPPServer();

    const spy1 = vi.fn((accept, reject, handshake) => accept());
    const spy2 = vi.fn((accept, reject, handshake) => accept());

    server.route("/api/:tenant/:identity").auth(spy1);
    server.route("/api/fallback/:identity").auth(spy2); // This one is more specific but registered second

    httpServer = await server.listen(0);

    // This URL actually matches `/api/:tenant/:identity` where tenant="fallback"
    const ws = new WebSocket(
      `ws://localhost:${getPort()}/api/fallback/CP-MULTI`,
    );

    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
    });

    expect(spy1).toHaveBeenCalledTimes(1);
    const handshake = spy1.mock.calls[0][2] as unknown as HandshakeInfo;
    expect(handshake.params).toEqual({
      tenant: "fallback",
      identity: "CP-MULTI",
    });
  });

  it("should reject connection if no route matches (strict mode)", async () => {
    server = new OCPPServer({ strictMode: true, protocols: ["ocpp1.6"] });
    const authSpy = vi.fn((accept, reject, handshake) => accept());

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
    const authSpy = vi.fn((accept, reject, handshake) => accept());

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
    const handshake = authSpy.mock.calls[0][2] as unknown as HandshakeInfo;
    expect(handshake.pathname).toBe("/api/v1.0/any-unknown-tenant/CP-123");
  });
});
