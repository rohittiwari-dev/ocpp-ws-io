import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";
import type { OCPPServerClient } from "../src/server-client.js";
import type {
  MessageIdGenerator,
  MessageIdValidator,
  OCPPCallError,
} from "../src/types.js";

type Protocol = "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1";
type Frame = Array<string | number | object>;

/**
 * Message IDs (OCPP-J §4.1.4): a string of at most 36 characters, unique for
 * the sender. Outgoing IDs come from the per-call idempotencyKey, else the
 * idGenerator option, else a random UUID. Incoming CALL / SEND IDs are checked
 * by the idValidator option when set; otherwise, in strict mode only, against
 * the 36-character limit. A rejected ID is answered like an unreadable one,
 * under "-1": RpcFrameworkError on 2.0.1 / 2.1, GenericError on 1.6, whose
 * error-code table has no RpcFrameworkError.
 */

// Node 20 has no global WebSocket; the browser client gets the `ws` one.
const originalWebSocket = Object.getOwnPropertyDescriptor(
  globalThis,
  "WebSocket",
);
beforeAll(() => {
  Object.defineProperty(globalThis, "WebSocket", {
    value: WebSocket,
    configurable: true,
    writable: true,
  });
});
afterAll(() => {
  if (originalWebSocket) {
    Object.defineProperty(globalThis, "WebSocket", originalWebSocket);
  } else {
    Reflect.deleteProperty(globalThis, "WebSocket");
  }
});

const ID_36 = "a".repeat(36);
const ID_60 = "b".repeat(60);
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

interface ServerSetup {
  strictMode?: boolean | Protocol[];
  idGenerator?: MessageIdGenerator;
  idValidator?: MessageIdValidator;
  callConcurrency?: number;
}

