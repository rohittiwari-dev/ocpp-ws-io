import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { OCPPClient } from "../src/client.js";
import { piiRedactorPlugin } from "../src/plugins/pii-redactor.js";
import { OCPPServer } from "../src/server.js";

/**
 * The redactor replaces the payload rather than a copy taken for logging, and
 * an outbound message is built from the payload *after* middleware runs — which
 * is deliberate, since transforming outbound calls is a supported feature.
 *
 * So redacting outbound changed what reached the charge point, not what was
 * logged. With `idTag` in `sensitiveKeys` — the key the plugin's own example
 * used — a RemoteStartTransaction arrived carrying "***REDACTED***" as the tag
 * and the charger tried to authorize that. Remote start was broken for anyone
 * who followed the documentation.
 */

const getPort = (s: Server) => {
  const a = s.address();
  return a && typeof a !== "string" ? a.port : 0;
};

const TAG = "REAL-TAG-12345";

describe("what the charge point receives", () => {
  let server: OCPPServer | undefined;
  let client: OCPPClient | undefined;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close().catch(() => {});
    server = undefined;
    client = undefined;
  });

  async function sendRemoteStart(redactorOptions: Record<string, unknown>) {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.plugin(piiRedactorPlugin(redactorOptions as never));
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const http = await server.listen(0);

    let received: Record<string, unknown> | undefined;
    client = new OCPPClient({
      identity: "CP-WIRE",
      endpoint: `ws://127.0.0.1:${getPort(http)}`,
      protocols: ["ocpp1.6"],
    });
    client.handle("ocpp1.6", "RemoteStartTransaction", ({ params }) => {
      received = params as Record<string, unknown>;
      return { status: "Accepted" };
    });
    await client.connect();

    await server.sendToClient("CP-WIRE", "ocpp1.6", "RemoteStartTransaction", {
      idTag: TAG,
    } as never);

    return received;
  }

  it("gets the real idTag with the default configuration", async () => {
    const received = await sendRemoteStart({ sensitiveKeys: ["idTag"] });
    // The whole command depends on this value being the tag the driver presented.
    expect(received?.idTag).toBe(TAG);
  });

  it("gets the redacted one only when outgoing is explicitly enabled", async () => {
    const received = await sendRemoteStart({
      sensitiveKeys: ["idTag"],
      outgoing: true,
    });
    // Opting in is now a deliberate act, and documented as altering the wire.
    expect(received?.idTag).toBe("***REDACTED***");
  });

  it("still redacts inbound payloads by default", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.plugin(piiRedactorPlugin({ sensitiveKeys: ["idTag"] }));
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));

    let seenByHandler: Record<string, unknown> | undefined;
    server.on("client", (c) =>
      c.handle("ocpp1.6", "Authorize", ({ params }) => {
        seenByHandler = params as Record<string, unknown>;
        return { idTagInfo: { status: "Accepted" } };
      }),
    );
    const http = await server.listen(0);

    client = new OCPPClient({
      identity: "CP-IN",
      endpoint: `ws://127.0.0.1:${getPort(http)}`,
      protocols: ["ocpp1.6"],
    });
    await client.connect();
    await client.call("ocpp1.6", "Authorize", { idTag: TAG });

    // Inbound redaction is unchanged, including that handlers see the mask.
    expect(seenByHandler?.idTag).toBe("***REDACTED***");
  });
});
