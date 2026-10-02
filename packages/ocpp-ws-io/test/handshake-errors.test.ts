import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { combineAuth } from "../src/helpers/index.js";
import { OCPPServer } from "../src/server.js";
import type { LoggerLike, SecurityEvent } from "../src/types.js";

/**
 * A rejection the developer chose (`ctx.reject(code, message)`) answers with
 * that status and message. Anything else thrown during the handshake is a bug
 * or an outage, not a verdict on the charger: it is answered with a bare 500,
 * its details are logged on the server only, and it never takes the process
 * down. A 401 here makes chargers record FailedToAuthenticateAtCsms, so an
 * outage must not be reported as one.
 */
describe("handshake errors in auth callbacks and connection middleware", () => {
  const httpServers: Server[] = [];
  const ocppServers: OCPPServer[] = [];
  const unhandled: string[] = [];
  const onUnhandled = (reason: Error | string) => {
    unhandled.push(reason instanceof Error ? reason.message : String(reason));
  };

  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
  });

  afterEach(async () => {
    process.off("unhandledRejection", onUnhandled);
    for (const s of ocppServers.splice(0)) await s.close({ force: true });
    for (const s of httpServers.splice(0)) {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  const secret = "db error: password=hunter2 host=10.0.0.5";
  const tick = () => new Promise<void>((r) => setTimeout(r, 10));

  interface Logged {
    level: "warn" | "error";
    message: string;
    meta?: Record<string, string | number | undefined>;
  }

  async function start(setup: (server: OCPPServer) => void) {
    const logged: Logged[] = [];
    const logger: LoggerLike = {
      debug() {},
      info() {},
      warn(message, meta) {
        logged.push({ level: "warn", message, meta: meta as Logged["meta"] });
      },
      error(message, meta) {
        logged.push({ level: "error", message, meta: meta as Logged["meta"] });
      },
    };
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      handshakeTimeoutMs: 3000,
      logging: { logger },
    });
    ocppServers.push(server);
    const events: SecurityEvent[] = [];
    server.on("securityEvent", (e: SecurityEvent) => events.push(e));
    setup(server);
    const http = createServer();
    httpServers.push(http);
    http.on("upgrade", server.handleUpgrade);
    await new Promise<void>((r) => http.listen(0, () => r()));
    const { port } = http.address() as AddressInfo;
    return { port, logged, events };
  }

  interface Answer {
    opened: boolean;
    status: number;
    body: string;
    headers: IncomingHttpHeaders;
    ms: number;
  }

  /** A raw upgrade, so the status line, headers and body are all visible. */
  function upgrade(port: number, identity = "CP-1"): Promise<Answer> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const req = request({
        port,
        path: `/${identity}`,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": Buffer.from("0123456789abcdef").toString(
            "base64",
          ),
          "Sec-WebSocket-Protocol": "ocpp1.6",
        },
      });
      req.on("upgrade", (res, socket) => {
        socket.destroy();
        resolve({
          opened: true,
          status: res.statusCode ?? 0,
          body: "",
          headers: res.headers,
          ms: Date.now() - started,
        });
      });
      req.on("response", (res) => {
        let body = "";
        res.on("data", (d: Buffer) => {
          body += d.toString();
        });
        res.on("end", () =>
          resolve({
            opened: false,
            status: res.statusCode ?? 0,
            body,
            headers: res.headers,
            ms: Date.now() - started,
          }),
        );
      });
      req.on("error", reject);
      req.end();
    });
  }

  const challenge = 'Basic realm="ocpp-ws-io", charset="UTF-8"';

  describe("ctx.reject() keeps the status and message the developer chose", () => {
    it("from a sync auth callback", async () => {
      const { port, events } = await start((s) =>
        s.auth((ctx) => ctx.reject(403, "Forbidden")),
      );
      const answer = await upgrade(port);
      expect([answer.status, answer.body]).toEqual([403, "Forbidden"]);
      expect(events.map((e) => e.type)).toEqual(["AUTH_FAILED"]);
    });

    it("from an async auth callback, without an unhandled rejection", async () => {
      const { port } = await start((s) =>
        s.auth(async (ctx) => {
          await tick();
          ctx.reject(403, "Forbidden");
        }),
      );
      const answer = await upgrade(port);
      await tick();
      expect([answer.status, answer.body]).toEqual([403, "Forbidden"]);
      expect(unhandled).toEqual([]);
    });

    it("from connection middleware", async () => {
      const { port } = await start((s) => {
        s.use(async (ctx) => ctx.reject(429, "Too Many Requests"));
        s.auth((ctx) => ctx.accept());
      });
      const answer = await upgrade(port);
      expect([answer.status, answer.body]).toEqual([429, "Too Many Requests"]);
    });

    it("a 401 carries the WWW-Authenticate challenge (RFC 9110 §15.5.2)", async () => {
      const { port } = await start((s) => s.auth((ctx) => ctx.reject()));
      const answer = await upgrade(port);
      expect(answer.status).toBe(401);
      expect(answer.headers["www-authenticate"]).toBe(challenge);
    });

    it("a status outside 400–599 is answered 500 and logged", async () => {
      const { port, logged } = await start((s) =>
        s.auth((ctx) => ctx.reject(11000, "Duplicate")),
      );
      const answer = await upgrade(port);
      expect(answer.status).toBe(500);
      expect(
        logged.some((l) => l.level === "warn" && l.meta?.code === 11000),
      ).toBe(true);
    });
  });

  describe("anything else thrown is answered 500 without details", () => {
    const cases: Array<[string, (server: OCPPServer) => void, string]> = [
      [
        "an Error thrown by a sync auth callback",
        (s) =>
          s.auth(() => {
            throw new Error(secret);
          }),
        secret,
      ],
      [
        "an Error thrown by an async auth callback",
        (s) =>
          s.auth(async () => {
            await tick();
            throw new Error(secret);
          }),
        secret,
      ],
      [
        "an Error thrown by connection middleware",
        (s) => {
          s.use(async () => {
            await tick();
            throw new Error(secret);
          });
          s.auth((ctx) => ctx.accept());
        },
        secret,
      ],
      [
        "a thrown value that is not an Error",
        (s) =>
          s.auth(() => {
            throw "boom";
          }),
        "boom",
      ],
      [
        "an Error whose numeric code is not an HTTP status (MongoDB 11000)",
        (s) =>
          s.auth(() => {
            throw Object.assign(new Error(secret), { code: 11000 });
          }),
        secret,
      ],
      [
        "an exception inside combineAuth",
        (s) =>
          s.auth(
            combineAuth(async () => {
              await tick();
              throw new Error(secret);
            }),
          ),
        secret,
      ],
    ];

    for (const [name, setup, detail] of cases) {
      it(name, async () => {
        const { port, logged, events } = await start(setup);
        const answer = await upgrade(port);
        await tick();

        // The charger learns nothing about the failure...
        expect([answer.status, answer.body]).toEqual([
          500,
          "Internal Server Error",
        ]);
        expect(answer.headers["www-authenticate"]).toBeUndefined();
        // ...promptly, not after the handshake timeout...
        expect(answer.ms).toBeLessThan(1000);
        // ...while the server logs what happened...
        expect(
          logged.some(
            (l) => l.level === "error" && l.meta?.error === detail,
          ),
        ).toBe(true);
        // ...reports it as an error rather than an authentication failure...
        expect(events.map((e) => e.type)).toEqual(["UPGRADE_ERROR"]);
        expect(events[0].identity).toBe("CP-1");
        // ...and nothing is left unhandled to crash the process.
        expect(unhandled).toEqual([]);
      });
    }

    it("middleware that ends without next() or reject()", async () => {
      const { port, logged } = await start((s) => {
        s.use(async () => {});
        s.auth((ctx) => ctx.accept());
      });
      const answer = await upgrade(port);
      expect([answer.status, answer.body]).toEqual([
        500,
        "Internal Server Error",
      ]);
      expect(logged.some((l) => l.level === "error")).toBe(true);
    });
  });

  it("combineAuth: a rejection keeps its status, without an unhandled rejection", async () => {
    const { port } = await start((s) =>
      s.auth(
        combineAuth(async (ctx) => {
          await tick();
          ctx.reject(403, "Forbidden");
        }),
      ),
    );
    const answer = await upgrade(port);
    await tick();
    expect([answer.status, answer.body]).toEqual([403, "Forbidden"]);
    expect(unhandled).toEqual([]);
  });

  it("an error after accept() is logged and the connection stays open", async () => {
    const { port, logged } = await start((s) =>
      s.auth(async (ctx) => {
        ctx.accept();
        await tick();
        throw new Error("late failure");
      }),
    );
    const answer = await upgrade(port);
    await tick();
    await tick();
    expect(answer.opened).toBe(true);
    expect(
      logged.some((l) => l.level === "error" && l.meta?.error === "late failure"),
    ).toBe(true);
    expect(unhandled).toEqual([]);
  });
});
