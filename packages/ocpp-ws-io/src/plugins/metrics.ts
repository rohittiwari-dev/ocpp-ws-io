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

  // ─── Message Counters ──────────────────────────────────────────
  /** Total inbound messages received */
  totalMessagesIn: number;
  /** Total outbound messages sent */
  totalMessagesOut: number;
  /** Total CALL messages */
  totalCalls: number;
  /** Total CALLRESULT messages */
  totalCallResults: number;
  /** Total CALLERROR messages */
  totalCallErrors: number;

  // ─── Error & Anomaly Counters ──────────────────────────────────
  /** Total WebSocket/protocol errors */
  totalErrors: number;
  /** Total malformed/unparseable messages */
  totalBadMessages: number;
  /** Total user handler errors */
  totalHandlerErrors: number;
  /** Total rate limit hits */
  totalRateLimitHits: number;
  /** Total auth failures */
  totalAuthFailures: number;
  /** Total client evictions */
  totalEvictions: number;
  /** Total backpressure events */
  totalBackpressureEvents: number;
  /** Total pong timeouts (dead peers) */
  totalPongTimeouts: number;
  /** Total schema validation failures */
  totalValidationFailures: number;
  /** Total security events (from anomaly detector etc.) */
  totalSecurityEvents: number;
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
 * Tracks comprehensive real-time server metrics: connection counters, message
 * throughput, error rates, security events, and peak values.
 *
 * Access metrics anytime via `.getMetrics()` on the returned plugin instance.
 * Automatically exports all counters to the Prometheus `/metrics` endpoint
 * via `getCustomMetrics()`.
 *
 * @example
 * ```ts
 * import { metricsPlugin } from 'ocpp-ws-io/plugins';
 *
 * const metrics = metricsPlugin({
 *   intervalMs: 10_000,
 *   onSnapshot: (snap) => console.log(`Active: ${snap.activeConnections}, Msgs: ${snap.totalMessagesIn}`),
 * });
 * server.plugin(metrics);
 *
 * // On demand
 * const snap = metrics.getMetrics();
 * ```
 */
