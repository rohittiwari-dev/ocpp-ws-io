import { readFileSync } from "node:fs";
import { Agent } from "node:http";
import { createServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientOptions as WsLibClientOptions } from "ws";
import { OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";
import type { OCPPServerClient } from "../src/server/server-client.js";
import {
  type ClientOptions,
  type LoggerLike,
  SecurityProfile,
} from "../src/types.js";

/**
 * `wsOpts` (gap G2): raw `ws` client options, passed through
 * to `new WebSocket()`. Its type leaves out the options the client sets
 * itself (`handshakeTimeout`, `perMessageDeflate`, `headers`, TLS settings),
 * which have their own client options; from plain JavaScript they are
 * dropped with a warning naming the option to use. `tls` applies on every
 * security profile, so TLS settings have one home.
 */
describe("ClientOptions.wsOpts", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];
  const httpsServers: HttpsServer[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
    for (const h of httpsServers.splice(0)) {
      await new Promise<void>((r) => h.close(() => r()));
    }
  });

  function capture() {
    const warnings: Array<{ message: string; ignored?: string[] }> = [];
    const logger: LoggerLike = {
      debug() {},
      info() {},
      error() {},
      warn(message, meta) {
        warnings.push({ message, ignored: meta?.ignored as string[] });
      },
    };
    return { warnings, logging: { logger } };
  }

  /** A CSMS that records the handshake of the charger that connects. */
  async function csms(
    options: ConstructorParameters<typeof OCPPServer>[0] = {},
  ) {
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: false,
      ...options,
    });
    servers.push(server);
    let connected: OCPPServerClient | undefined;
    server.on("client", (c) => {
      connected = c;
    });
    const http = await server.listen(0);
    return {
      server,
      url: `ws://localhost:${(http.address() as AddressInfo).port}`,
      client: () => connected,
    };
  }

  function charger(endpoint: string, options: Partial<ClientOptions>) {
    const client = new OCPPClient({
      identity: "CP-1",
      endpoint,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
      ...options,
    });
    clients.push(client);
    return client;
  }

  const countHeader = (raw: string[], name: string) =>
    raw.filter((h, i) => i % 2 === 0 && h.toLowerCase() === name).length;

  it("passes an agent through, e.g. for an HTTP proxy", async () => {
    const { url } = await csms();
    const agent = new Agent();
    const used = vi.spyOn(agent, "createConnection");

    await charger(url, { wsOpts: { agent } }).connect();

    expect(used).toHaveBeenCalled();
  });

  it("sends origin from wsOpts and extra headers from headers", async () => {
    const { url, client } = await csms();

    await charger(url, {
      headers: { "X-Site": "depot-7" },
      wsOpts: { origin: "https://cp.example" },
    }).connect();

    const headers = client()?.handshake.headers;
    expect(headers?.origin).toBe("https://cp.example");
    expect(headers?.["x-site"]).toBe("depot-7");
  });

  it("applies maxPayload to messages from the CSMS", async () => {
    const { url, client } = await csms();
    const c = charger(url, { wsOpts: { maxPayload: 1024 } });
    const errors: string[] = [];
    c.on("error", (e) => errors.push(e.message));
    await c.connect();
    const csmsSide = client();
    const closedAtCsms = new Promise<number>((resolve) => {
      csmsSide?.once("close", ({ code }) => resolve(code));
    });

    csmsSide
      ?.call("DataTransfer", { vendorId: "x", data: "y".repeat(4096) })
      .catch(() => {});

    // The charger refuses the frame and tells the CSMS why.
    expect(await closedAtCsms).toBe(1009); // Message Too Big
    expect(errors).toContain("Max payload size exceeded");
  });

  it("applies tls on every security profile, e.g. ca on profile 0", async () => {
    const dir = join(__dirname, "fixtures", "tls");
    const cert = readFileSync(join(dir, "rsa.crt"));
    const key = readFileSync(join(dir, "rsa.key"));
    const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    servers.push(server);
    const https = createServer({ cert, key });
    httpsServers.push(https);
    https.on("upgrade", server.handleUpgrade);
    await new Promise<void>((r) => https.listen(0, () => r()));
    const url = `wss://localhost:${(https.address() as AddressInfo).port}`;

    // The self-signed certificate is refused without it...
    await expect(charger(url, {}).connect()).rejects.toThrow();
    // ...and trusted with it, although profile 0 has no TLS of its own.
    await expect(
      charger(url, {
        securityProfile: SecurityProfile.NONE,
        tls: { ca: cert },
      }).connect(),
    ).resolves.toBeDefined();
  });

  it("drops options it does not take when passed from JavaScript, with a warning", async () => {
    const { url, client } = await csms({ compression: true });
    const { warnings, logging } = capture();
    // Typed as the full `ws` options, the way untyped JavaScript passes them.
    // Applied, a 1 ms handshake timeout would fail the connection, and
    // perMessageDeflate would turn on compression nobody asked for.
    const fromJavaScript: WsLibClientOptions = {
      handshakeTimeout: 1,
      perMessageDeflate: true,
      headers: { "user-agent": "spoofed" },
    };

    await charger(url, { logging, wsOpts: fromJavaScript }).connect();

    const headers = client()?.handshake.headers;
    expect(headers?.["sec-websocket-extensions"]).toBeUndefined();
    expect(headers?.["user-agent"]).toContain("ocpp-ws-io");
    const found = warnings.filter((w) => w.message.includes("wsOpts"));
    expect(found).toHaveLength(1);
    expect(found[0].ignored).toEqual([
      "handshakeTimeout (use connectTimeoutMs)",
      "perMessageDeflate (use compression)",
      "headers (use headers)",
    ]);
  });

  it("sends one Authorization header, from password, whatever the case in headers", async () => {
    const { url, client } = await csms({
      securityProfile: SecurityProfile.BASIC_AUTH,
    });
    servers[0].auth((ctx) => ctx.accept());

    await charger(url, {
      securityProfile: SecurityProfile.BASIC_AUTH,
      password: "correct-horse-battery",
      headers: { authorization: "Basic ZXZpbDpldmls" },
    }).connect();

    const handshake = client()?.handshake;
    expect(handshake?.password?.toString()).toBe("correct-horse-battery");
    expect(
      countHeader(handshake?.request.rawHeaders ?? [], "authorization"),
    ).toBe(1);
  });
});
