import type { OCPPPlugin } from "../types.js";

/**
 * Auto-responds to `Heartbeat` OCPP calls with `{ currentTime }`.
 * Registers a handler on each connecting client.
 *
 * @example
 * ```ts
 * import { heartbeatPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(heartbeatPlugin());
 * // All clients will now get automatic Heartbeat responses
 * ```
 */
export function heartbeatPlugin(): OCPPPlugin {
  return {
    name: "heartbeat",

    onConnection(client) {
      // Don't clobber an application-registered Heartbeat handler
      if (client.hasHandler("Heartbeat")) return;
      client.handle("Heartbeat", () => ({
        currentTime: new Date().toISOString(),
      }));
    },
  };
}
