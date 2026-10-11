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

  /**
   * The simulator connected and booted, the connector-1 statuses it reports,
   * and, with `strict`, every message of its the server's validation failed.
   */
  const start = async (protocol: Protocol, { strict = false } = {}) => {
    server = new OCPPServer({
      protocols: [protocol],
      strictMode: strict,
      logging: false,
    });
    const statuses: string[] = [];
    const failures: string[] = [];
    const now = () => new Date().toISOString();
    // A valid answer to each action the simulator sends, in either version.
    const answers: Record<string, () => object> = {
      BootNotification: () => ({
        status: "Accepted",
        currentTime: now(),
        interval: 300,
      }),
      Heartbeat: () => ({ currentTime: now() }),
      Authorize: () =>
        protocol === "ocpp1.6"
          ? { idTagInfo: { status: "Accepted" } }
          : { idTokenInfo: { status: "Accepted" } },
      StartTransaction: () => ({
        transactionId: 42,
        idTagInfo: { status: "Accepted" },
      }),
      DataTransfer: () => ({ status: "Accepted" }),
      NotifyEVChargingNeeds: () => ({ status: "Accepted" }),
    };
    const connected = new Promise<OCPPServerClient<Protocol>>((resolve) =>
      server?.on("client", (client) => {
        client.on("strictValidationFailure", ({ error }) =>
          failures.push(error.message),
        );
        client.handle((ctx) => {
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
          return answers[ctx.method]?.() ?? {};
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
    // The boot sequence ends by reporting connector 1 Available, unless the
    // server refused part of it.
    await vi.waitFor(() =>
      expect(statuses.includes("Available") || failures.length > 0).toBe(true),
    );
    return { client, statuses, failures };
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

  // Both versions have a Reserved status for a reserved connector.
  it.each([
    "ocpp1.6",
    "ocpp2.0.1",
  ] as const)("%s: a reserved connector is reported Reserved", async (protocol) => {
    const { client, statuses } = await start(protocol);
    const expiry = new Date(Date.now() + 60_000).toISOString();
    const reserve =
      protocol === "ocpp1.6"
        ? { connectorId: 1, expiryDate: expiry, idTag: "TAG1", reservationId: 8 }
        : {
            id: 8,
            expiryDateTime: expiry,
            idToken: { idToken: "TAG1", type: "ISO14443" },
          };
    await client.call(unchecked("ReserveNow"), reserve);
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("Reserved"));
  });

  // Every message the simulator sends, in the version it speaks, as a server
  // validating against that version's schemas sees it.
  it.each([
    "ocpp1.6",
    "ocpp2.0.1",
  ] as const)("%s: a strict server accepts what the simulator sends", async (protocol) => {
    const { failures } = await start(protocol, { strict: true });
    const sim = engine as SimulatorEngine;
    await sim.sendHeartbeat();
    await sim.sendBootNotification();
    await sim.sendDataTransfer("ocpp-ws-io", "Ping", "hello");
    // Every status the menu offers.
    for (const status of [
      "Downloaded",
      "DownloadFailed",
      "Downloading",
      "Idle",
      "InstallationFailed",
      "Installing",
      "Installed",
    ] as const) {
      await sim.sendFirmwareStatusNotification(status);
    }
    for (const status of [
      "Idle",
      "Uploaded",
      "UploadFailed",
      "Uploading",
    ] as const) {
      await sim.sendDiagnosticsStatusNotification(status);
    }
    await sim.authorize("TAG1");
    await sim.startTransaction();
    await sim.triggerMeterValues();
    await sim.stopTransaction();
    for (const status of [
      "Preparing",
      "Charging",
      "SuspendedEV",
      "Finishing",
      "Unavailable",
      "Faulted",
      "Available",
    ] as const) {
      await sim.updateConnectorState(status);
    }
    if (protocol !== "ocpp1.6") {
      await sim.sendNotifyEvent();
      await sim.sendNotifyReport();
      await sim.sendNotifyDisplayMessages();
      await sim.sendNotifyEVChargingNeeds();
    }
    expect(failures).toEqual([]);
  }, 30_000);
});
