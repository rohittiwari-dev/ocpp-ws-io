import { afterEach, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";

// The socket dispatches as soon as it opens, so a CSMS that sends Reset the
// instant a charger appears could arrive before the application registered its
// handlers. The client answered NotImplemented — telling the peer the charger
// does not support an action it does support, intermittently, which is close to
// undiagnosable in the field.

describe("startup handler grace", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  });

  /** Server fires Reset the moment a charger connects; returns its outcome. */
  async function harness(opts: {
    identity: string;
    handlerGraceMs?: number;
    registerAfterMs: number | null;
  }) {
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      callTimeoutMs: 4000,
    });
    servers.push(server);

    let outcome = "pending";
    server.on("client", (c: any) => {
      c.call("Reset", { type: "Soft" }).then(
        (r: { status: string }) => {
          outcome = `handled:${r.status}`;
        },
        (e: Error) => {
          outcome = `error:${e.message}`;
        },
      );
    });

    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity: opts.identity,
      protocols: ["ocpp1.6"],
      reconnect: false,
      ...(opts.handlerGraceMs !== undefined
        ? { handlerGraceMs: opts.handlerGraceMs }
        : {}),
    });
    client.on("error", () => {});
    clients.push(client);

    await client.connect();

    const registerAfterMs = opts.registerAfterMs;
    if (registerAfterMs !== null) {
      // Read into a const first: capturing opts in the closure loses the
      // narrowing from the null check.
      await new Promise((r) => setTimeout(r, registerAfterMs));
      client.handle("ocpp1.6", "Reset", async () => ({ status: "Accepted" }));
    }

    await new Promise((r) => setTimeout(r, 2500));
    return outcome;
  }

  test("a handler registered right after connect() still serves the call", async () => {
    const outcome = await harness({
      identity: "CP-AFTER-SYNC",
      registerAfterMs: 0,
    });
    expect(outcome).toBe("handled:Accepted");
  }, 20000);

  test("a handler registered a little later still serves the call", async () => {
    const outcome = await harness({
      identity: "CP-AFTER-DELAY",
      registerAfterMs: 200,
    });
    expect(outcome).toBe("handled:Accepted");
  }, 20000);

  test("an action that never gets a handler is still rejected", async () => {
    const outcome = await harness({
      identity: "CP-NEVER",
      handlerGraceMs: 300,
      registerAfterMs: null,
    });
    expect(outcome).toContain("error");
  }, 20000);

  test("grace can be disabled, restoring immediate rejection", async () => {
    const outcome = await harness({
      identity: "CP-NOGRACE",
      handlerGraceMs: 0,
      registerAfterMs: 0,
    });
    expect(outcome).toContain("error");
  }, 20000);

  test("registering before connect() is unaffected", async () => {
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      callTimeoutMs: 4000,
    });
    servers.push(server);

    let outcome = "pending";
    server.on("client", (c: any) => {
      c.call("Reset", { type: "Soft" }).then(
        (r: { status: string }) => {
          outcome = `handled:${r.status}`;
        },
        (e: Error) => {
          outcome = `error:${e.message}`;
        },
      );
    });

    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;
    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity: "CP-BEFORE",
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    client.on("error", () => {});
    clients.push(client);
    client.handle("ocpp1.6", "Reset", async () => ({ status: "Accepted" }));
    await client.connect();

    await new Promise((r) => setTimeout(r, 500));
    expect(outcome).toBe("handled:Accepted");
  }, 20000);
});
