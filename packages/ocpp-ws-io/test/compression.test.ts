import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";
import type { CompressionOptions } from "../src/types.js";

/**
 * WebSocket compression (RFC 7692 permessage-deflate) is off by default on
 * both sides because of its memory and CPU cost, and on only when asked for.
 * OCPP 2.0.1 / 2.1 require a CSMS to support it (§3.3 / §3.4); a charging
 * station may (RECOMMENDED on mobile data). It is negotiated per connection,
 * so a side that does not use it simply gets uncompressed frames.
 */
describe("WebSocket compression", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    // Last in, first out: a client closes before the server it is connected to.
    for (const c of cleanups.splice(0).reverse()) {
      await c().catch(() => {});
    }
  });

  describe("Node client", () => {
    /** What the client offers to, and agrees with, a server that supports it. */
    async function negotiate(compression?: boolean | CompressionOptions) {
      const http = createServer();
      const wss = new WebSocketServer({
        server: http,
        perMessageDeflate: true,
      });
      let offered: string | undefined;
      let agreed: string | undefined;
      http.on("upgrade", (req) => {
        offered = req.headers["sec-websocket-extensions"];
      });
      wss.on("connection", (ws) => {
        agreed = ws.extensions;
      });
      await new Promise<void>((r) => http.listen(0, () => r()));
      cleanups.push(async () => {
        wss.close();
        await new Promise<void>((r) => http.close(() => r()));
      });
      const { port } = http.address() as AddressInfo;

      const client = new OCPPClient({
        identity: "CP-COMPRESSION",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp2.0.1"],
        reconnect: false,
        logging: false,
        ...(compression === undefined ? {} : { compression }),
      });
      cleanups.push(async () => {
        await client.close({ force: true });
      });
      await client.connect();
      await new Promise((r) => setTimeout(r, 50));
      return { offered, agreed };
    }

    it("offers nothing by default", async () => {
      expect(await negotiate()).toEqual({ offered: undefined, agreed: "" });
    });

    it("offers nothing with compression: false", async () => {
      expect(await negotiate(false)).toEqual({
        offered: undefined,
        agreed: "",
      });
    });

    it("offers and uses it with compression: true", async () => {
      const { offered, agreed } = await negotiate(true);
      expect(offered).toContain("permessage-deflate");
      expect(offered).toContain("client_no_context_takeover");
      expect(agreed).toBe("permessage-deflate");
    });

    it("offers it with compression options", async () => {
      const { offered, agreed } = await negotiate({ level: 1 });
      expect(offered).toContain("permessage-deflate");
      expect(agreed).toBe("permessage-deflate");
    });
  });

  describe("server", () => {
    /** What a charger that offers compression ends up with. */
    async function chargerGets(compression?: boolean | CompressionOptions) {
      const server = new OCPPServer({
        protocols: ["ocpp2.0.1"],
        logging: false,
        ...(compression === undefined ? {} : { compression }),
      });
      cleanups.push(async () => {
        await server.close({ force: true });
      });
      const { port } = (await server.listen(0)).address() as AddressInfo;
      // A plain `ws` client offers permessage-deflate, as such a charger does.
      const ws = new WebSocket(`ws://localhost:${port}/CP-1`, ["ocpp2.0.1"]);
      cleanups.push(async () => {
        ws.terminate();
      });
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      return ws.extensions;
    }

    it("declines it by default", async () => {
      expect(await chargerGets()).toBe("");
    });

    it("agrees to it with compression: true", async () => {
      expect(await chargerGets(true)).toBe("permessage-deflate");
    });

    it("agrees to it with compression options", async () => {
      expect(await chargerGets({ threshold: 512 })).toBe("permessage-deflate");
    });
  });
});
