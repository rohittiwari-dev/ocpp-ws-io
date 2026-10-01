import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { OCPPServer } from "../src/server.js";
import { SecurityProfile } from "../src/types.js";

/**
 * Subprotocol negotiation (OCPP-J §3.2, RFC 6455 §4.2.2). The server picks the
 * first version in its own list that the charger offered. With nothing in
 * common it completes the handshake without a Sec-WebSocket-Protocol header
 * and closes at once (code 1002). A version chosen by the application must be
 * one the charger offered. Route, credential and auth checks run first, so a
 * charger refused for those reasons still gets its HTTP status.
 */

/** What the server answered the upgrade with: status and protocol header. */
interface Upgrade {
  status: number;
  protocol: string | undefined;
}

type Outcome =
  | { kind: "open"; protocol: string; closeCode?: number }
  | { kind: "http"; status: number }
  | { kind: "error"; message: string; upgrade?: Upgrade };

/**
 * The server's answer to an offer it cannot meet. A `ws` client that offered
 * protocols then fails the connection itself (RFC 6455 lets it), before
 * `open`; one that offered none sees the server close it with 1002.
 */
const NO_PROTOCOL: Outcome = {
  kind: "error",
  message: "Server sent no subprotocol",
  upgrade: { status: 101, protocol: undefined },
};

describe("subprotocol negotiation", () => {
  const servers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  async function start(
    protocols: string[] | undefined,
    setup: (server: OCPPServer) => void = () => {},
    securityProfile = SecurityProfile.NONE,
  ) {
    const server = new OCPPServer({
      logging: false,
      securityProfile,
      ...(protocols ? { protocols } : {}),
    });
    servers.push(server);
    const clientProtocols: string[] = [];
    server.on("client", (c) => clientProtocols.push(String(c.protocol)));
    setup(server);
    const { port } = (await server.listen(0)).address() as AddressInfo;
    return { port, clientProtocols };
  }

  /** Connects with the given offer and reports how the server answered. */
  function connect(
    port: number,
    offer: string[],
    headers: Record<string, string> = {},
  ): Promise<Outcome> {
    const ws = new WebSocket(`ws://localhost:${port}/CP-1`, offer, {
      headers,
    });
    sockets.push(ws);
    let upgrade: Upgrade | undefined;
    ws.once("upgrade", (res: IncomingMessage) => {
      const header = res.headers["sec-websocket-protocol"];
      upgrade = {
        status: res.statusCode ?? 0,
        protocol: Array.isArray(header) ? header.join(",") : header,
      };
    });
    return new Promise((resolve) => {
      ws.once("unexpected-response", (_req, res: IncomingMessage) => {
        resolve({ kind: "http", status: res.statusCode ?? 0 });
      });
      ws.once("error", (err) =>
        resolve({ kind: "error", message: err.message, upgrade }),
      );
      ws.once("open", () => {
        const protocol = ws.protocol;
        const timer = setTimeout(
          () => resolve({ kind: "open", protocol }),
          150,
        );
        ws.once("close", (code) => {
          clearTimeout(timer);
          resolve({ kind: "open", protocol, closeCode: code });
        });
      });
    });
  }

  describe("no shared version (S6)", () => {
    it("completes the handshake without a protocol", async () => {
      const { port, clientProtocols } = await start(["ocpp2.0.1"]);

      expect(await connect(port, ["ocpp1.6"])).toEqual(NO_PROTOCOL);
      expect(clientProtocols).toEqual([]);
    });

    it("closes with 1002 when the charger offers no version", async () => {
      const { port, clientProtocols } = await start(["ocpp2.0.1"]);

      expect(await connect(port, [])).toEqual({
        kind: "open",
        protocol: "",
        closeCode: 1002,
      });
      expect(clientProtocols).toEqual([]);
    });

    it("still answers missing credentials with 401", async () => {
      const { port } = await start(
        ["ocpp2.0.1"],
        () => {},
        SecurityProfile.BASIC_AUTH,
      );

      expect(await connect(port, ["ocpp1.6"])).toEqual({
        kind: "http",
        status: 401,
      });
    });

    it("still lets the auth callback reject with its own status", async () => {
      const { port } = await start(["ocpp2.0.1"], (s) =>
        s.auth((ctx) => ctx.reject(403, "Forbidden")),
      );

      expect(await connect(port, ["ocpp1.6"])).toEqual({
        kind: "http",
        status: 403,
      });
    });
  });

  it("keeps the negotiated version when middleware runs without an auth callback (N3)", async () => {
    const { port, clientProtocols } = await start(["ocpp2.0.1"], (s) =>
      s.use(async (ctx) => {
        await ctx.next();
      }),
    );

    expect(await connect(port, ["ocpp1.6", "ocpp2.0.1"])).toEqual({
      kind: "open",
      protocol: "ocpp2.0.1",
    });
    expect(clientProtocols).toEqual(["ocpp2.0.1"]);
  });

  describe("version chosen by the auth callback", () => {
    it("is refused when the charger did not offer it (N4)", async () => {
      const { port, clientProtocols } = await start(["ocpp2.0.1"], (s) =>
        s.auth((ctx) => ctx.accept({ protocol: "ocpp9.9" })),
      );

      expect(await connect(port, ["ocpp2.0.1"])).toEqual(NO_PROTOCOL);
      expect(clientProtocols).toEqual([]);
    });

    it("is used when the charger offered it", async () => {
      const { port, clientProtocols } = await start(["ocpp2.0.1"], (s) =>
        s.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" })),
      );

      expect(await connect(port, ["ocpp2.0.1", "ocpp1.6"])).toEqual({
        kind: "open",
        protocol: "ocpp1.6",
      });
      expect(clientProtocols).toEqual(["ocpp1.6"]);
    });
  });

  describe("server without a protocols list", () => {
    it("takes the charger's first offer", async () => {
      const { port, clientProtocols } = await start(undefined);

      expect(await connect(port, ["ocpp1.6", "ocpp2.0.1"])).toEqual({
        kind: "open",
        protocol: "ocpp1.6",
      });
      expect(clientProtocols).toEqual(["ocpp1.6"]);
    });

    it("takes the charger's first offer with middleware too", async () => {
      const { port, clientProtocols } = await start(undefined, (s) =>
        s.use(async (ctx) => {
          await ctx.next();
        }),
      );

      expect(await connect(port, ["ocpp1.6", "ocpp2.0.1"])).toEqual({
        kind: "open",
        protocol: "ocpp1.6",
      });
      expect(clientProtocols).toEqual(["ocpp1.6"]);
    });
  });
});
