import type { Server } from "node:http";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { OCPPServer } from "../src/server.js";
import { unchecked } from "../src/unchecked.js";

/**
 * What a peer actually receives on the wire when a message is rejected.
 *
 * Two defects lived here. OCPP 1.6 and 2.0.1 spell two error codes
 * differently, and only one of the two renames was applied — so every 1.6
 * charge point sending a payload with a missing required field, the commonest
 * validation failure there is, got a code its enum does not contain. And a
 * malformed CALL whose UniqueId is readable must be answered, or the sender
 * waits out its full timeout. A MessageTypeId the protocol does not define is
 * answered with MessageTypeNotSupported.
 */

const portOf = (s: Server) => {
  const a = s.address();
  return a && typeof a !== "string" ? a.port : 0;
};

describe("OCPP-J error codes on the wire", () => {
  let server: OCPPServer | undefined;
  let ws: WebSocket | undefined;

  afterEach(async () => {
    ws?.close();
    await server?.close({ force: true }).catch(() => {});
    server = undefined;
    ws = undefined;
  });

  /** Send raw frames to a strict server, collect the raw replies. */
  async function send(subprotocol: string, frames: unknown[]) {
    server = new OCPPServer({
      protocols: [subprotocol as never],
      strictMode: true,
      logging: false,
    } as never);
    server.auth((ctx) => ctx.accept({ protocol: subprotocol as never }));
    server.on("client", (c) => {
      c.handle(subprotocol, unchecked("Heartbeat"), () => ({
        currentTime: "2026-01-01T00:00:00Z",
      }));
      // Registered so a bad payload reaches validation; without a handler the
      // unknown-action path answers NotImplemented first.
      c.handle(subprotocol, unchecked("BootNotification"), () => ({
        currentTime: "2026-01-01T00:00:00Z",
        interval: 300,
        status: "Accepted",
      }));
    });
    const http = await server.listen(0);

    const replies: unknown[][] = [];
    ws = new WebSocket(`ws://127.0.0.1:${portOf(http)}/CP1`, [subprotocol]);
    await new Promise((res, rej) => {
      ws?.once("open", res);
      ws?.once("error", rej);
    });
    ws.on("message", (d) => replies.push(JSON.parse(d.toString())));

    for (const f of frames) ws.send(JSON.stringify(f));
    await new Promise((r) => setTimeout(r, 500));
    return replies;
  }

  it("sends 1.6 the OccurenceConstraintViolation spelling its enum has", async () => {
    const r = await send("ocpp1.6", [
      [2, "r1", "BootNotification", { chargePointVendor: "V" }],
    ]);
    expect(r[0]?.[0]).toBe(4);
    expect(r[0]?.[2]).toBe("OccurenceConstraintViolation");
  }, 25000);

  it("keeps the corrected spelling for 2.0.1", async () => {
    const r = await send("ocpp2.0.1", [
      [2, "r2", "BootNotification", { reason: "PowerUp" }],
    ]);
    expect(r[0]?.[0]).toBe(4);
    expect(r[0]?.[2]).toBe("OccurrenceConstraintViolation");
  }, 25000);

  // Answered with MessageTypeNotSupported under message ID "-1", since the
  // frame's own ID is not read for a type the protocol does not define. 2.1 adds types 5 and 6, so a newer charger talking to a 1.6
  // server lands here.
  it("answers an unknown MessageTypeId instead of dropping it", async () => {
    const r = await send("ocpp1.6", [
      [99, "t99", "Heartbeat", {}],
      [5, "t5", "Heartbeat", {}],
    ]);

    expect(r.map((m) => m.slice(0, 3))).toEqual([
      [4, "-1", "MessageTypeNotSupported"],
      [4, "-1", "MessageTypeNotSupported"],
    ]);
  }, 25000);

  it("still reports a malformed frame as a format violation, per version", async () => {
    const a = await send("ocpp1.6", [[2, "m1", "Heartbeat", "not-an-object"]]);
    expect(a[0]?.[2]).toBe("FormationViolation");
    await server?.close({ force: true });

    const b = await send("ocpp2.0.1", [[2, "m2", "Heartbeat", "not-an-object"]]);
    // A structural problem is a format violation, not an unsupported message
    // type — these three sites used to raise the latter.
    expect(b[0]?.[2]).toBe("FormatViolation");
  }, 25000);

  it("still answers a well-formed call normally", async () => {
    const r = await send("ocpp1.6", [[2, "ok", "Heartbeat", {}]]);
    expect(r[0]?.[0]).toBe(3);
  }, 25000);
});
