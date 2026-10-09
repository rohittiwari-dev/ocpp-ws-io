import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";
import {
  type AuthCallback,
  type HandshakeInfo,
  SecurityProfile,
  type TLSOptions,
} from "../src/types/index.js";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", "tls", name));
const RSA = { cert: fixture("rsa.crt"), key: fixture("rsa.key") };

/**
 * `handshake.url` is the URL a charger asked for: scheme (ws, or wss over
 * TLS), host, path and query. `handshake.endpoint` is that path without the
 * identity's segment.
 */
describe("handshake url and endpoint", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  /** A server whose auth callback records each handshake it sees. */
  async function start(
    options: { route?: string; tls?: TLSOptions; rename?: string } = {},
  ) {
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: false,
      ...(options.tls
        ? {
            securityProfile: SecurityProfile.TLS_BASIC_AUTH,
            requireBasicAuth: false,
            tls: options.tls,
          }
        : {}),
    });
    servers.push(server);
    const seen: HandshakeInfo[] = [];
    const record: AuthCallback = (ctx) => {
      seen.push(ctx.handshake);
      ctx.accept(options.rename ? { identity: options.rename } : undefined);
    };
    if (options.route) server.route(options.route).auth(record);
    else server.auth(record);
    const { port } = (await server.listen(0)).address() as AddressInfo;
    return { server, port, seen };
  }

  async function connect(
    identity: string,
    endpoint: string,
    extra: { query?: Record<string, string> } = {},
  ) {
    const client = new OCPPClient({
      identity,
      endpoint,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
      ...extra,
    });
    clients.push(client);
    await client.connect();
    return client;
  }

  /** A raw socket, for paths the client does not build (identity mid-path). */
  function openRaw(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, ["ocpp1.6"]);
      sockets.push(ws);
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  }

  it("gives the requested URL with its query, and the path without the identity", async () => {
    const { port, seen } = await start();
    await connect("CP001", `ws://localhost:${port}/ocpp`, {
      query: { token: "abc" },
    });
    expect(seen[0].url).toBe(`ws://localhost:${port}/ocpp/CP001?token=abc`);
    expect(seen[0].endpoint).toBe("/ocpp");
    expect(seen[0].pathname).toBe("/ocpp/CP001");
  });

  it("gives / as the endpoint when the identity is the whole path", async () => {
    const { port, seen } = await start();
    await connect("CP002", `ws://localhost:${port}`);
    expect(seen[0].url).toBe(`ws://localhost:${port}/CP002`);
    expect(seen[0].endpoint).toBe("/");
  });

  it("drops an encoded identity's segment", async () => {
    const { port, seen } = await start();
    await connect("CP 003", `ws://localhost:${port}/ocpp`);
    expect(seen[0].identity).toBe("CP 003");
    expect(seen[0].url).toBe(`ws://localhost:${port}/ocpp/CP%20003`);
    expect(seen[0].endpoint).toBe("/ocpp");
  });

  it("drops the identity's segment when a route takes it mid-path", async () => {
    const { port, seen } = await start({ route: "/api/:identity/v16" });
    await openRaw(`ws://localhost:${port}/api/CP004/v16`);
    expect(seen[0].identity).toBe("CP004");
    expect(seen[0].endpoint).toBe("/api/v16");
    expect(seen[0].url).toBe(`ws://localhost:${port}/api/CP004/v16`);
  });

  it("uses wss over TLS", async () => {
    const { port, seen } = await start({ tls: RSA });
    const client = new OCPPClient({
      identity: "CP005",
      endpoint: `wss://localhost:${port}/ocpp`,
      protocols: ["ocpp1.6"],
      securityProfile: SecurityProfile.TLS_BASIC_AUTH,
      password: "0123456789abcdef",
      reconnect: false,
      logging: false,
      tls: { ca: RSA.cert },
    });
    clients.push(client);
    await client.connect();
    expect(seen[0].url).toBe(`wss://localhost:${port}/ocpp/CP005`);
    expect(seen[0].endpoint).toBe("/ocpp");
  });

  it("keeps the requested endpoint when auth changes the identity", async () => {
    const { server, port } = await start({ rename: "CP-RENAMED" });
    const connected = new Promise<HandshakeInfo>((resolve) =>
      server.on("client", (c) => resolve(c.handshake)),
    );
    await connect("CP006", `ws://localhost:${port}/ocpp`);
    const handshake = await connected;
    expect(handshake.identity).toBe("CP-RENAMED");
    expect(handshake.endpoint).toBe("/ocpp");
    expect(handshake.url).toBe(`ws://localhost:${port}/ocpp/CP006`);
  });
});
