import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulatorEngine } from "../../src/cli/simulator/Engine.js";
import { unchecked } from "../../src/core/unchecked.js";
import { OCPPServer } from "../../src/server/server.js";
import type { OCPPServerClient } from "../../src/server/server-client.js";

type Protocol = "ocpp1.6" | "ocpp2.0.1";

/**
 * `ocpp simulate`'s engine against this library's server, on 1.6 and 2.0.1:
 * CSMS requests read in each version's shape, and statuses reported in the
 * version's own list.
 */
describe("ocpp simulate: the simulator on 1.6 and 2.0.1", () => {
  let server: OCPPServer<Protocol> | undefined;
  let engine: SimulatorEngine | undefined;

  afterEach(async () => {
    // The engine first: a server closing under it would start a reconnect.
    engine?.stop();
    await server?.close({ force: true });
    engine = undefined;
    server = undefined;
  });

  /** The simulator connected and booted, and the connector-1 statuses it reports. */
  const start = async (protocol: Protocol) => {
    server = new OCPPServer({ protocols: [protocol], logging: false });
    const statuses: string[] = [];
    const connected = new Promise<OCPPServerClient<Protocol>>((resolve) =>
      server?.on("client", (client) => {
        client.handle((ctx) => {
          if (ctx.method === "BootNotification") {
            return {
              status: "Accepted",
              currentTime: new Date().toISOString(),
              interval: 300,
            };
          }
          if (ctx.method === "StatusNotification") {
            const report = ctx.params as {
              connectorId?: number;
              status?: string;
              connectorStatus?: string;
            };
            if (report.connectorId === 1) {
              statuses.push(String(report.status ?? report.connectorStatus));
            }
          }
          return {};
        });
        resolve(client);
      }),
    );
    const port = ((await server.listen(0)).address() as AddressInfo).port;
    engine = new SimulatorEngine({
      endpoint: `ws://localhost:${port}`,
      identity: "SIM1",
      protocol,
    });
    await engine.start();
    const client = await connected;
    // The boot sequence ends by reporting connector 1 Available.
    await vi.waitFor(() => expect(statuses).toContain("Available"));
    return { client, statuses };
  };

  it.each([
    ["ocpp1.6", { connectorId: 1, type: "Inoperative" }],
    ["ocpp2.0.1", { operationalStatus: "Inoperative" }],
  ] as const)("%s: ChangeAvailability Inoperative makes the connector Unavailable", async (protocol, request) => {
    const { client, statuses } = await start(protocol);
    await expect(
      client.call(unchecked("ChangeAvailability"), request),
    ).resolves.toEqual({ status: "Accepted" });
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("Unavailable"));
  });

  it.each([
    ["ocpp1.6", "SuspendedEV"],
    ["ocpp2.0.1", "Occupied"],
  ] as const)("%s: SuspendedEV is reported as %s", async (protocol, reported) => {
    const { statuses } = await start(protocol);
    await engine?.updateConnectorState("SuspendedEV");
    expect(statuses.at(-1)).toBe(reported);
  });

  it.each([
    "ocpp1.6",
    "ocpp2.0.1",
  ] as const)("%s: a reservation is cancelled by its id", async (protocol) => {
    const { client } = await start(protocol);
    const expiry = new Date(Date.now() + 60_000).toISOString();
    const reserve =
      protocol === "ocpp1.6"
        ? { connectorId: 1, expiryDate: expiry, idTag: "TAG1", reservationId: 7 }
        : {
            id: 7,
            expiryDateTime: expiry,
            idToken: { idToken: "TAG1", type: "ISO14443" },
          };
    await expect(
      client.call(unchecked("ReserveNow"), reserve),
    ).resolves.toEqual({ status: "Accepted" });
    await expect(
      client.call(unchecked("CancelReservation"), { reservationId: 7 }),
    ).resolves.toEqual({ status: "Accepted" });
  });
});
