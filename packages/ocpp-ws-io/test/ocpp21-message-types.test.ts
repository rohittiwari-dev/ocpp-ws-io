import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";
import type { OCPPServerClient } from "../src/server-client.js";
import { NOREPLY } from "../src/types.js";
import { unchecked } from "../src/unchecked.js";
import { createValidator } from "../src/validator.js";

// "vendor-proto": a custom protocol, which may use SEND like OCPP 2.1 (B17).
type Protocol = "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1" | "vendor-proto";

const stream = {
  id: 1,
  pending: 0,
  basetime: "2026-01-01T00:00:00Z",
  data: [{ t: 0, v: "230.4" }],
};

/**
 * Message types beyond CALL/CALLRESULT/CALLERROR.
 *
 * OCPP 2.1 adds CALLRESULTERROR (5) and SEND (6). SEND is never answered
 * (Part 4 §4.2.4, Part 2 FR.07 / N15.FR.02); an invalid CALLRESULT is answered
 * with a CALLRESULTERROR (Part 2 FR.06). Any other number is ignored
 * (Part 4 §4.1.3 / §4.4), and a CALLERROR only ever answers a CALL (§4.2.3).
 */
describe("OCPP message types", () => {
  const servers: OCPPServer[] = [];
  const sockets: WebSocket[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const c of clients.splice(0)) {
      await c.close({ force: true }).catch(() => {});
    }
    for (const s of servers.splice(0)) {
      await s.close({ force: true }).catch(() => {});
    }
  });

  const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

  async function startServer(protocol: Protocol, strictMode = false) {
    const server = new OCPPServer({
      logging: false,
      protocols: [protocol],
      maxBadMessages: 2,
      ...(strictMode ? { strictMode: true } : {}),
    } as never);
    servers.push(server);
    let serverClient: OCPPServerClient | undefined;
    const ready = new Promise<OCPPServerClient>((resolve) =>
      server.on("client", (c) => {
        serverClient = c;
        resolve(c);
      }),
    );
    const { port } = (await server.listen(0)).address() as AddressInfo;
    return { server, port, ready, current: () => serverClient };
  }

  async function rawCharger(protocol: Protocol, strictMode = false) {
    const srv = await startServer(protocol, strictMode);
    const ws = new WebSocket(`ws://localhost:${srv.port}/CP-TYPES`, [protocol]);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const client = await srv.ready;
    const replies: unknown[][] = [];
    ws.on("message", (d) => replies.push(JSON.parse(d.toString())));
    let closeCode: number | undefined;
    ws.once("close", (code) => {
      closeCode = code;
    });
    return { ...srv, ws, client, replies, closeCode: () => closeCode };
  }

  const sendFrame = (id: string) =>
    JSON.stringify([6, id, "NotifyPeriodicEventStream", stream]);

  describe("SEND (6) on OCPP 2.1", () => {
    it("reaches the handler as an unconfirmed message and is never answered", async () => {
      const { ws, client, replies } = await rawCharger("ocpp2.1");
      const seen: Array<{ unconfirmed?: boolean; params: unknown }> = [];
      client.handle("NotifyPeriodicEventStream", (ctx) => {
        seen.push({ unconfirmed: ctx.unconfirmed, params: ctx.params });
      });

      ws.send(sendFrame("s1"));
      await settle();

      expect(seen).toEqual([{ unconfirmed: true, params: stream }]);
      expect(replies).toEqual([]);
    });

    it("is not answered or counted when there is no handler", async () => {
      const { ws, replies, closeCode } = await rawCharger("ocpp2.1");

      for (let i = 0; i < 5; i++) ws.send(sendFrame(`s${i}`));
      await settle();

      expect(replies).toEqual([]);
      expect(closeCode()).toBeUndefined();
    });

    it("is not answered when the handler throws", async () => {
      const { ws, client, replies } = await rawCharger("ocpp2.1");
      const errors: string[] = [];
      client.on("handlerError", ({ error }) => errors.push(error.message));
      client.handle("NotifyPeriodicEventStream", () => {
        throw new Error("storage down");
      });

      ws.send(sendFrame("s1"));
      await settle();

      expect(replies).toEqual([]);
      expect(errors).toEqual(["storage down"]);
    });

    it("is not answered when strict validation fails", async () => {
      const { ws, client, replies } = await rawCharger("ocpp2.1", true);
      const failures: unknown[] = [];
      let called = false;
      client.on("strictValidationFailure", (f) => failures.push(f));
      client.handle("NotifyPeriodicEventStream", () => {
        called = true;
      });

      ws.send(
        JSON.stringify([6, "s1", "NotifyPeriodicEventStream", { id: "x" }]),
      );
      await settle();

      expect(replies).toEqual([]);
      expect(failures).toHaveLength(1);
      expect(called).toBe(false);
    });
  });

  describe("SEND (6) on a custom protocol", () => {
    it("reaches the handler, is never answered and is not a bad message", async () => {
      const { ws, client, replies } = await rawCharger("vendor-proto");
      const bad: string[] = [];
      client.on("badMessage", ({ error }) => bad.push(error.message));
      const seen: Array<{ unconfirmed?: boolean; params: unknown }> = [];
      client.handle(unchecked("VendorNotify"), (ctx) => {
        seen.push({ unconfirmed: ctx.unconfirmed, params: ctx.params });
        return NOREPLY;
      });

      ws.send(JSON.stringify([6, "s1", "VendorNotify", { at: "now" }]));
      await settle();

      expect(seen).toEqual([{ unconfirmed: true, params: { at: "now" } }]);
      expect(replies).toEqual([]);
      expect(bad).toEqual([]);
    });
  });

  it("surfaces a CALLRESULTERROR on 2.1 as an event without answering", async () => {
    const { ws, client, replies } = await rawCharger("ocpp2.1");
    const events: unknown[] = [];
    client.on("callResultError", (frame) => events.push(frame));

    const frame = [5, "r1", "FormatViolation", "bad result", {}];
    ws.send(JSON.stringify(frame));
    await settle();

    expect(events).toEqual([frame]);
    expect(replies).toEqual([]);
  });

  // A CALLERROR MessageTypeNotSupported under message ID "-1", counted as a
  // bad message.
  describe("unknown message types", () => {
    const cases: Array<[Protocol, number]> = [
      ["ocpp1.6", 9],
      ["ocpp2.0.1", 9],
      ["ocpp2.1", 9],
      ["ocpp1.6", 6],
      ["ocpp2.0.1", 5],
      // SEND came with OCPP 2.1: before it, the RPC framework has 2 to 4 only.
      ["ocpp2.0.1", 6],
      // A custom protocol may use SEND, not CALLRESULTERROR.
      ["vendor-proto", 5],
    ];
    for (const [protocol, type] of cases) {
      it(`answers type ${type} on ${protocol} with MessageTypeNotSupported under ID "-1"`, async () => {
        const { ws, client, replies } = await rawCharger(protocol);
        const bad: string[] = [];
        client.on("badMessage", ({ error }) => bad.push(error.message));

        ws.send(JSON.stringify([type, "u1", "Anything", {}]));
        await settle();

        expect(replies.map((m) => m.slice(0, 3))).toEqual([
          [4, "-1", "MessageTypeNotSupported"],
        ]);
        expect(bad).toHaveLength(1);
      });
    }

    it("counts unknown types toward maxBadMessages", async () => {
      const { ws, closeCode } = await rawCharger("ocpp1.6");

      ws.send(JSON.stringify([9, "u1", "Anything", {}]));
      ws.send(JSON.stringify([9, "u2", "Anything", {}]));
      await settle();

      expect(closeCode()).toBe(1002);
    });
  });

  describe("replies to malformed frames (CALLERROR only answers a CALL)", () => {
    for (const protocol of ["ocpp1.6", "ocpp2.0.1"] as const) {
      it(`does not answer a malformed CALLRESULT on ${protocol}`, async () => {
        const { ws, replies } = await rawCharger(protocol);
        ws.send(JSON.stringify([3, "r1", "not-an-object"]));
        await settle();
        expect(replies).toEqual([]);
      });
    }

    it("answers a malformed CALLRESULT with CALLRESULTERROR on 2.1", async () => {
      const { ws, replies } = await rawCharger("ocpp2.1");
      ws.send(JSON.stringify([3, "r1", "not-an-object"]));
      await settle();
      expect(replies).toHaveLength(1);
      expect(replies[0][0]).toBe(5);
      expect(replies[0][1]).toBe("r1");
      expect(replies[0][2]).toBe("FormatViolation");
    });

    for (const protocol of ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"] as const) {
      it(`does not answer a malformed CALLERROR on ${protocol}`, async () => {
        const { ws, replies } = await rawCharger(protocol);
        ws.send(JSON.stringify([4, "e1"]));
        await settle();
        expect(replies).toEqual([]);
      });
    }

    it("still answers a malformed CALL with CALLERROR", async () => {
      const { ws, replies } = await rawCharger("ocpp1.6");
      ws.send(JSON.stringify([2, "c1", "Heartbeat", "not-an-object"]));
      await settle();
      expect(replies.map((m) => m.slice(0, 3))).toEqual([
        [4, "c1", "FormationViolation"],
      ]);
    });

    it("answers a schema-invalid CALLRESULT with CALLRESULTERROR on 2.1 in strict mode", async () => {
      const { ws, client, replies } = await rawCharger("ocpp2.1", true);
      ws.on("message", (d) => {
        const msg = JSON.parse(d.toString());
        if (msg[0] === 2) ws.send(JSON.stringify([3, msg[1], { status: 42 }]));
      });

      const outcome = await client.call("ClearCache", {}).then(
        () => "resolved",
        () => "rejected",
      );
      await settle();

      expect(outcome).toBe("rejected");
      const resultErrors = replies.filter((m) => m[0] === 5);
      expect(resultErrors).toHaveLength(1);
      expect(resultErrors[0][1]).toBe(replies[0][1]);
    });
  });

  describe("send()", () => {
    async function connectClient(protocol: Protocol) {
      const srv = await startServer(protocol);
      const client = new OCPPClient({
        identity: "CP-SEND",
        endpoint: `ws://localhost:${srv.port}`,
        protocols: [protocol],
        reconnect: false,
        logging: false,
      });
      clients.push(client);
      await client.connect();
      return { ...srv, client, serverClient: await srv.ready };
    }

    it("sends an unconfirmed message on 2.1", async () => {
      const { client, serverClient } = await connectClient("ocpp2.1");
      const seen: unknown[] = [];
      serverClient.handle("NotifyPeriodicEventStream", (ctx) => {
        seen.push(ctx.params);
      });

      await client.send("NotifyPeriodicEventStream", stream);
      await settle();

      expect(seen).toEqual([stream]);
    });

    it("refuses to send on a protocol without SEND", async () => {
      const { client } = await connectClient("ocpp1.6");
      await expect(
        client.send("NotifyPeriodicEventStream", stream),
      ).rejects.toThrow(/OCPP 2\.1/);
    });

    it("sends an unconfirmed message on a custom protocol", async () => {
      const { client, serverClient } = await connectClient("vendor-proto");
      const seen: unknown[] = [];
      serverClient.handle(unchecked("VendorNotify"), (ctx) => {
        seen.push(ctx.params);
        return NOREPLY;
      });

      await client.send(unchecked("VendorNotify"), { at: "now" });
      await settle();

      expect(seen).toEqual([{ at: "now" }]);
    });

    it("validates a custom protocol's SEND in strict mode", async () => {
      const srv = await startServer("vendor-proto");
      const client = new OCPPClient({
        identity: "CP-SEND-STRICT",
        endpoint: `ws://localhost:${srv.port}`,
        protocols: ["vendor-proto"],
        strictMode: true,
        strictModeValidators: [
          createValidator("vendor-proto", [
            {
              $id: "urn:VendorNotify",
              type: "object",
              properties: { at: { type: "string" } },
              required: ["at"],
              additionalProperties: false,
            },
          ]),
        ],
        reconnect: false,
        logging: false,
      });
      clients.push(client);
      await client.connect();

      await expect(
        client.send(unchecked("VendorNotify"), { at: 1 }),
      ).rejects.toThrow(/at/);
      await client.send(unchecked("VendorNotify"), { at: "now" });
    });

    it("does not wait behind an outstanding CALL", async () => {
      const { client, serverClient } = await connectClient("ocpp2.1");
      const order: string[] = [];
      serverClient.handle("Heartbeat", async () => {
        await settle(300);
        return { currentTime: "2026-01-01T00:00:00Z" };
      });
      serverClient.handle("NotifyPeriodicEventStream", () => {
        order.push("send");
      });

      const call = client.call("Heartbeat", {}).then(() => order.push("call"));
      await client.send("NotifyPeriodicEventStream", stream);
      await call;

      expect(order).toEqual(["send", "call"]);
    });
  });
});
