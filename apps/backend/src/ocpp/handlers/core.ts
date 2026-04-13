import type { OCPPServer } from "ocpp-ws-io";

/**
 * Attaches the core CPMS capability handlers (Boot, Heartbeat, Status).
 */
export function setupCoreHandlers(server: OCPPServer) {
  // Create a connection route for stations connecting via /ocpp/:identity
  // (In OCPP 1.6 J JSON usually charge points connect to /endpoint/ChargePointID)
  const stationRoute = server.route("/ocpp/:identity");

  // Directly handle BootNotification for ANY station connecting to this route
  stationRoute.handle("ocpp1.6", "BootNotification", async (ctx) => {
    const { chargePointVendor, chargePointModel } = ctx.params;
    console.log(
      `[${ctx.client.identity}] Booting up: ${chargePointVendor} ${chargePointModel}`,
    );

    return {
      currentTime: new Date().toISOString(),
      interval: 300,
      status: "Accepted",
    };
  });

  // Directly handle incoming Heartbeats
  stationRoute.handle("ocpp1.6", "Heartbeat", async () => {
    return { currentTime: new Date().toISOString() };
  });

  // Directly handle StatusNotification
  stationRoute.handle("ocpp1.6", "StatusNotification", async (ctx) => {
    console.log(
      `[${ctx.client.identity}] Connector ${ctx.params.connectorId} is now ${ctx.params.status}`,
    );
    return {};
  });

  // Directly handle MeterValues
  stationRoute.handle("ocpp1.6", "MeterValues", async (ctx) => {
    console.log(
      `[${ctx.client.identity}] Meter reading from connector ${ctx.params.connectorId}`,
    );
    return {};
  });
}
