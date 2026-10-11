import type { IncomingMessage } from "node:http";
import type { SecurityEvent, ServerEvents } from "../../types/events.js";
import type { HandshakeInfo } from "../../types/handshake.js";
import type { LoggerLike } from "../../types/logger.js";
import type { CORSOptions, ServerOptions } from "../../types/server.js";

/** A per-IP token bucket for connectionRateLimit. */
export interface ConnectionBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * The server state the upgrade steps read, through getters, and the reports
 * they make, which call the server's own methods.
 */
export interface UpgradeContext {
  readonly logger: LoggerLike | null;
  readonly globalCORS: CORSOptions | undefined;
  readonly maxConnections: ServerOptions["maxConnections"];
  readonly connectionRateLimit: ServerOptions["connectionRateLimit"];
  readonly handshakeTimeoutMs: ServerOptions["handshakeTimeoutMs"];
  /** Connected clients. */
  readonly clientCount: number;
  /** Handshakes past the connection cap that are not clients yet. */
  readonly pendingHandshakes: number;
  /** One token bucket per client IP. */
  readonly connectionBuckets: Map<string, ConnectionBucket>;
  /** Set once the untrusted X-Forwarded-For warning has been logged. */
  warnedUntrustedProxy: boolean;
  /** Emit a security event, and pass it to every plugin's onSecurityEvent. */
  emitSecurityEvent(event: SecurityEvent): void;
  emitUpgradeAborted(event: ServerEvents["upgradeAborted"][0]): void;
  /** Log and emit a refused handshake, and pass it to the plugins. */
  reportAuthFailure(
    handshake: HandshakeInfo,
    req: IncomingMessage,
    code: number,
    message: string,
  ): void;
  /** Log an unexpected handshake error and report it as UPGRADE_ERROR. */
  reportUpgradeError(
    handshake: HandshakeInfo,
    req: IncomingMessage,
    error: string,
    stack: string | undefined,
  ): void;
}
