import type { OCPPPlugin } from "../types.js";

/**
 * Snapshot of tracked server metrics at a point in time.
 */
export interface MetricsSnapshot {
  /** Lifetime total connections since plugin init */
  totalConnections: number;
  /** Lifetime total disconnections since plugin init */
  totalDisconnections: number;
  /** Currently active connections */
  activeConnections: number;
  /** Highest concurrent connections ever observed */
  peakConnections: number;
  /** Average connection duration across all disconnected clients (ms) */
  connectionDurationAvgMs: number;
  /** Time since plugin initialization (ms) */
  uptimeMs: number;
  /** ISO timestamp of this snapshot */
  timestamp: string;
}

/**
 * Options for the metrics plugin.
 */
export interface MetricsPluginOptions {
  /** Interval in ms to emit metric snapshots (default: 30_000). Set to 0 to disable. */
  intervalMs?: number;
  /** Callback fired every interval with the current metrics snapshot. */
  onSnapshot?: (snapshot: MetricsSnapshot) => void;
}

/**
 * Extended OCPPPlugin with an additional `.getMetrics()` accessor.
 */
export interface MetricsPlugin extends OCPPPlugin {
  /** Returns the current metrics snapshot on demand. */
  getMetrics(): MetricsSnapshot;
}

/**
 * Tracks real-time server metrics: connection counters, peak, average duration.
 * Access metrics anytime via `.getMetrics()` on the returned plugin instance.
 *
 * @example
 * ```ts
 * import { metricsPlugin } from 'ocpp-ws-io/plugins';
 *
 * const metrics = metricsPlugin({
 *   intervalMs: 10_000,
 *   onSnapshot: (snap) => console.log(`Active: ${snap.activeConnections}`),
 * });
 * server.plugin(metrics);
 *
 * // On demand
 * const snap = metrics.getMetrics();
 * ```
 */
export function metricsPlugin(options?: MetricsPluginOptions): MetricsPlugin {
  const intervalMs = options?.intervalMs ?? 30_000;

  let totalConnections = 0;
  let totalDisconnections = 0;
  let activeConnections = 0;
  let peakConnections = 0;
  let totalDurationMs = 0;
  let initTime = Date.now();
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;

  const connectionTimes = new Map<string, number>();

  function getMetrics(): MetricsSnapshot {
    return {
      totalConnections,
      totalDisconnections,
      activeConnections,
      peakConnections,
      connectionDurationAvgMs:
        totalDisconnections > 0
          ? Math.round(totalDurationMs / totalDisconnections)
          : 0,
      uptimeMs: Date.now() - initTime,
      timestamp: new Date().toISOString(),
    };
  }

  const plugin: MetricsPlugin = {
    name: "metrics",
    getMetrics,

    onInit() {
      initTime = Date.now();
      if (intervalMs > 0 && options?.onSnapshot) {
        snapshotTimer = setInterval(() => {
          options.onSnapshot!(getMetrics());
        }, intervalMs);
        // Don't block process exit
        if (
          snapshotTimer &&
          typeof snapshotTimer === "object" &&
          "unref" in snapshotTimer
        ) {
          snapshotTimer.unref();
        }
      }
    },

    onConnection(client) {
      totalConnections++;
      activeConnections++;
      if (activeConnections > peakConnections) {
        peakConnections = activeConnections;
      }
      connectionTimes.set(client.identity, Date.now());
    },

    onDisconnect(client) {
      totalDisconnections++;
      activeConnections = Math.max(0, activeConnections - 1);

      const startTime = connectionTimes.get(client.identity);
      if (startTime) {
        totalDurationMs += Date.now() - startTime;
        connectionTimes.delete(client.identity);
      }
    },

    onClose() {
      if (snapshotTimer) {
        clearInterval(snapshotTimer);
        snapshotTimer = null;
      }
      connectionTimes.clear();
    },
  };

  return plugin;
}
