import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { OCPPServer } from "../src/server.js";
import {
  type LoggerLike,
  type SecurityEvent,
  SecurityProfile,
} from "../src/types.js";

/**
 * Under security profile 1 and 2 the charging station SHALL send a username
 * and password with every connection request, and the username SHALL equal
 * its identity (A00.FR.203/204, A00.FR.302/303; 1.6 security whitepaper
 * likewise). A request without them is answered with HTTP 401 (Figure 2).
 */
describe("security profile 1 and 2: Basic Auth credentials", () => {
  const httpServers: Server[] = [];
  const ocppServers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const s of ocppServers.splice(0)) await s.close({ force: true });
    for (const s of httpServers.splice(0)) {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  /** Profile 2 is checked the same way; TLS itself is not under test here. */
  async function start(
    profile: SecurityProfile,
    logger?: LoggerLike,
    requireBasicAuth?: boolean,
  ) {
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      securityProfile: profile,
      requireBasicAuth,
      logging: logger ? { logger } : false,
    });
    ocppServers.push(server);
    const http = createServer();
    httpServers.push(http);
    http.on("upgrade", server.handleUpgrade);
    await new Promise<void>((r) => http.listen(0, () => r()));
    const { port } = http.address() as AddressInfo;
    return { server, port };
  }

  type Outcome =
    | { opened: true }
    | { opened: false; status: number; wwwAuthenticate?: string };

  function connect(
    port: number,
    identity: string,
    authorization?: string,
  ): Promise<Outcome> {
    const ws = new WebSocket(
      `ws://localhost:${port}/${identity}`,
      ["ocpp1.6"],
      {
        headers: authorization ? { Authorization: authorization } : {},
      },
    );
    sockets.push(ws);
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve({ opened: true }));
      ws.once("unexpected-response", (_req, res: IncomingMessage) => {
        resolve({
          opened: false,
          status: res.statusCode ?? 0,
          wwwAuthenticate: res.headers["www-authenticate"],
        });
      });
      ws.once("error", (err) => {
        if (!/Unexpected server response/.test(err.message)) reject(err);
      });
    });
  }

  const basic = (userPass: string) =>
    `Basic ${Buffer.from(userPass).toString("base64")}`;

  const refused = {
    opened: false,
    status: 401,
    wwwAuthenticate: 'Basic realm="ocpp-ws-io", charset="UTF-8"',
  };

  for (const profile of [
    SecurityProfile.BASIC_AUTH,
    SecurityProfile.TLS_BASIC_AUTH,
  ]) {
    describe(`profile ${profile}`, () => {
      it("answers 401 when the Authorization header is missing", async () => {
        const { port } = await start(profile);
        expect(await connect(port, "CP-1")).toEqual(refused);
      });

      it("answers 401 when the username is not the identity", async () => {
        const { port } = await start(profile);
        expect(
          await connect(port, "CP-1", basic("CP-2:0123456789abcdef")),
        ).toEqual(refused);
      });

      it("answers 401 when the password is empty", async () => {
        const { port } = await start(profile);
        expect(await connect(port, "CP-1", basic("CP-1:"))).toEqual(refused);
      });

      it("answers 401 for a header that is not Basic", async () => {
        const { port } = await start(profile);
        expect(await connect(port, "CP-1", "Bearer abc")).toEqual(refused);
      });

      it("does not reach the auth callback when credentials are missing", async () => {
        const { server, port } = await start(profile);
        let authCalls = 0;
        server.auth((ctx) => {
          authCalls++;
          ctx.accept();
        });

        await connect(port, "CP-1");
        expect(authCalls).toBe(0);
      });

      it("reports the refusal as an AUTH_FAILED security event", async () => {
        const { server, port } = await start(profile);
        const events: SecurityEvent[] = [];
        server.on("securityEvent", (e: SecurityEvent) => events.push(e));

        await connect(port, "CP-1");
        expect(events).toEqual([
          expect.objectContaining({
            type: "AUTH_FAILED",
            identity: "CP-1",
            details: { code: 401, message: "Unauthorized" },
          }),
        ]);
      });

      it("hands the password to the auth callback when the username is the identity", async () => {
        const { server, port } = await start(profile);
        const passwords: string[] = [];
        server.auth((ctx) => {
          passwords.push(ctx.handshake.password?.toString() ?? "");
          ctx.accept();
        });

        expect(
          await connect(port, "CP-1", basic("CP-1:0123456789abcdef")),
        ).toEqual({ opened: true });
        expect(passwords).toEqual(["0123456789abcdef"]);
      });
    });
  }

  describe("requireBasicAuth: false", () => {
    it("lets the auth callback decide on a connection without credentials", async () => {
      const { server, port } = await start(
        SecurityProfile.BASIC_AUTH,
        undefined,
        false,
      );
      const passwords: Array<Buffer | undefined> = [];
      server.auth((ctx) => {
        passwords.push(ctx.handshake.password);
        ctx.accept();
      });

      expect(await connect(port, "CP-1")).toEqual({ opened: true });
      expect(passwords).toEqual([undefined]);
    });

    it("can be switched at runtime through reconfigure()", async () => {
      const { server, port } = await start(SecurityProfile.BASIC_AUTH);
      server.auth((ctx) => ctx.accept());

      expect(await connect(port, "CP-1")).toEqual(refused);
      server.reconfigure({ requireBasicAuth: false });
      expect(await connect(port, "CP-2")).toEqual({ opened: true });
    });
  });

  it("still accepts a connection without credentials on profile 0", async () => {
    const { port } = await start(SecurityProfile.NONE);
    expect(await connect(port, "CP-1")).toEqual({ opened: true });
  });

  describe("warning when no auth callback checks the credentials", () => {
    function recordingLogger() {
      const warnings: string[] = [];
      const logger: LoggerLike = {
        warn: (message) => warnings.push(message),
        child: () => logger,
      };
      return { logger, warnings };
    }
    const NO_AUTH = /no auth callback/i;

    for (const profile of [
      SecurityProfile.BASIC_AUTH,
      SecurityProfile.TLS_BASIC_AUTH,
      SecurityProfile.TLS_CLIENT_CERT,
    ]) {
      it(`logs once on profile ${profile}`, async () => {
        const { logger, warnings } = recordingLogger();
        const { port } = await start(profile, logger);

        await connect(port, "CP-1", basic("CP-1:0123456789abcdef"));
        await connect(port, "CP-2", basic("CP-2:0123456789abcdef"));
        expect(warnings.filter((w) => NO_AUTH.test(w))).toHaveLength(1);
      });
    }

    it("stays quiet when an auth callback is registered", async () => {
      const { logger, warnings } = recordingLogger();
      const { server, port } = await start(SecurityProfile.BASIC_AUTH, logger);
      server.auth((ctx) => ctx.accept());

      await connect(port, "CP-1", basic("CP-1:0123456789abcdef"));
      expect(warnings.filter((w) => NO_AUTH.test(w))).toEqual([]);
    });

    it("stays quiet on profile 0", async () => {
      const { logger, warnings } = recordingLogger();
      const { port } = await start(SecurityProfile.NONE, logger);

      await connect(port, "CP-1");
      expect(warnings.filter((w) => NO_AUTH.test(w))).toEqual([]);
    });
  });
});
