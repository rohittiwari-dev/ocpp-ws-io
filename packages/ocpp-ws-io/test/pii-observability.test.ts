import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { OCPPClient } from "../src/client.js";
import { piiRedactorPlugin } from "../src/plugins/pii-redactor.js";
import { OCPPServer } from "../src/server.js";
import type { MessageEventPayload } from "../src/types.js";

/**
 * The redactor replaces the context payload with a redacted deep clone rather
 * than mutating in place, so anything that emitted the original array handed
 * observers the unredacted values. Broker plugins consume exactly that event
 * when configured with `includePayload`, which is how a secret reached Kafka
 * from a server that had installed the redactor.
 */

const getPort = (srv: Server): number => {
  const addr = srv.address();
  return addr && typeof addr !== "string" ? addr.port : 0;
};

const SECRET = "super-secret-token";

describe("redaction reaches the message event", () => {
  let server: OCPPServer | undefined;
  let client: OCPPClient | undefined;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close().catch(() => {});
    client = undefined;
    server = undefined;
  });

  /** Server with the redactor installed; returns the observed message events. */
  async function connect(handler: () => unknown) {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.plugin(piiRedactorPlugin({ sensitiveKeys: ["authorizationKey"] }));
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));

    const observed: MessageEventPayload[] = [];
    server.on("client", (conn) => {
      conn.on("message", (p) => observed.push(p as MessageEventPayload));
    });

    const httpServer = await server.listen(0);
    client = new OCPPClient({
      identity: "CP-PII",
      endpoint: `ws://127.0.0.1:${getPort(httpServer)}`,
      protocols: ["ocpp1.6"],
    });
    client.handle("ocpp1.6", "DataTransfer", handler as never);
    await client.connect();
    return observed;
  }

  it("does not leak a redacted key through an inbound CALLRESULT", async () => {
    const observed = await connect(() => ({
      status: "Accepted",
      data: { authorizationKey: SECRET },
    }));

    await server!.sendToClient("CP-PII", "ocpp1.6", "DataTransfer", {
      vendorId: "acme",
    });

    const results = observed.filter(
      (p) =>
        p.direction === "IN" && Array.isArray(p.message) && p.message[0] === 3,
    );
    expect(results.length).toBeGreaterThan(0);

    const seen = JSON.stringify(results.map((p) => p.message));
    expect(seen).not.toContain(SECRET);
    expect(seen).toContain("***REDACTED***");
  }, 20000);

  it("redacts the detail object of an inbound CALLERROR", async () => {
    const observed = await connect(() => {
      const err = new Error("nope") as Error & {
        rpcErrorCode: string;
        details: Record<string, unknown>;
      };
      err.rpcErrorCode = "GenericError";
      err.details = { authorizationKey: SECRET };
      throw err;
    });

    await server!
      .sendToClient("CP-PII", "ocpp1.6", "DataTransfer", { vendorId: "acme" })
      .catch(() => {});

    const errors = observed.filter(
      (p) =>
        p.direction === "IN" && Array.isArray(p.message) && p.message[0] === 4,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors.map((p) => p.message))).not.toContain(SECRET);
  }, 20000);
});
