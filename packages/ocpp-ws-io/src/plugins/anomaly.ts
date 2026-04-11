import type { OCPPServer } from "../server.js";
import type { OCPPPlugin, SecurityEvent } from "../types.js";

/**
 * Options for the anomaly detection plugin.
 */
export interface AnomalyPluginOptions {
  /**
   * Maximum number of connections from the same identity
   * within the sliding window before triggering an anomaly.
   * @default 5
   */
  reconnectThreshold?: number;
  /**
   * Sliding window duration in milliseconds.
   * @default 60_000 (1 minute)
   */
  windowMs?: number;
  /**
   * Maximum auth failures from the same IP within the window
   * before triggering a brute-force anomaly.
   * @default 5
   */
  authFailureThreshold?: number;
  /**
   * Maximum bad messages from the same identity within the window
   * before triggering a fuzzing anomaly.
   * @default 10
   */
  badMessageThreshold?: number;
  /**
   * Maximum evictions for the same identity within the window
   * before triggering an identity-collision anomaly.
   * @default 3
   */
  evictionThreshold?: number;
}

/**
 * Detects anomalous connection patterns: rapid reconnections, brute-force
 * auth attempts, message fuzzing, and identity-stealing races.
 *
 * Emits `securityEvent` on the server with typed anomaly identifiers.
 *
 * @example
 * ```ts
 * import { anomalyPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(anomalyPlugin({
 *   reconnectThreshold: 10,
 *   authFailureThreshold: 5,
 *   badMessageThreshold: 20,
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
  const reconnectThreshold = options?.reconnectThreshold ?? 5;
  const authFailThreshold = options?.authFailureThreshold ?? 5;
  const badMsgThreshold = options?.badMessageThreshold ?? 10;
  const evictionThreshold = options?.evictionThreshold ?? 3;
  const windowMs = options?.windowMs ?? 60_000;

  // Sliding window logs: key → array of timestamps
  const connectLog = new Map<string, number[]>();
  const authFailLog = new Map<string, number[]>(); // keyed by IP
  const badMsgLog = new Map<string, number[]>(); // keyed by identity
  const evictionLog = new Map<string, number[]>(); // keyed by identity

  let server: OCPPServer | null = null;
  let gcTimer: ReturnType<typeof setInterval> | null = null;

  function pruneExpired(timestamps: number[], now: number): number[] {
    const cutoff = now - windowMs;
    let i = 0;
    while (i < timestamps.length && timestamps[i] < cutoff) i++;
    return i > 0 ? timestamps.slice(i) : timestamps;
  }

  function gcMap(map: Map<string, number[]>, now: number): void {
    for (const [key, timestamps] of map) {
      const pruned = pruneExpired(timestamps, now);
      if (pruned.length === 0) {
        map.delete(key);
      } else {
        map.set(key, pruned);
      }
    }
  }

  function trackAndCheck(
    map: Map<string, number[]>,
    key: string,
    threshold: number,
    anomalyType: SecurityEvent["type"],
    details: Record<string, unknown>,
  ): void {
    const now = Date.now();
    let timestamps = map.get(key) ?? [];
    timestamps = pruneExpired(timestamps, now);
    timestamps.push(now);
    map.set(key, timestamps);

    if (timestamps.length > threshold && server) {
      const evt: SecurityEvent = {
        type: anomalyType,
        identity: details.identity as string | undefined,
        ip: (details.ip ?? details.evictedIp) as string | undefined,
        timestamp: new Date().toISOString(),
        details: {
          ...details,
          countInWindow: timestamps.length,
          threshold,
          windowMs,
        },
      };
      server.emit("securityEvent", evt);
    }
  }

  return {
    name: "anomaly",

    onInit(srv) {
      server = srv;
      // Periodic garbage collection of expired entries
      gcTimer = setInterval(() => {
        const now = Date.now();
        gcMap(connectLog, now);
        gcMap(authFailLog, now);
        gcMap(badMsgLog, now);
        gcMap(evictionLog, now);
      }, windowMs).unref();
    },

    onConnection(client) {
      trackAndCheck(
        connectLog,
        client.identity,
        reconnectThreshold,
        "ANOMALY_RAPID_RECONNECT",
        {
          identity: client.identity,
          ip: client.handshake.remoteAddress,
        },
      );
    },

    onAuthFailed(handshake, code, reason) {
      trackAndCheck(
        authFailLog,
        handshake.remoteAddress,
        authFailThreshold,
        "ANOMALY_AUTH_BRUTE_FORCE",
        {
          ip: handshake.remoteAddress,
          identity: handshake.identity,
          code,
          reason,
        },
      );
    },

    onBadMessage(client) {
      trackAndCheck(
        badMsgLog,
        client.identity,
        badMsgThreshold,
        "ANOMALY_MESSAGE_FUZZING",
        {
          identity: client.identity,
          ip: client.handshake.remoteAddress,
        },
      );
    },

    onValidationFailure(client) {
      // Schema validation failures are a secondary fuzzing indicator
      trackAndCheck(
        badMsgLog,
        client.identity,
        badMsgThreshold,
        "ANOMALY_MESSAGE_FUZZING",
        {
          identity: client.identity,
          ip: client.handshake.remoteAddress,
          source: "validation_failure",
        },
      );
    },

    onEviction(evictedClient, newClient) {
      trackAndCheck(
        evictionLog,
        evictedClient.identity,
        evictionThreshold,
        "ANOMALY_IDENTITY_COLLISION",
        {
          identity: evictedClient.identity,
          evictedIp: evictedClient.handshake.remoteAddress,
          newIp: newClient.handshake.remoteAddress,
        },
      );
    },

    onClose() {
      if (gcTimer) {
        clearInterval(gcTimer);
        gcTimer = null;
      }
      connectLog.clear();
      authFailLog.clear();
      badMsgLog.clear();
      evictionLog.clear();
      server = null;
    },
  };
}
