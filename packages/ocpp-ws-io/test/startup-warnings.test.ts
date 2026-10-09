import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";
import type { LoggerLike } from "../src/types/index.js";

/**
 * Two settings that are fine in development and unsafe in production each log
 * one warning when they take effect: an unauthenticated /health and /metrics,
 * and respondWithDetailedErrors, which sends a handler error's properties to
 * the peer in CALLERROR details.
 */
describe("startup warnings for unsafe settings", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  function capture() {
    const warnings: string[] = [];
    const logger: LoggerLike = {
      debug() {},
      info() {},
      error() {},
      warn(message) {
        warnings.push(message);
      },
    };
    return { warnings, logging: { logger } };
  }

  const detailed = (warnings: string[]) =>
    warnings.filter((w) => w.includes("respondWithDetailedErrors"));
  const health = (warnings: string[]) =>
    warnings.filter((w) => w.includes("/health"));

  describe("respondWithDetailedErrors", () => {
    it("server: warns once when created with it on", () => {
      const { warnings, logging } = capture();
      servers.push(new OCPPServer({ respondWithDetailedErrors: true, logging }));
      expect(detailed(warnings)).toHaveLength(1);
      expect(detailed(warnings)[0]).toContain("chargers");
    });

    it("server: stays quiet when it is off (the default)", () => {
      const { warnings, logging } = capture();
      servers.push(new OCPPServer({ logging }));
      expect(detailed(warnings)).toEqual([]);
    });

    it("server: warns when reconfigure() turns it on, not when it was already on", () => {
      const { warnings, logging } = capture();
      const server = new OCPPServer({ logging });
      servers.push(server);
      server.reconfigure({ respondWithDetailedErrors: true });
      server.reconfigure({ respondWithDetailedErrors: true });
      expect(detailed(warnings)).toHaveLength(1);
    });

    it("server: does not warn again for each charger that connects", async () => {
      const { warnings, logging } = capture();
      const server = new OCPPServer({
        protocols: ["ocpp1.6"],
        respondWithDetailedErrors: true,
        logging,
      });
      servers.push(server);
      const http: Server = await server.listen(0);
      const { port } = http.address() as { port: number };
      for (const id of ["CP-1", "CP-2"]) {
        const ws = new WebSocket(`ws://localhost:${port}/${id}`, ["ocpp1.6"]);
        await new Promise<void>((resolve, reject) => {
          ws.once("open", () => resolve());
          ws.once("error", reject);
        });
        ws.terminate();
      }
      expect(detailed(warnings)).toHaveLength(1);
    });

    it("client: warns once when created with it on", () => {
      const { warnings, logging } = capture();
      clients.push(
        new OCPPClient({
          identity: "CP-1",
          endpoint: "ws://localhost:1",
          respondWithDetailedErrors: true,
          logging,
        }),
      );
      expect(detailed(warnings)).toHaveLength(1);
      expect(detailed(warnings)[0]).toContain("CSMS");
    });

    it("client: warns when reconfigure() turns it on", () => {
      const { warnings, logging } = capture();
      const client = new OCPPClient({
        identity: "CP-1",
        endpoint: "ws://localhost:1",
        logging,
      });
      clients.push(client);
      expect(detailed(warnings)).toEqual([]);
      client.reconfigure({ respondWithDetailedErrors: true });
      expect(detailed(warnings)).toHaveLength(1);
    });

    it("browser client: warns once when created with it on", () => {
      const { warnings, logging } = capture();
      new BrowserOCPPClient({
        identity: "CP-1",
        endpoint: "ws://localhost:1",
        respondWithDetailedErrors: true,
        logging,
      });
      expect(detailed(warnings)).toHaveLength(1);
    });
  });

  describe("healthEndpoint without auth", () => {
    async function listenWith(
      healthEndpoint: ConstructorParameters<typeof OCPPServer>[0] extends
        | infer O
        | undefined
        ? O extends { healthEndpoint?: infer H }
          ? H
          : never
        : never,
    ) {
      const { warnings, logging } = capture();
      const server = new OCPPServer({ healthEndpoint, logging });
      servers.push(server);
      await server.listen(0);
      return health(warnings);
    }

    it("warns when listen() serves it with healthEndpoint: true", async () => {
      const found = await listenWith(true);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("/metrics");
    });

    it("warns for an options object without auth", async () => {
      expect(await listenWith({})).toHaveLength(1);
    });

    it("stays quiet with auth", async () => {
      expect(await listenWith({ auth: { bearer: "token" } })).toEqual([]);
    });

    it("stays quiet when the endpoint is off", async () => {
      expect(await listenWith(false)).toEqual([]);
    });
  });
});
