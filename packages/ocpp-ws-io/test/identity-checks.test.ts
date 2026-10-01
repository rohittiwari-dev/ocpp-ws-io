import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { OCPPServer } from "../src/server.js";
import {
  type HandshakeInfo,
  type SecurityEvent,
  SecurityProfile,
} from "../src/types.js";

/**
 * Who may connect, by charging station identity.
 *
 * - `isKnownIdentity`: "If the CSMS does not recognize the Charging Station
 *   identifier in the URL path, it SHOULD send an HTTP response with status
 *   404" (OCPP-J §3.2). Runs before middleware and the auth callback.
 * - `duplicateConnection`: the spec does not say what to do when a charger
 *   connects while already connected. By default the new connection replaces
 *   the old one; "reject" refuses the new one with 409 instead.
 */
describe("identity checks", () => {
  const servers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  type Outcome = { opened: true } | { opened: false; status: number };

  function connect(
    port: number,
    identity: string,
    headers: Record<string, string> = {},
  ): Promise<{ outcome: Outcome; ws: WebSocket }> {
    const ws = new WebSocket(
      `ws://localhost:${port}/${identity}`,
      ["ocpp1.6"],
      {
        headers,
      },
    );
    sockets.push(ws);
    return new Promise((resolve) => {
      ws.once("open", () => resolve({ outcome: { opened: true }, ws }));
      ws.once("unexpected-response", (_req, res: IncomingMessage) =>
        resolve({
          outcome: { opened: false, status: res.statusCode ?? 0 },
          ws,
        }),
      );
      ws.once("error", () => {});
    });
  }

  describe("isKnownIdentity", () => {
    async function start(
      isKnownIdentity: (
        identity: string,
        handshake: HandshakeInfo,
      ) => boolean | Promise<boolean>,
      securityProfile = SecurityProfile.NONE,
    ) {
      const server = new OCPPServer({
        protocols: ["ocpp1.6"],
        logging: false,
        securityProfile,
        isKnownIdentity,
      });
      servers.push(server);
      const order: string[] = [];
      server.use(async (ctx) => {
        order.push("middleware");
        await ctx.next();
      });
      server.auth((ctx) => {
        order.push("auth");
        ctx.accept();
      });
      const events: SecurityEvent[] = [];
      server.on("securityEvent", (e: SecurityEvent) => events.push(e));
      const { port } = (await server.listen(0)).address() as AddressInfo;
      return { port, order, events };
    }

    it("answers 404 for an unknown identity, before middleware and auth", async () => {
      const { port, order, events } = await start((id) => id === "CP-KNOWN");

      const { outcome } = await connect(port, "CP-UNKNOWN");

      expect(outcome).toEqual({ opened: false, status: 404 });
      expect(order).toEqual([]);
      expect(events).toEqual([
        expect.objectContaining({
          type: "AUTH_FAILED",
          identity: "CP-UNKNOWN",
          details: { code: 404, message: "Unknown charging station" },
        }),
      ]);
    });

    it("lets a known identity through middleware and auth", async () => {
      const { port, order } = await start((id) => id === "CP-KNOWN");

      const { outcome } = await connect(port, "CP-KNOWN");

      expect(outcome).toEqual({ opened: true });
      expect(order).toEqual(["middleware", "auth"]);
    });

    it("awaits an async lookup and passes the handshake", async () => {
      const seen: string[] = [];
      const { port } = await start(async (id, handshake) => {
        seen.push(`${id}:${handshake.identity}`);
        await new Promise((r) => setTimeout(r, 20));
        return true;
      });

      const { outcome } = await connect(port, "CP-ASYNC");

      expect(outcome).toEqual({ opened: true });
      expect(seen).toEqual(["CP-ASYNC:CP-ASYNC"]);
    });

    it("answers 500 when the lookup fails", async () => {
      const { port, order, events } = await start(() => {
        throw new Error("database down");
      });

      const { outcome } = await connect(port, "CP-1");

      expect(outcome).toEqual({ opened: false, status: 500 });
      expect(order).toEqual([]);
      // An outage, not an unknown charger.
      expect(events).toEqual([
        expect.objectContaining({
          type: "UPGRADE_ERROR",
          identity: "CP-1",
          details: { error: "database down" },
        }),
      ]);
    });

    it("is not reached when Basic Auth credentials are missing", async () => {
      let lookups = 0;
      const { port } = await start(() => {
        lookups++;
        return false;
      }, SecurityProfile.BASIC_AUTH);

      const { outcome } = await connect(port, "CP-1");

      expect(outcome).toEqual({ opened: false, status: 401 });
      expect(lookups).toBe(0);
    });
  });

  describe("duplicateConnection", () => {
    async function start(duplicateConnection?: "replace" | "reject") {
      const server = new OCPPServer({
        protocols: ["ocpp1.6"],
        logging: false,
        ...(duplicateConnection ? { duplicateConnection } : {}),
      });
      servers.push(server);
      const { port } = (await server.listen(0)).address() as AddressInfo;
      return { server, port };
    }

    const closed = (ws: WebSocket) =>
      new Promise<boolean>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve(true);
        const timer = setTimeout(() => resolve(false), 300);
        ws.once("close", () => {
          clearTimeout(timer);
          resolve(true);
        });
      });

    it("replaces the old connection by default", async () => {
      const { port } = await start();
      const first = await connect(port, "CP-DUP");
      const second = await connect(port, "CP-DUP");

      expect(second.outcome).toEqual({ opened: true });
      expect(await closed(first.ws)).toBe(true);
    });

    it('refuses the new connection with 409 when set to "reject"', async () => {
      const { server, port } = await start("reject");
      const events: SecurityEvent[] = [];
      server.on("securityEvent", (e: SecurityEvent) => events.push(e));
      const first = await connect(port, "CP-DUP");
      const second = await connect(port, "CP-DUP");

      expect(second.outcome).toEqual({ opened: false, status: 409 });
      expect(await closed(first.ws)).toBe(false);
      expect(events).toEqual([
        expect.objectContaining({
          type: "AUTH_FAILED",
          details: { code: 409, message: "Charging station already connected" },
        }),
      ]);
    });

    it('lets the charger back in once its old connection is gone ("reject")', async () => {
      const { port } = await start("reject");
      const first = await connect(port, "CP-DUP");
      first.ws.close();
      await closed(first.ws);
      await new Promise((r) => setTimeout(r, 50));

      const again = await connect(port, "CP-DUP");
      expect(again.outcome).toEqual({ opened: true });
    });
  });
});
