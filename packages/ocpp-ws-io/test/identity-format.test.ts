import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { OCPPServer } from "../src/server/server.js";
import type { OCPPProtocol } from "../src/types.js";

/**
 * Charging station identity rules (OCPP-J §3.1.1). 2.0.1 and 2.1: an
 * identifierString (a-z A-Z 0-9 * - _ = + | @ .) without ":" (2.1 "SHALL
 * NOT", 2.0.1 errata 2023-12 "SHALL not"), at most 48 characters. 1.6J sets
 * no rule. `maxIdentityLength`, when set, is enforced on every connection
 * and replaces the spec's length; otherwise strict mode applies the spec's
 * rules for the negotiated version, and without strict mode anything goes.
 * A violation is answered with HTTP 400.
 */
describe("identity format", () => {
  const servers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  async function start(
    protocol: OCPPProtocol,
    options: { strictMode?: true | OCPPProtocol[]; maxIdentityLength?: number },
  ) {
    const { strictMode, maxIdentityLength } = options;
    const server = strictMode
      ? new OCPPServer({
          protocols: [protocol],
          strictMode,
          maxIdentityLength,
          logging: false,
        })
      : new OCPPServer({
          protocols: [protocol],
          maxIdentityLength,
          logging: false,
        });
    servers.push(server);
    const { port } = (await server.listen(0)).address() as AddressInfo;
    return { port, protocol };
  }

  /** The HTTP status the server answers with; 101 when the connection opens. */
  function status(
    { port, protocol }: { port: number; protocol: OCPPProtocol },
    identity: string,
  ): Promise<number> {
    const ws = new WebSocket(
      `ws://localhost:${port}/${encodeURIComponent(identity)}`,
      [protocol],
    );
    sockets.push(ws);
    return new Promise((resolve) => {
      ws.once("open", () => resolve(101));
      ws.once("unexpected-response", (_req, res: IncomingMessage) =>
        resolve(res.statusCode ?? 0),
      );
      ws.once("error", () => {});
    });
  }

  const LONG_49 = "a".repeat(49);
  const LONG_60 = "a".repeat(60);

  describe("without maxIdentityLength or strictMode", () => {
    it("accepts any identity", async () => {
      const server = await start("ocpp2.0.1", {});

      expect(await status(server, LONG_60)).toBe(101);
      expect(await status(server, "CP:01")).toBe(101);
      expect(await status(server, "RDAM 123")).toBe(101);
    });
  });

  describe("strictMode, without maxIdentityLength: the spec's rules", () => {
    for (const protocol of ["ocpp2.0.1", "ocpp2.1"] as const) {
      it(`limits ${protocol} identities to 48 characters`, async () => {
        const server = await start(protocol, { strictMode: true });

        expect(await status(server, "a".repeat(48))).toBe(101);
        expect(await status(server, LONG_49)).toBe(400);
      });

      it(`allows only identifierString characters, without ":", on ${protocol}`, async () => {
        const server = await start(protocol, { strictMode: true });

        expect(await status(server, "RDAM|123")).toBe(101);
        expect(await status(server, "cp-01_A*=+@.x")).toBe(101);
        expect(await status(server, "CP:01")).toBe(400);
        expect(await status(server, "RDAM 123")).toBe(400);
        expect(await status(server, "CP/01")).toBe(400);
      });
    }

    it("sets no rule on 1.6", async () => {
      const server = await start("ocpp1.6", { strictMode: true });

      expect(await status(server, LONG_60)).toBe(101);
      expect(await status(server, "CP:01")).toBe(101);
    });

    it("skips versions a strictMode list leaves out", async () => {
      const server = await start("ocpp2.0.1", { strictMode: ["ocpp2.1"] });

      expect(await status(server, LONG_60)).toBe(101);
    });
  });

  describe("maxIdentityLength", () => {
    it("is enforced without strictMode, with no character rules", async () => {
      const server = await start("ocpp2.0.1", { maxIdentityLength: 20 });

      expect(await status(server, "a".repeat(20))).toBe(101);
      expect(await status(server, "a".repeat(21))).toBe(400);
      expect(await status(server, "CP:01")).toBe(101);
    });

    it("replaces the spec's length in strictMode, keeping its character rules", async () => {
      const server = await start("ocpp2.0.1", {
        strictMode: true,
        maxIdentityLength: 60,
      });

      expect(await status(server, LONG_60)).toBe(101);
      expect(await status(server, "a".repeat(61))).toBe(400);
      expect(await status(server, "CP:01")).toBe(400);
    });

    it("applies on 1.6 too", async () => {
      const server = await start("ocpp1.6", { maxIdentityLength: 10 });

      expect(await status(server, "a".repeat(11))).toBe(400);
    });

    it("counts characters, not bytes", async () => {
      const server = await start("ocpp1.6", { maxIdentityLength: 3 });

      expect(await status(server, "äöü")).toBe(101);
    });

    it("can be changed with reconfigure()", async () => {
      const server = await start("ocpp1.6", {});
      expect(await status(server, "a".repeat(11))).toBe(101);

      servers[servers.length - 1]?.reconfigure({ maxIdentityLength: 10 });

      expect(await status(server, "a".repeat(11))).toBe(400);
      expect(() =>
        servers[servers.length - 1]?.reconfigure({ maxIdentityLength: 0 }),
      ).toThrow(/maxIdentityLength/);
    });

    for (const bad of [0, -1, 1.5, Number.NaN]) {
      it(`must be a positive integer (${bad})`, () => {
        expect(
          () =>
            new OCPPServer({
              protocols: ["ocpp1.6"],
              maxIdentityLength: bad,
              logging: false,
            }),
        ).toThrow(/maxIdentityLength/);
      });
    }
  });
});
