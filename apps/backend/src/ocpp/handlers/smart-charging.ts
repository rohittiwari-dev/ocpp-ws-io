import { SmartChargingEngine, Strategies } from "ocpp-smart-charge-engine";
import { buildOcpp16Profile } from "ocpp-smart-charge-engine/builders";
import type { OCPPServer } from "ocpp-ws-io";

const clients = new Map();

/**
 * Attaches advanced Smart Charging capabilities to the OCPP server.
 * This integrates load balancing and dynamic charging profiles natively.
 */
export function setupSmartCharging(server: OCPPServer) {
  const engine = new SmartChargingEngine({
    siteId: "MY-SITE",
    maxGridPowerKw: 100,
    safetyMarginPct: 5,
    algorithm: Strategies.EQUAL_SHARE,
    autoClearOnRemove: true,

    dispatcher: async ({ clientId, connectorId, sessionProfile }) => {
      const client = clients.get(clientId);
      if (!client) return;
      await client.call("SetChargingProfile", {
        connectorId,
        csChargingProfiles: buildOcpp16Profile(sessionProfile),
      });
    },

    clearDispatcher: async ({ clientId, connectorId }) => {
      const client = clients.get(clientId);
      if (!client) return;
      await client.call("ClearChargingProfile", {
        connectorId,
        chargingProfilePurpose: "TxProfile",
        stackLevel: 0,
      });
    },
  });

  server.on("client", (client) => {
    clients.set(client.identity, client);
    client.once("close", () => clients.delete(client.identity));

    client.handle("ocpp1.6", "BootNotification", () => ({
      currentTime: new Date().toISOString(),
      interval: 30,
      status: "Accepted",
    }));

    client.handle("ocpp1.6", "StartTransaction", async (ctx) => {
      engine.addSession({
        transactionId: 8678686868,
        clientId: client.identity,
        connectorId: ctx.params.connectorId,
        maxHardwarePowerKw: 22,
        minChargeRateKw: 1.4,
      });
      await engine.dispatch();
      return {
        idTagInfo: {
          status: "Accepted",
          parentIdTag: "asdfasdf",
          expiryDate: new Date().toISOString(),
        },
        transactionId: 8678686868,
      };
    });

    client.handle("ocpp1.6", "StopTransaction", async (ctx) => {
      engine.safeRemoveSession(ctx.params.transactionId);
      await engine.dispatch();
      return { idTagInfo: { status: "Accepted" } };
    });
  });
}
