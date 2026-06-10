import type { OCPPPlugin } from "../types.js";

/**
 * Options for the connection guard plugin.
 */
export interface ConnectionGuardOptions {
  /**
   * Maximum number of concurrent WebSocket connections.
   * New connections beyond this limit are immediately closed.
   */
  maxConnections: number;
  /**
   * Close code sent when the limit is exceeded.
   * @default 4029
   */
  closeCode?: number;
  /**
   * Close reason sent when the limit is exceeded.
   * @default "Connection limit reached"
   */
  closeReason?: string;
  /**
   * Force-close clients that exceed pong timeout (dead peers).
   * Reclaims connection slots held by unresponsive clients.
   * @default true
   */
  forceCloseOnPongTimeout?: boolean;
  /**
   * Force-close clients experiencing backpressure (slow consumers).
   * Useful for freeing slots when a client can't keep up.
   * @default false
   */
  forceCloseOnBackpressure?: boolean;
  /**
   * Logger for guard events.
   */
  logger?: { warn: (...args: unknown[]) => void };
}

/**
 * Enforces a hard cap on concurrent WebSocket connections.
 * Optionally reclaims slots from dead peers (pong timeout) and
 * slow consumers (backpressure).
 *
 * NOTE: prefer `new OCPPServer({ maxConnections })` for the hard cap — it
 * rejects at upgrade time, before TLS/auth work. This plugin's cap closes
 * connections only after they complete the handshake; its main value is the
 * pong-timeout / backpressure slot-reclaim options.
 *
 * @example
 * ```ts
 * import { connectionGuardPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(connectionGuardPlugin({
 *   maxConnections: 1000,
 *   forceCloseOnPongTimeout: true,
 *   forceCloseOnBackpressure: false, // only enable if you want aggressive slot reclaim
 * }));
 * ```
 */
export function connectionGuardPlugin(
  options: ConnectionGuardOptions,
): OCPPPlugin {
  const maxConnections = options.maxConnections;
  const closeCode = options.closeCode ?? 4029;
  const closeReason = options.closeReason ?? "Connection limit reached";
  const forceOnPong = options.forceCloseOnPongTimeout ?? true;
  const forceOnBackpressure = options.forceCloseOnBackpressure ?? false;

  let activeCount = 0;

  return {
    name: "connection-guard",

    onConnection(client) {
      activeCount++;
      if (activeCount > maxConnections) {
        options.logger?.warn?.(
          `[connection-guard] Limit exceeded (${activeCount}/${maxConnections}), closing: ${client.identity}`,
        );
        client.close({
          code: closeCode,
          reason: closeReason,
        });
      }
    },

    onDisconnect() {
      activeCount = Math.max(0, activeCount - 1);
    },

    onPongTimeout(client) {
      if (!forceOnPong) return;

      options.logger?.warn?.(
        `[connection-guard] Pong timeout — closing dead peer: ${client.identity}`,
      );
      client.close({
        code: 4000,
        reason: "Pong timeout",
      });
    },

    onBackpressure(client, bufferedAmount) {
      if (!forceOnBackpressure) return;

      options.logger?.warn?.(
        `[connection-guard] Backpressure (${bufferedAmount} bytes) — closing slow client: ${client.identity}`,
      );
      client.close({
        code: 4001,
        reason: "Backpressure exceeded",
      });
    },

    onClose() {
      activeCount = 0;
    },
  };
}
