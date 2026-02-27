import type { OCPPPlugin } from "../types.js";

/**
 * Options for the session log plugin.
 */
export interface SessionLogOptions {
  /**
   * Custom logger instance. Defaults to `console`.
   * Must have `info` method.
   */
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void };
}

/**
 * Logs connect/disconnect events with identity, IP, protocol, and connection duration.
 *
 * @example
 * ```ts
 * import { sessionLogPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(sessionLogPlugin());
 * // => Connected: CP-101 from 192.168.1.1 via ocpp1.6
 * // => Disconnected: CP-101 after 3600s (code: 1000)
 * ```
 */
export function sessionLogPlugin(options?: SessionLogOptions): OCPPPlugin {
  const logger = options?.logger ?? console;
  const connectionTimes = new Map<string, number>();

  return {
    name: "session-log",

    onConnection(client) {
      connectionTimes.set(client.identity, Date.now());
      logger.info("Connected", {
        identity: client.identity,
        ip: client.handshake.remoteAddress,
        protocol: client.protocol,
      });
    },

    onDisconnect(client, code, reason) {
      const startTime = connectionTimes.get(client.identity);
      const durationSec = startTime
        ? Math.round((Date.now() - startTime) / 1000)
        : 0;
      connectionTimes.delete(client.identity);

      logger.info("Disconnected", {
        identity: client.identity,
        durationSec,
        code,
        reason,
      });
    },

    onClose() {
      connectionTimes.clear();
    },
  };
}
