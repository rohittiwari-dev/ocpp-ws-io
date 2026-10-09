import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, {
  type ClientOptions as WsLibClientOptions,
  type ServerOptions as WsLibServerOptions,
  WebSocketServer,
} from "ws";
import { OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";
import type { LoggerLike } from "../src/types.js";
import { unchecked } from "../src/core/unchecked.js";

/**
 * `wssOptions` (gap G3): raw `ws` server options, passed through to
 * `new WebSocketServer()`. Its type leaves out what the server sets itself
 * (binding, subprotocol choice, client verification, payload limit,
 * compression, client tracking, automatic pongs); from plain JavaScript those
 * are dropped with one warning naming what to use instead. Pings are always
 * answered on both sides (RFC 6455 §5.5.2): chargers disconnect without pongs.
 */
describe("ServerOptions.wssOptions", () => {
  const servers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];
  const plainServers: WebSocketServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
    for (const s of plainServers.splice(0)) {
      await new Promise<void>((r) => s.close(() => r()));
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

  async function start(
    options: ConstructorParameters<typeof OCPPServer>[0] = {},
  ) {
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: false,
      ...options,
    });
    servers.push(server);
    server.on("client", (c) => c.handle(unchecked("Echo"), ({ params }) => params));
    const http = await server.listen(0);
    return { server, port: (http.address() as AddressInfo).port };
  }

  /** A raw `ws` charger, so frames, pings and fragments are under control. */
  function connect(port: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://localhost:${port}/CP-1`, ["ocpp1.6"]);
    sockets.push(ws);
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  }

  /** Records the options `ws` hands to every server-side socket it creates. */
  function recordingSocket() {
    const seen: Array<ConstructorParameters<typeof WebSocket>[2]> = [];
    class Recording extends WebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        seen.push(args[2]);
      }
    }
    // `ws` creates server-side sockets as `new WebSocket(null, undefined,
    // options)`; that `null` overload is not part of the subclass's declared
    // constructor, so it is passed as the class `ws` expects.
    return { Recording: Recording as typeof WebSocket, seen };
  }

  it("passes WebSocket, closeTimeout and allowSynchronousEvents through", async () => {
    const { Recording, seen } = recordingSocket();
    const { port } = await start({
      wssOptions: {
        WebSocket: Recording,
        closeTimeout: 1234,
        allowSynchronousEvents: false,
      },
    });

    await connect(port);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      closeTimeout: 1234,
      allowSynchronousEvents: false,
    });
  });

  it("applies maxFragments to messages from chargers", async () => {
    const { port } = await start({ wssOptions: { maxFragments: 2 } });
    const ws = await connect(port);
    const closed = new Promise<number>((resolve) => {
      ws.once("close", (code) => resolve(code));
    });

    // One message in three fragments.
    ws.send('[2,"1","Echo",', { fin: false });
    ws.send('{"a":', { fin: false });
    ws.send("1}]", { fin: true });

    // `ws` closes with 1008 (Policy Violation): "Too many message fragments".
    expect(await closed).toBe(1008);
  });

  it("drops options it does not take when passed from JavaScript, with one warning", async () => {
    const { warnings, logging } = capture();
    // Typed as the full `ws` options, the way untyped JavaScript passes them.
    // Applied, each of these would break the server: port with noServer
    // throws, verifyClient refuses every charger, handleProtocols drops the
    // subprotocol, maxPayload rejects a normal message, clientTracking breaks
    // stats(), autoPong leaves charger pings unanswered.
    const fromJavaScript: WsLibServerOptions = {
      port: 1,
      host: "203.0.113.1",
      backlog: 1,
      path: "/elsewhere",
      noServer: false,
      verifyClient: () => false,
      handleProtocols: () => false,
      maxPayload: 10,
      perMessageDeflate: true,
      clientTracking: false,
      autoPong: false,
    };
    const { server, port } = await start({ logging, wssOptions: fromJavaScript });

    const ws = await connect(port);
    expect(ws.protocol).toBe("ocpp1.6");
    expect(ws.extensions).toBe(""); // no compression

    const answer = new Promise<string>((resolve) => {
      ws.once("message", (data) => resolve(String(data)));
    });
    ws.send(JSON.stringify([2, "m1", "Echo", { text: "x".repeat(200) }]));
    expect(JSON.parse(await answer)).toEqual([3, "m1", { text: "x".repeat(200) }]);

    const pong = new Promise<void>((resolve) => ws.once("pong", () => resolve()));
    ws.ping();
    await pong;

    expect(server.stats().webSockets?.total).toBe(1);
    const found = warnings.filter((w) => w.message.includes("wssOptions"));
    expect(found).toHaveLength(1);
    expect(found[0].ignored).toEqual([
      "port (use listen(port))",
      "host (use listen(port, host))",
      "backlog (set it on your own HTTP server)",
      "path (use route())",
      "noServer (always on: use listen() or handleUpgrade)",
      "verifyClient (use auth(), middleware or isKnownIdentity)",
      "handleProtocols (use protocols)",
      "maxPayload (use maxPayloadBytes)",
      "perMessageDeflate (use compression)",
      "clientTracking (always on: stats() needs it)",
      "autoPong (always on: pings are answered, RFC 6455 §5.5.2)",
    ]);
  });

  it("applies reconfigure({ wssOptions }) to new connections", async () => {
    const { server, port } = await start();
    const { Recording, seen } = recordingSocket();

    server.reconfigure({ wssOptions: { WebSocket: Recording } });
    await connect(port);

    expect(seen).toHaveLength(1);
  });

  it("client: autoPong passed from JavaScript is dropped, pings are still answered", async () => {
    const plain = new WebSocketServer({ port: 0 });
    plainServers.push(plain);
    await new Promise<void>((r) => plain.once("listening", () => r()));
    const pongs = new Promise<void>((resolve) => {
      plain.on("connection", (ws) => {
        ws.once("pong", () => resolve());
        ws.ping();
      });
    });
    const { warnings, logging } = capture();
    const fromJavaScript: WsLibClientOptions = { autoPong: false };

    const client = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${(plain.address() as AddressInfo).port}`,
      reconnect: false,
      logging,
      wsOpts: fromJavaScript,
    });
    clients.push(client);
    await client.connect();

    await pongs;
    expect(
      warnings.find((w) => w.message.includes("wsOpts"))?.ignored,
    ).toEqual(["autoPong (always on: pings are answered, RFC 6455 §5.5.2)"]);
  });
});
