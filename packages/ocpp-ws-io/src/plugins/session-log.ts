import type { OCPPPlugin } from "../types.js";

/**
 * Options for the session log plugin.
 */
export interface SessionLogOptions {
  /**
   * Logger instance. Must have at least `info` and `warn`.
   * @default console
   */
  logger?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
  /**
   * Logging verbosity level:
   * - `"minimal"`: connect/disconnect only
   * - `"standard"`: + errors, auth failures, evictions
   * - `"verbose"`: + bad messages, security events
   * @default "standard"
   */
  logLevel?: "minimal" | "standard" | "verbose";
}

/**
 * Structured session lifecycle logger.
 *
 * Logs connection events, errors, auth failures, and evictions at
 * configurable verbosity levels.
 *
 * @example
 * ```ts
 * import { sessionLogPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(sessionLogPlugin({
 *   logLevel: 'verbose',
 *   logger: pino(),
 * }));
 * ```
 */
export function sessionLogPlugin(options?: SessionLogOptions): OCPPPlugin {
  const logger = options?.logger ?? console;
  const level = options?.logLevel ?? "standard";
  const isStandard = level === "standard" || level === "verbose";
  const isVerbose = level === "verbose";

  const connectionTimes = new Map<string, number>();

  return {
    name: "session-log",

    onConnection(client) {
      connectionTimes.set(client.identity, Date.now());
      logger.info("[session] connected", {
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

      logger.info("[session] disconnected", {
        identity: client.identity,
        code,
        reason,
        durationSec,
      });
    },

    // ─── Standard level ────────────────────────────────────────────

    onError(client, error) {
      if (!isStandard) return;
      (logger.error ?? logger.warn)("[session] error", {
        identity: client.identity,
        error: error.message,
      });
    },

    onAuthFailed(handshake, code, reason) {
      if (!isStandard) return;
      logger.warn("[session] auth failed", {
        identity: handshake.identity,
        ip: handshake.remoteAddress,
        code,
        reason,
      });
    },

    onEviction(evictedClient, newClient) {
      if (!isStandard) return;
      logger.warn("[session] evicted", {
        identity: evictedClient.identity,
        evictedIp: evictedClient.handshake.remoteAddress,
        newIp: newClient.handshake.remoteAddress,
      });
    },

    // ─── Verbose level ─────────────────────────────────────────────

    onBadMessage(client, rawMessage) {
      if (!isVerbose) return;
      logger.warn("[session] bad message", {
        identity: client.identity,
        raw:
          typeof rawMessage === "string"
            ? rawMessage.slice(0, 200)
            : "<buffer>",
      });
    },

    onSecurityEvent(event) {
      if (!isVerbose) return;
      logger.warn("[session] security event", {
        type: event.type,
        identity: event.identity,
        ip: event.ip,
        details: event.details,
      });
    },

    onHandlerError(client, method, error) {
      if (!isVerbose) return;
      (logger.error ?? logger.warn)("[session] handler error", {
        identity: client.identity,
        method,
        error: error.message,
      });
    },

    onValidationFailure(client, _message, error) {
      if (!isVerbose) return;
      logger.warn("[session] validation failure", {
        identity: client.identity,
        error: error.message,
      });
    },

    onRateLimitExceeded(client) {
      if (!isStandard) return;
      logger.warn("[session] rate limit exceeded", {
        identity: client.identity,
        ip: client.handshake.remoteAddress,
      });
    },

    onPongTimeout(client) {
      if (!isVerbose) return;
      logger.warn("[session] pong timeout (dead peer)", {
        identity: client.identity,
      });
    },

    onBackpressure(client, bufferedAmount) {
      if (!isVerbose) return;
      logger.warn("[session] backpressure", {
        identity: client.identity,
        bufferedBytes: bufferedAmount,
      });
    },

    onClose() {
      connectionTimes.clear();
    },
  };
}
