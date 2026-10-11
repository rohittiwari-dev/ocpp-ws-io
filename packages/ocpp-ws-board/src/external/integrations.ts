import type {
  OCPPMessage,
  OCPPProtocolProxy,
  ProxyMiddleware,
  TranslationContext,
} from "ocpp-ws-io/proxy";
import type {
  SmartChargingEngine,
  SmartChargingEngineEvents,
} from "ocpp-ws-io/smart-charge";
import { jsonValue } from "./plugin.js";
import type { BoardStorageAdapter, SmartChargeSession } from "./types.js";

export function createIntegrations(store: BoardStorageAdapter) {
  let detachSmart = () => {};
  let detachProxy = () => {};
  let closed = false;
  const starts = new Map<string, number>();
  const proxyMiddleware: ProxyMiddleware = async (
    message,
    context,
    direction,
    phase,
  ) => {
    if (closed) return undefined;
    store.proxyConnected = true;
    const key = `${context.identity}:${direction}:${message.messageId}`;
    if (phase === "pre") {
      // Translation failures may not reach post; keep the timing map bounded.
      if (starts.size >= 2000) {
        const first = starts.keys().next().value;
        if (first) starts.delete(first);
      }
      starts.set(key, Date.now());
    } else {
      const start = starts.get(key);
      starts.delete(key);
      await store.addProxyEvent({
        identity: context.identity,
        direction:
          direction === "downstream"
            ? "OUT"
            : direction === "upstream"
              ? "IN"
              : "UNSPECIFIED",
        sourceProtocol: context.sourceProtocol,
        targetProtocol: context.targetProtocol,
        latencyMs: start === undefined ? undefined : Date.now() - start,
        timestamp: new Date().toISOString(),
      });
    }
    return undefined;
  };
  function connectSmartCharge(engine: SmartChargingEngine) {
    if (closed) throw new Error("Board integrations have been cleaned up");
    detachSmart();
    const sync = () => {
      store.smartChargeConnected = true;
      const previous = store.smartChargeSessions;
      store.smartChargeSessions = new Map<string, SmartChargeSession>(
        engine.getSessions().map((session) => [
          String(session.transactionId),
          {
            clientId: session.clientId,
            connectorId: session.connectorId,
            priority: session.priority,
            phases: session.phases,
            maxHardwarePowerKw: session.maxHardwarePowerKw,
            allocatedKw: previous?.get(String(session.transactionId))
              ?.allocatedKw,
          },
        ]),
      );
      const config = jsonValue(engine.config);
      store.smartChargeConfig =
        config && typeof config === "object" && !Array.isArray(config)
          ? config
          : {};
    };
    const optimized: SmartChargingEngineEvents["optimized"] = (profiles) => {
      sync();
      for (const profile of profiles) {
        const session = store.smartChargeSessions?.get(
          String(profile.transactionId),
        );
        if (session) session.allocatedKw = profile.allocatedKw;
      }
    };
    const dispatchError: SmartChargingEngineEvents["dispatchError"] = (
      event,
    ) => {
      store.dispatchErrors = [
        {
          clientId: event.clientId,
          transactionId: event.transactionId,
          error:
            event.error instanceof Error
              ? event.error.message
              : String(event.error),
          timestamp: new Date().toISOString(),
        },
        ...(store.dispatchErrors ?? []),
      ].slice(0, 100);
    };
    const sessionEvents = [
      "sessionAdded",
      "sessionUpdated",
      "sessionRemoved",
      "snapshotLoaded",
      "autoDispatchStarted",
      "autoDispatchStopped",
    ] as const;
    for (const event of sessionEvents) engine.on(event, sync);
    engine.on("optimized", optimized);
    engine.on("dispatchError", dispatchError);
    sync();
    // Config changes have no dedicated public event, so refresh the read-only snapshot.
    const timer = setInterval(sync, 2000);
    timer.unref?.();
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      clearInterval(timer);
      for (const event of sessionEvents) engine.off(event, sync);
      engine.off("optimized", optimized);
      engine.off("dispatchError", dispatchError);
      store.smartChargeConnected = false;
    };
    detachSmart = detach;
    return detach;
  }
  function connectProxy(proxy: OCPPProtocolProxy) {
    if (closed) throw new Error("Board integrations have been cleaned up");
    detachProxy();
    store.proxyConnected = true;
    const failure = (
      error: Error,
      _message: OCPPMessage,
      context: TranslationContext,
    ) => {
      Promise.resolve(
        store.addProxyEvent({
          identity: context.identity,
          direction: "UNSPECIFIED",
          sourceProtocol: context.sourceProtocol,
          targetProtocol: context.targetProtocol,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        }),
      ).catch(() => {});
    };
    proxy.on("translationError", failure);
    proxy.on("middlewareError", failure);
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      proxy.off("translationError", failure);
      proxy.off("middlewareError", failure);
      store.proxyConnected = false;
    };
    detachProxy = detach;
    return detach;
  }
  return {
    connectSmartCharge,
    connectProxy,
    proxyMiddleware,
    cleanup() {
      closed = true;
      detachSmart();
      detachProxy();
      starts.clear();
    },
  };
}
