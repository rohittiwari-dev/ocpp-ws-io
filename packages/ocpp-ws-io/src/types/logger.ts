/** Logger contract and logging options. */
import type { LogEntry } from "voltlog-io";

// ─── Logger Interface ────────────────────────────────────────────

/**
 * Minimal logger contract — compatible with `console`, `pino`, `voltlog-io`,
 * or any custom object with these methods.
 *
 * All methods are optional so `console` works as-is.
 */
export interface LoggerLike {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
  child?(context: Record<string, unknown>): LoggerLike;
}
/**
 * Minimal logger contract — compatible with `console`, `pino`, `voltlog-io`,
 * or any custom object with these methods.
 *
 * All methods are optional so `console` works as-is.
 * this is only not optional for the logger used by the library
 */
export interface LoggerLikeNotOptional {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): LoggerLike;
}
/**
 * Logging configuration for OCPPClient and OCPPServer.
 *
 * @example Default (auto console logging)
 * ```ts
 * const client = new OCPPClient({ identity: 'CP-101', endpoint: '...' });
 * // → Logs to console via voltlog-io by default
 * ```
 *
 * @example Disable logging
 * ```ts
 * new OCPPClient({ identity: 'CP-101', endpoint: '...', logging: false });
 * ```
 *
 * @example Custom logger
 * ```ts
 * new OCPPClient({ identity: 'CP-101', endpoint: '...', logging: { handler: pino() } });
 * ```
 */
export interface LoggingConfig {
  /** Enable/disable logging (default: true) */
  enabled?: boolean;
  /**
   * Enable OCPP exchange logging (default: false).
   * Adds `direction: 'IN' | 'OUT'` to OCPP message logs.
   * When combined with `prettify`, renders styled exchange lines:
   * `⚡ CP-101  →  BootNotification  [IN]`
   */
  exchangeLog?: boolean;
  /**
   * Enable pretty-printed colored output (default: false).
   * Uses voltlog-io's prettyTransport with icons, colors, and timestamps.
   * Without this, logs are structured JSON.
   */
  prettify?: boolean;
  /** Log level for the default voltlog-io logger (default: 'INFO') */
  level?: string;
  /** Custom logger — replaces the default voltlog-io entirely */
  logger?: LoggerLike;
  /** Custom VoltLog transport function — receives formatted logs */
  handler?: (entry: LogEntry) => void | Promise<void>;

  // ─── Display Options (only apply to default voltlog-io logger) ──

  /**
   * Show trailing metadata object in log output (default: true).
   * `INFO Server listening {"port":5000,"host":"0.0.0.0"}`
   *                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ← hidden when false
   */
  showMetadata?: boolean;
  /**
   * Show source context object in log output (default: true).
   * `INFO Server listening {"component":"OCPPServer"} {"port":5000}`
   *                         ^^^^^^^^^^^^^^^^^^^^^^^^ ← hidden when false
   */
  showSourceMeta?: boolean;
  /**
   * Prettify source context into a compact tag (default: false).
   * `{"component":"OCPPServer","identity":"CP-1"}` → `[OCPPServer/CP-1]`
   */
  prettifySource?: boolean;
  /**
   * Prettify trailing metadata into readable key=value pairs (default: false).
   * `{"port":5000,"host":"0.0.0.0"}` → `port=5000 host=0.0.0.0`
   */
  prettifyMetadata?: boolean;
}
