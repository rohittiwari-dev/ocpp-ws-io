import type { BoardStorageAdapter } from "../types.js";

/**
 * Passively connect an `ocpp-smart-charge-engine` instance to the board.
 * Hooks into engine events without affecting engine behavior.
 */
export function connectSmartChargeEngine(
  engine: any,
  store: BoardStorageAdapter,
): void {
  store.smartChargeConnected = true;

  if (engine.config) {
    store.smartChargeConfig = { ...engine.config };
  }

  engine.on?.("sessionAdded", (session: any) => {
    store.smartChargeSessions?.set(session.clientId ?? session.id, {
      clientId: session.clientId ?? session.id,
      connectorId: session.connectorId ?? 0,
      priority: session.priority ?? 0,
      phases: session.phases,
      maxHardwarePowerKw: session.maxHardwarePowerKw,
    });
    store.addSmartChargeEvent({
      type: "sessionAdded",
      session,
      timestamp: new Date().toISOString(),
    });
  });

  engine.on?.("sessionRemoved", (session: any) => {
    store.smartChargeSessions?.delete(session.clientId ?? session.id);
    store.addSmartChargeEvent?.({
      type: "sessionRemoved",
      session,
      timestamp: new Date().toISOString(),
    });
  });

  engine.on?.("optimized", (profiles: any[]) => {
    for (const p of profiles) {
      const existing = store.smartChargeSessions?.get(
        p.clientId ?? p.sessionId,
      );
      if (existing) {
        existing.allocatedKw =
          (p.allocatedKw ?? p.allocatedW) ? p.allocatedW / 1000 : undefined;
      }
    }
    store.addSmartChargeEvent?.({
      type: "optimized",
      profiles,
      timestamp: new Date().toISOString(),
    });
  });

  engine.on?.("dispatched", (profiles: any[]) => {
    store.addSmartChargeEvent?.({
      type: "dispatched",
      profiles,
      timestamp: new Date().toISOString(),
    });
  });

  engine.on?.("dispatchError", (err: any) => {
    store.dispatchErrors?.push({
      error: err,
      timestamp: new Date().toISOString(),
    });
    store.addSmartChargeEvent({
      type: "dispatchError",
      error: err,
      timestamp: new Date().toISOString(),
    });
  });
}