export function metricsPlugin(options?: MetricsPluginOptions): MetricsPlugin {
  const intervalMs = options?.intervalMs ?? 30_000;

  // Connection counters
  let totalConnections = 0;
  let totalDisconnections = 0;
  let activeConnections = 0;
  let peakConnections = 0;
  let totalDurationMs = 0;
  let initTime = Date.now();
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;

  // Message counters
  let totalMessagesIn = 0;
  let totalMessagesOut = 0;
  let totalCalls = 0;
  let totalCallResults = 0;
  let totalCallErrors = 0;

  // Error & anomaly counters
  let totalErrors = 0;
  let totalBadMessages = 0;
  let totalHandlerErrors = 0;
  let totalRateLimitHits = 0;
  let totalAuthFailures = 0;
  let totalEvictions = 0;
  let totalBackpressureEvents = 0;
  let totalPongTimeouts = 0;
  let totalValidationFailures = 0;
  let totalSecurityEvents = 0;

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
      totalMessagesIn,
      totalMessagesOut,
      totalCalls,
      totalCallResults,
      totalCallErrors,
      totalErrors,
      totalBadMessages,
      totalHandlerErrors,
      totalRateLimitHits,
      totalAuthFailures,
      totalEvictions,
      totalBackpressureEvents,
      totalPongTimeouts,
      totalValidationFailures,
      totalSecurityEvents,
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
        if (
          snapshotTimer &&
          typeof snapshotTimer === "object" &&
          "unref" in snapshotTimer
        ) {
          snapshotTimer.unref();
        }
      }
    },

    // ─── Connection Lifecycle ──────────────────────────────────────

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

    // ─── Message Observation ───────────────────────────────────────

    onMessage(_client, payload) {
      if (payload.direction === "IN") {
        totalMessagesIn++;
      } else {
        totalMessagesOut++;
      }

      // Count by message type: 2=CALL, 3=CALLRESULT, 4=CALLERROR
      const msgType = payload.message[0];
      if (msgType === 2) totalCalls++;
      else if (msgType === 3) totalCallResults++;
      else if (msgType === 4) totalCallErrors++;
    },

    // ─── Error & Anomaly Counters ──────────────────────────────────

    onError() {
      totalErrors++;
    },

    onBadMessage() {
      totalBadMessages++;
    },

    onHandlerError() {
      totalHandlerErrors++;
    },

    onRateLimitExceeded() {
      totalRateLimitHits++;
    },

    onAuthFailed() {
      totalAuthFailures++;
    },

    onEviction() {
      totalEvictions++;
    },

    onBackpressure() {
      totalBackpressureEvents++;
    },

    onPongTimeout() {
      totalPongTimeouts++;
    },

    onValidationFailure() {
      totalValidationFailures++;
    },

    onSecurityEvent() {
      totalSecurityEvents++;
    },

    // ─── Prometheus Export ──────────────────────────────────────────

    getCustomMetrics() {
      return [
        // Connection metrics
        `# HELP ocpp_connections_total Total connections since server start`,
        `# TYPE ocpp_connections_total counter`,
        `ocpp_connections_total ${totalConnections}`,
        `# HELP ocpp_disconnections_total Total disconnections since server start`,
        `# TYPE ocpp_disconnections_total counter`,
        `ocpp_disconnections_total ${totalDisconnections}`,
        `# HELP ocpp_connections_active Currently active connections`,
        `# TYPE ocpp_connections_active gauge`,
        `ocpp_connections_active ${activeConnections}`,
        `# HELP ocpp_connections_peak Highest concurrent connections`,
        `# TYPE ocpp_connections_peak gauge`,
        `ocpp_connections_peak ${peakConnections}`,
        `# HELP ocpp_connection_duration_avg_ms Average connection duration`,
        `# TYPE ocpp_connection_duration_avg_ms gauge`,
        `ocpp_connection_duration_avg_ms ${getMetrics().connectionDurationAvgMs}`,

        // Message metrics
        `# HELP ocpp_messages_in_total Total inbound messages`,
        `# TYPE ocpp_messages_in_total counter`,
        `ocpp_messages_in_total ${totalMessagesIn}`,
        `# HELP ocpp_messages_out_total Total outbound messages`,
        `# TYPE ocpp_messages_out_total counter`,
        `ocpp_messages_out_total ${totalMessagesOut}`,
        `# HELP ocpp_calls_total Total CALL messages`,
        `# TYPE ocpp_calls_total counter`,
        `ocpp_calls_total ${totalCalls}`,
        `# HELP ocpp_call_results_total Total CALLRESULT messages`,
        `# TYPE ocpp_call_results_total counter`,
        `ocpp_call_results_total ${totalCallResults}`,
        `# HELP ocpp_call_errors_total Total CALLERROR messages`,
        `# TYPE ocpp_call_errors_total counter`,
        `ocpp_call_errors_total ${totalCallErrors}`,

        // Error & anomaly metrics
        `# HELP ocpp_errors_total WebSocket/protocol errors`,
        `# TYPE ocpp_errors_total counter`,
        `ocpp_errors_total ${totalErrors}`,
        `# HELP ocpp_bad_messages_total Malformed messages received`,
        `# TYPE ocpp_bad_messages_total counter`,
        `ocpp_bad_messages_total ${totalBadMessages}`,
        `# HELP ocpp_handler_errors_total User handler errors`,
        `# TYPE ocpp_handler_errors_total counter`,
        `ocpp_handler_errors_total ${totalHandlerErrors}`,
        `# HELP ocpp_rate_limit_hits_total Rate limit violations`,
        `# TYPE ocpp_rate_limit_hits_total counter`,
        `ocpp_rate_limit_hits_total ${totalRateLimitHits}`,
        `# HELP ocpp_auth_failures_total Authentication failures`,
        `# TYPE ocpp_auth_failures_total counter`,
        `ocpp_auth_failures_total ${totalAuthFailures}`,
        `# HELP ocpp_evictions_total Client evictions`,
        `# TYPE ocpp_evictions_total counter`,
        `ocpp_evictions_total ${totalEvictions}`,
        `# HELP ocpp_backpressure_events_total Slow client backpressure events`,
        `# TYPE ocpp_backpressure_events_total counter`,
        `ocpp_backpressure_events_total ${totalBackpressureEvents}`,
        `# HELP ocpp_pong_timeouts_total Dead peer timeouts`,
        `# TYPE ocpp_pong_timeouts_total counter`,
        `ocpp_pong_timeouts_total ${totalPongTimeouts}`,
        `# HELP ocpp_validation_failures_total Schema validation failures`,
        `# TYPE ocpp_validation_failures_total counter`,
        `ocpp_validation_failures_total ${totalValidationFailures}`,
        `# HELP ocpp_security_events_total Security events from anomaly detection`,
        `# TYPE ocpp_security_events_total counter`,
        `ocpp_security_events_total ${totalSecurityEvents}`,
      ];
    },

    // ─── Cleanup ───────────────────────────────────────────────────

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
