import { afterEach, describe, expect, test, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import { getClientIp } from "../src/ws-util.js";
import { attachOcppExpress } from "../src/frameworks/express/adapter.js";

describe("handshake & sockets", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  });

  // ws picks the FIRST protocol the client offered unless handleProtocols says
  // otherwise, while the server separately selected the first one *it*
  // supports. When those differ the peer is told it is speaking a version the
  // server is not validating.
  test("the negotiated subprotocol is the one sent on the wire", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity: "CP-PROTO",
      // Offers 2.0.1 first, but the server only supports 1.6.
      protocols: ["ocpp2.0.1", "ocpp1.6"],
      reconnect: false,
    });
    client.on("error", () => {});
    clients.push(client);
    await client.connect();

    expect(client.protocol).toBe("ocpp1.6");
    expect(server.getLocalClient("CP-PROTO")?.protocol).toBe("ocpp1.6");
  }, 20000);

  // maxConnections was compared against _clients.size, which only grows after
  // auth completes — so concurrent handshakes all passed the gate while each
  // was still awaiting an async auth callback.
  test("maxConnections holds under concurrent async auth", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"], maxConnections: 2 });
    servers.push(server);

    server.route("/ocpp/:identity").auth(async (ctx) => {
      // Slow enough that every handshake overlaps.
      await new Promise((r) => setTimeout(r, 120));
      ctx.accept();
    });

    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => {
        const c = new OCPPClient({
          endpoint: `ws://localhost:${port}/ocpp`,
          identity: `CP-${i}`,
          protocols: ["ocpp1.6"],
          reconnect: false,
        });
        c.on("error", () => {});
        clients.push(c);
        return c.connect();
      }),
    );

    const accepted = attempts.filter((a) => a.status === "fulfilled").length;
    expect(accepted).toBeLessThanOrEqual(2);
    expect(server.stats().connectedClients).toBeLessThanOrEqual(2);
  }, 20000);

  test("a rejected upgrade destroys the socket rather than half-closing it", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);
    // A route exists, so an unmatched path is rejected.
    server.route("/ocpp/:identity").auth((ctx) => ctx.accept());
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}/nope`,
      identity: "CP-REJECT",
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    client.on("error", () => {});
    clients.push(client);

    await expect(client.connect()).rejects.toThrow();
    // Server must not be holding the connection open afterwards.
    await new Promise((r) => setTimeout(r, 200));
    expect(server.stats().connectedClients).toBe(0);
  }, 20000);

  test("a filtered-out upgrade does not leak the socket when we are the only listener", async () => {
    const httpServer = createServer();
    await new Promise<void>((r) => httpServer.listen(0, r));
    const ocpp = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(ocpp);

    const binding = attachOcppExpress(httpServer, ocpp, {
      upgradePathPrefix: "/ocpp",
    });

    const socket = {
      destroyed: false,
      destroy: vi.fn(function (this: { destroyed: boolean }) {
        this.destroyed = true;
      }),
    };
    httpServer.emit(
      "upgrade",
      { headers: { upgrade: "websocket", host: "x" }, url: "/other" },
      socket,
      Buffer.from(""),
    );

    expect(socket.destroy).toHaveBeenCalledTimes(1);

    binding.dispose();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  test("a filtered-out upgrade is left alone when another listener exists", async () => {
    const httpServer = createServer();
    await new Promise<void>((r) => httpServer.listen(0, r));
    const ocpp = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(ocpp);

    // Somebody else's WebSocket library on the same server.
    httpServer.on("upgrade", () => {});
    const binding = attachOcppExpress(httpServer, ocpp, {
      upgradePathPrefix: "/ocpp",
    });

    const socket = { destroyed: false, destroy: vi.fn() };
    httpServer.emit(
      "upgrade",
      { headers: { upgrade: "websocket", host: "x" }, url: "/other" },
      socket,
      Buffer.from(""),
    );

    expect(socket.destroy).not.toHaveBeenCalled();

    binding.dispose();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });
});

describe("getClientIp", () => {
  const req = (xff?: string) =>
    ({
      headers: xff ? { "x-forwarded-for": xff } : {},
      socket: { remoteAddress: "10.0.0.1" },
    }) as never;

  test("ignores X-Forwarded-For unless a proxy is trusted", () => {
    expect(getClientIp(req("203.0.113.9"), undefined)).toBe("10.0.0.1");
    expect(getClientIp(req("203.0.113.9"), false)).toBe("10.0.0.1");
  });

  test("uses the leftmost forwarded entry when trusted", () => {
    expect(getClientIp(req("203.0.113.9"), true)).toBe("203.0.113.9");
    expect(getClientIp(req("203.0.113.9, 70.41.3.18, 10.0.0.5"), true)).toBe(
      "203.0.113.9",
    );
  });

  test("falls back to the socket address when the header is absent or empty", () => {
    expect(getClientIp(req(), true)).toBe("10.0.0.1");
    expect(getClientIp(req("   "), true)).toBe("10.0.0.1");
  });
});
