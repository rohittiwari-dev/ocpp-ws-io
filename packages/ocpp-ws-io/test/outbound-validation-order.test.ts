import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";
import type { OCPPServerClient } from "../src/server-client.js";

/**
 * Strict mode checks an outgoing call as the application made it, before any
 * middleware rewrites it, and checks the reply against the application's
 * action. Outgoing results already worked this way. Before, a middleware that
 * renamed a call (as signing does: "Heartbeat" becomes "Heartbeat-Signed")
 * switched both checks off, since no schema exists for the new name.
 */
describe("strict mode and middleware that rewrites outgoing calls", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  /** A CSMS that records the actions it receives. */
  async function start(protocol: "ocpp2.0.1" | "ocpp2.1") {
    const server = new OCPPServer({ protocols: [protocol], logging: false });
    servers.push(server);
    const received: string[] = [];
    server.on("client", (c: OCPPServerClient) => {
      c.handle((method) => {
        received.push(method);
        // Not a valid HeartbeatResponse: currentTime is required.
        return {};
      });
    });
    const http = await server.listen(0);
    const { port } = http.address() as AddressInfo;
    return { port, received };
  }

  /** A strict client whose middleware renames every outgoing call. */
  async function connect(port: number, protocol: "ocpp2.0.1" | "ocpp2.1") {
    const client = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}`,
      protocols: [protocol],
      strictMode: true,
      reconnect: false,
      logging: false,
    });
    clients.push(client);
    const resultMethods: string[] = [];
    client.use(async (ctx, next) => {
      if (ctx.type === "outgoing_call") {
        ctx.method = `${ctx.method}-Signed`;
      }
      if (ctx.type === "incoming_result") resultMethods.push(ctx.method);
      return next();
    });
    const failures: string[] = [];
    client.on("strictValidationFailure", ({ error }) => {
      failures.push(error.message);
    });
    await client.connect();
    return { client, resultMethods, failures };
  }

  it("rejects an invalid call before the middleware runs, and sends nothing", async () => {
    const { port, received } = await start("ocpp2.0.1");
    const { client, failures } = await connect(port, "ocpp2.0.1");

    // BootNotification needs reason and chargingStation.
    await expect(client.call("BootNotification", {})).rejects.toThrow();

    expect(failures).toHaveLength(1);
    expect(received).toEqual([]);
  });

  it("checks the reply against the application's action", async () => {
    const { port, received } = await start("ocpp2.0.1");
    const { client, resultMethods, failures } = await connect(
      port,
      "ocpp2.0.1",
    );

    await expect(client.call("Heartbeat", {})).rejects.toThrow();

    expect(received).toEqual(["Heartbeat-Signed"]);
    expect(resultMethods).toEqual(["Heartbeat"]);
    expect(failures).toHaveLength(1);
  });

  it("rejects an invalid SEND before the middleware runs", async () => {
    const { port, received } = await start("ocpp2.1");
    const { client, failures } = await connect(port, "ocpp2.1");

    // NotifyPeriodicEventStream needs id, pending, basetime and data.
    await expect(client.send("NotifyPeriodicEventStream", {})).rejects.toThrow();

    expect(failures).toHaveLength(1);
    expect(received).toEqual([]);
  });
});