describe("message IDs", () => {
  const servers: OCPPServer[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0)) await close().catch(() => {});
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  async function startServer(protocol: Protocol, setup: ServerSetup = {}) {
    const { strictMode, ...rest } = setup;
    const server = strictMode
      ? new OCPPServer({
          protocols: [protocol],
          strictMode,
          logging: false,
          ...rest,
        })
      : new OCPPServer({ protocols: [protocol], logging: false, ...rest });
    servers.push(server);
    const heartbeats: string[] = [];
    const sends: string[] = [];
    const badMessages: string[] = [];
    let serverClient: OCPPServerClient | undefined;
    server.on("client", (c) => {
      serverClient = c;
      c.on("badMessage", ({ error }: { error: Error }) =>
        badMessages.push(error.message),
      );
      c.handle("Heartbeat", ({ messageId }) => {
        heartbeats.push(messageId);
        return { currentTime: "2026-01-01T00:00:00Z" };
      });
      if (protocol === "ocpp2.1") {
        c.handle("NotifyPeriodicEventStream", ({ messageId }) => {
          sends.push(messageId);
        });
      }
    });
    const { port } = (await server.listen(0)).address() as AddressInfo;
    return {
      port,
      heartbeats,
      sends,
      badMessages,
      getClient: () => serverClient,
    };
  }

  /** A raw charger, to send frames the clients would never produce. */
  async function rawCharger(port: number, protocol: Protocol) {
    const ws = new WebSocket(`ws://localhost:${port}/CP-ID`, [protocol]);
    closers.push(async () => ws.terminate());
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const received: Frame[] = [];
    ws.on("message", (d) => received.push(JSON.parse(d.toString())));
    await settle(50);
    return { ws, received };
  }

  const heartbeat = (id: string) => JSON.stringify([2, id, "Heartbeat", {}]);

  describe("incoming CALL IDs", () => {
    for (const protocol of ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"] as const) {
      it(`accepts an ID over 36 characters when strictMode is off (${protocol})`, async () => {
        const { port, heartbeats } = await startServer(protocol);
        const { ws, received } = await rawCharger(port, protocol);

        ws.send(heartbeat(ID_60));
        await settle();

        expect(heartbeats).toEqual([ID_60]);
        expect(received[0]?.slice(0, 2)).toEqual([3, ID_60]);
      });

      it(`answers an ID over 36 characters under "-1" in strict mode (${protocol})`, async () => {
        const { port, heartbeats, badMessages } = await startServer(protocol, {
          strictMode: true,
        });
        const { ws, received } = await rawCharger(port, protocol);

        ws.send(heartbeat(ID_60));
        await settle();

        const code =
          protocol === "ocpp1.6" ? "GenericError" : "RpcFrameworkError";
        expect(received.map((f) => f.slice(0, 3))).toEqual([[4, "-1", code]]);
        expect(heartbeats).toEqual([]);
        expect(badMessages).toHaveLength(1);
      });
    }

    it("accepts exactly 36 characters in strict mode", async () => {
      const { port, heartbeats } = await startServer("ocpp2.0.1", {
        strictMode: true,
      });
      const { ws } = await rawCharger(port, "ocpp2.0.1");

      ws.send(heartbeat(ID_36));
      await settle();

      expect(heartbeats).toEqual([ID_36]);
    });

    it("leaves a protocol outside a strictMode list unchecked", async () => {
      const { port, heartbeats } = await startServer("ocpp1.6", {
        strictMode: ["ocpp2.0.1"],
      });
      const { ws } = await rawCharger(port, "ocpp1.6");

      ws.send(heartbeat(ID_60));
      await settle();

      expect(heartbeats).toEqual([ID_60]);
    });
  });

  describe("idValidator", () => {
    const noBad: MessageIdValidator = (id) => !id.startsWith("bad-");

    it("decides even when strictMode is off", async () => {
      const { port, heartbeats } = await startServer("ocpp2.0.1", {
        idValidator: noBad,
      });
      const { ws, received } = await rawCharger(port, "ocpp2.0.1");

      ws.send(heartbeat("bad-1"));
      ws.send(heartbeat("good-1"));
      await settle();

      expect(received.map((f) => f.slice(0, 3))).toEqual([
        [4, "-1", "RpcFrameworkError"],
        [3, "good-1", { currentTime: "2026-01-01T00:00:00Z" }],
      ]);
      expect(heartbeats).toEqual(["good-1"]);
    });

    it("answers GenericError on 1.6", async () => {
      const { port } = await startServer("ocpp1.6", { idValidator: noBad });
      const { ws, received } = await rawCharger(port, "ocpp1.6");

      ws.send(heartbeat("bad-1"));
      await settle();

      expect(received.map((f) => f.slice(0, 3))).toEqual([
        [4, "-1", "GenericError"],
      ]);
    });

    it("replaces the 36-character check in strict mode", async () => {
      const { port, heartbeats } = await startServer("ocpp2.0.1", {
        strictMode: true,
        idValidator: () => true,
      });
      const { ws } = await rawCharger(port, "ocpp2.0.1");

      ws.send(heartbeat(ID_60));
      await settle();

      expect(heartbeats).toEqual([ID_60]);
    });

    it("treats a throw as a rejection and reports what was thrown", async () => {
      const { port, heartbeats, badMessages } = await startServer("ocpp2.0.1", {
        idValidator: () => {
          throw new Error("lookup failed");
        },
      });
      const { ws, received } = await rawCharger(port, "ocpp2.0.1");

      ws.send(heartbeat("m1"));
      await settle();

      expect(received.map((f) => f.slice(0, 3))).toEqual([
        [4, "-1", "RpcFrameworkError"],
      ]);
      expect(heartbeats).toEqual([]);
      expect(badMessages).toEqual([expect.stringContaining("lookup failed")]);
    });
  });

  it("never answers a SEND with a rejected ID, but counts it (2.1)", async () => {
    const { port, sends, badMessages } = await startServer("ocpp2.1", {
      strictMode: true,
    });
    const { ws, received } = await rawCharger(port, "ocpp2.1");

    ws.send(
      JSON.stringify([
        6,
        ID_60,
        "NotifyPeriodicEventStream",
        { id: 1, pending: 0, basetime: "2026-01-01T00:00:00Z", data: [] },
      ]),
    );
    await settle();

    expect(received).toEqual([]);
    expect(sends).toEqual([]);
    expect(badMessages).toHaveLength(1);
  });

  describe("outgoing IDs", () => {
    async function serverCalls(setup: ServerSetup) {
      const started = await startServer("ocpp1.6", setup);
      const { ws, received } = await rawCharger(started.port, "ocpp1.6");
      // Answer every CALL so the server's calls settle.
      ws.on("message", (d) => {
        const frame: Frame = JSON.parse(d.toString());
        if (frame[0] === 2) {
          ws.send(JSON.stringify([3, frame[1], { status: "Accepted" }]));
        }
      });
      const client = started.getClient();
      if (!client) throw new Error("no server client");
      return { client, received, ws };
    }

    it("uses a random UUID by default", async () => {
      const { client, received } = await serverCalls({});

      await client.call("Reset", { type: "Soft" });

      expect(String(received[0]?.[1])).toMatch(UUID_V4);
    });

    it("uses idGenerator when set", async () => {
      let n = 0;
      const { client, received } = await serverCalls({
        idGenerator: () => `csms-${++n}`,
      });

      await client.call("Reset", { type: "Soft" });
      await client.call("Reset", { type: "Hard" });

      expect(received.map((f) => f[1])).toEqual(["csms-1", "csms-2"]);
    });

    it("prefers a per-call idempotencyKey over idGenerator", async () => {
      const { client, received } = await serverCalls({
        idGenerator: () => "generated",
      });

      await client.call("Reset", { type: "Soft" }, { idempotencyKey: "key-1" });

      expect(received[0]?.[1]).toBe("key-1");
    });

    it("rejects a call whose generated ID is already pending", async () => {
      const { client, received, ws } = await serverCalls({
        idGenerator: () => "same",
        callConcurrency: 2,
      });
      ws.removeAllListeners("message");
      ws.on("message", (d) => received.push(JSON.parse(d.toString())));

      const first = client.call("Reset", { type: "Soft" }, { timeoutMs: 500 });
      const second = client.call("Reset", { type: "Hard" });

      await expect(second).rejects.toThrow(/already in use/);
      await settle(50);
      ws.send(JSON.stringify([3, "same", { status: "Accepted" }]));
      await expect(first).resolves.toEqual({ status: "Accepted" });
      expect(received.filter((f) => f[0] === 2)).toHaveLength(1);
    });

    it("rejects a call when idGenerator returns an empty ID", async () => {
      const { client, received } = await serverCalls({ idGenerator: () => "" });

      await expect(client.call("Reset", { type: "Soft" })).rejects.toThrow(
        /idGenerator/,
      );
      expect(received).toEqual([]);
    });
  });

  describe("Node client", () => {
    it("uses idGenerator for call() and send()", async () => {
      const { port, heartbeats, sends } = await startServer("ocpp2.1");
      const client = new OCPPClient({
        identity: "CP-NODE",
        endpoint: `ws://localhost:${port}`,
        protocols: ["ocpp2.1"],
        reconnect: false,
        logging: false,
        idGenerator: () => "cp-fixed",
      });
      closers.push(async () => {
        await client.close({ force: true });
      });
      await client.connect();

      await client.call("Heartbeat", {});
      await client.send("NotifyPeriodicEventStream", {
        id: 1,
        pending: 0,
        basetime: "2026-01-01T00:00:00Z",
        data: [],
      });
      await settle();

      expect(heartbeats).toEqual(["cp-fixed"]);
      expect(sends).toEqual(["cp-fixed"]);
    });
  });

  describe("browser client", () => {
    async function browserClient(
      protocol: Protocol,
      options: {
        idGenerator?: MessageIdGenerator;
        idValidator?: MessageIdValidator;
      },
    ) {
      const started = await startServer(protocol);
      const client = new BrowserOCPPClient({
        identity: "CP-BROWSER",
        endpoint: `ws://localhost:${started.port}`,
        protocols: [protocol],
        reconnect: false,
        ...options,
      });
      closers.push(async () => {
        await client.close({ force: true });
      });
      const handled: string[] = [];
      client.handle("Reset", ({ messageId }) => {
        handled.push(messageId);
        return { status: "Accepted" };
      });
      const sentErrors: OCPPCallError[] = [];
      client.on("callError", (frame: OCPPCallError) => sentErrors.push(frame));
      await client.connect();
      await settle(50);
      const serverClient = started.getClient();
      if (!serverClient) throw new Error("no server client");
      return { client, started, serverClient, handled, sentErrors };
    }

    it("uses idGenerator, and a per-call idempotencyKey first", async () => {
      const { client, started } = await browserClient("ocpp1.6", {
        idGenerator: () => "browser-gen",
      });

      await client.call("Heartbeat", {});
      await client.call("Heartbeat", {}, { idempotencyKey: "browser-key" });

      expect(started.heartbeats).toEqual(["browser-gen", "browser-key"]);
    });

    it("checks incoming IDs with idValidator", async () => {
      const { serverClient, handled, sentErrors } = await browserClient(
        "ocpp1.6",
        { idValidator: (id) => id.length <= 10 },
      );

      void serverClient
        .call(
          "Reset",
          { type: "Soft" },
          { idempotencyKey: ID_60, timeoutMs: 300 },
        )
        .catch(() => {});
      await settle();

      expect(handled).toEqual([]);
      expect(sentErrors.map((f) => f.slice(0, 3))).toEqual([
        [4, "-1", "GenericError"],
      ]);
    });

    it("has no built-in length check", async () => {
      const { serverClient, handled } = await browserClient("ocpp1.6", {});

      await serverClient.call(
        "Reset",
        { type: "Soft" },
        { idempotencyKey: ID_60 },
      );

      expect(handled).toEqual([ID_60]);
    });
  });
});
