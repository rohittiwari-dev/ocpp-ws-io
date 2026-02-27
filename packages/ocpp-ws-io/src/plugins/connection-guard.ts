import type { OCPPPlugin } from "../types.js";

/**
 * Options for the connection guard plugin.
 */
export interface ConnectionGuardOptions {
  /** Maximum allowed concurrent connections. */
  maxConnections: number;
}

/**
 * Enforces a hard limit on concurrent connections.
 * New connections exceeding the limit are force-closed with code 4001.
 *
 * @example
 * ```ts
 * import { connectionGuardPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(connectionGuardPlugin({ maxConnections: 5000 }));
 * ```
 */
export function connectionGuardPlugin(
  options: ConnectionGuardOptions,
): OCPPPlugin {
  let activeCount = 0;

  return {
    name: "connection-guard",

    onConnection(client) {
      activeCount++;
      if (activeCount > options.maxConnections) {
        client
          .close({
            code: 4001,
            reason: "Connection limit reached",
            force: true,
          })
          .catch(() => {});
      }
    },

    onDisconnect() {
      activeCount = Math.max(0, activeCount - 1);
    },

    onClose() {
      activeCount = 0;
    },
  };
}
