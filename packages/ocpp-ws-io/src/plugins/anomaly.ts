import type { OCPPServer } from "../server.js";
import type { OCPPPlugin } from "../types.js";

/**
 * Options for the anomaly detection plugin.
 */
export interface AnomalyPluginOptions {
  /**
   * Maximum number of connections from the same identity
   * within the sliding window before triggering an anomaly.
   * Default: 5
   */
  reconnectThreshold?: number;
  /**
   * Sliding window duration in milliseconds.
   * Default: 60_000 (1 minute)
   */
  windowMs?: number;
}

/**
 * Detects anomalous connection patterns such as rapid reconnections
 * from the same identity. Emits `securityEvent` on the server with
 * type `ANOMALY_RAPID_RECONNECT`.
 *
 * @example
 * ```ts
 * import { anomalyPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(anomalyPlugin({
 *   reconnectThreshold: 10,
 *   windowMs: 60_000,
 * }));
 *
 * server.on('securityEvent', (evt) => {
 *   if (evt.type === 'ANOMALY_RAPID_RECONNECT') {
 *     console.warn(`Rapid reconnect storm: ${evt.identity}`);
 *   }
 * });
 * ```
 */
export function anomalyPlugin(options?: AnomalyPluginOptions): OCPPPlugin {
  const threshold = options?.reconnectThreshold ?? 5;
  const windowMs = options?.windowMs ?? 60_000;

  /** Map of identity → array of connection timestamps */
  const connectLog = new Map<string, number[]>();
  let server: OCPPServer | null = null;
  let gcTimer: ReturnType<typeof setInterval> | null = null;

  function pruneExpired(timestamps: number[], now: number): number[] {
    const cutoff = now - windowMs;
    // Find first index that is within the window
    let i = 0;
    while (i < timestamps.length && timestamps[i] < cutoff) i++;
    return i > 0 ? timestamps.slice(i) : timestamps;
  }

  return {
    name: "anomaly",

    onInit(srv) {
      server = srv;
      // Periodic garbage collection of expired entries
      gcTimer = setInterval(() => {
        const now = Date.now();
        for (const [identity, timestamps] of connectLog) {
          const pruned = pruneExpired(timestamps, now);
          if (pruned.length === 0) {
            connectLog.delete(identity);
          } else {
            connectLog.set(identity, pruned);
          }
        }
      }, windowMs).unref();
    },

    onConnection(client) {
      const now = Date.now();
      const identity = client.identity;

      let timestamps = connectLog.get(identity) ?? [];
      timestamps = pruneExpired(timestamps, now);
      timestamps.push(now);
      connectLog.set(identity, timestamps);

      if (timestamps.length > threshold && server) {
        server.emit("securityEvent" as any, {
          type: "ANOMALY_RAPID_RECONNECT",
          identity,
          ip: client.handshake.remoteAddress,
          timestamp: new Date().toISOString(),
          details: {
            connectionsInWindow: timestamps.length,
            threshold,
            windowMs,
          },
        });
      }
    },

    onClose() {
      if (gcTimer) {
        clearInterval(gcTimer);
        gcTimer = null;
      }
      connectLog.clear();
      server = null;
    },
  };
}
