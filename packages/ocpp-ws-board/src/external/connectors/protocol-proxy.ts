import type { BoardStorageAdapter } from "../types.js";

/**
 * Passively connect an `ocpp-protocol-proxy` instance to the board.
 * Hooks into proxy events without affecting proxy behavior.
 */
export function connectProtocolProxy(
  proxy: any,
  store: BoardStorageAdapter,
): void {
  store.proxyConnected = true;

  proxy.on?.("connection", (identity: string, sourceProtocol: string) => {
    store.addProxyEvent({
      identity,
      direction: "IN",
      sourceProtocol,
      targetProtocol: "",
      timestamp: new Date().toISOString(),
    });
  });

  proxy.on?.("disconnect", (identity: string) => {
    store.addProxyEvent({
      identity,
      direction: "OUT",
      sourceProtocol: "",
      targetProtocol: "",
      timestamp: new Date().toISOString(),
    });
  });

  proxy.on?.("translationError", (err: any, _msg: any, ctx: any) => {
    store.addProxyEvent({
      identity: ctx?.identity ?? "unknown",
      direction: "IN",
      sourceProtocol: ctx?.sourceProtocol ?? "",
      targetProtocol: ctx?.targetProtocol ?? "",
      error: err?.message ?? String(err),
      timestamp: new Date().toISOString(),
    });
  });

  proxy.on?.("middlewareError", (err: any, _msg: any, ctx: any) => {
    store.addProxyEvent({
      identity: ctx?.identity ?? "unknown",
      direction: "IN",
      sourceProtocol: ctx?.sourceProtocol ?? "",
      targetProtocol: ctx?.targetProtocol ?? "",
      error: err?.message ?? String(err),
      timestamp: new Date().toISOString(),
    });
  });
}
