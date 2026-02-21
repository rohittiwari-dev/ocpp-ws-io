/**
 * Internal utility to initialize a logger from LoggingConfig.
 *
 * - `undefined` → default voltlog-io with console transport
 * - `false` → null (logging disabled)
 * - `LoggingConfig` → custom handler or configured voltlog-io
 */

import {
  consoleTransport,
  createLogger,
  type LogEntry,
  type LogLevelName,
  type LogMiddleware,
  prettyTransport,
} from "voltlog-io";
import type { LoggerLike, LoggingConfig } from "./types.js";

// ─── Display middleware ─────────────────────────────────────────

/**
 * Check if any display option differs from its default.
 */
function hasDisplayCustomization(config: LoggingConfig): boolean {
  return (
    config.showMetadata === false ||
    config.showSourceMeta === false ||
    config.prettifySource === true ||
    config.prettifyMetadata === true
  );
}

/**
 * Build a voltlog-io LogMiddleware that transforms context/meta
 * before the transport sees them, so prettyTransport's colors are preserved.
 *
 * Strategy:
 *  - hide   → clear the field so prettyTransport skips it
 *  - prettify → embed a readable string into `entry.message` and clear the raw field
 */
function buildDisplayMiddleware(config: LoggingConfig): LogMiddleware {
  const showMeta = config.showMetadata ?? true;
  const showSource = config.showSourceMeta ?? true;
  const prettySrc = config.prettifySource ?? false;
  const prettyMeta = config.prettifyMetadata ?? false;

  // ANSI color codes for prettification
  const DIM = "\x1b[2;37m"; // dim white
  const RESET = "\x1b[0m"; // reset all styles
  const CYAN = "\x1b[36m"; // cyan

  return (entry: LogEntry, next: (e: LogEntry) => void) => {
    // ── Source context ──
    if (!showSource) {
      // Hide entirely
      entry.context = undefined;
    } else if (prettySrc && entry.context) {
      // Build compact tag like [OCPPServer/WT159]
      const parts: string[] = [];
      if (entry.context.component) parts.push(String(entry.context.component));
      if (entry.context.identity) parts.push(String(entry.context.identity));
      if (parts.length > 0) {
        // Embed into message and clear context
        entry.message = `${DIM}[${parts.join("/")}]${RESET} ${entry.message}`;
        entry.context = undefined;
      }
    }

    // ── Trailing metadata ──
    const meta = entry.meta as Record<string, unknown> | undefined;
    if (!showMeta) {
      // Hide entirely
      entry.meta = {} as typeof entry.meta;
    } else if (prettyMeta && meta && Object.keys(meta).length > 0) {
      // Build key=value pairs, embed into message, clear meta
      const pairs = Object.entries(meta)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => {
          let valStr = typeof v === "object" ? JSON.stringify(v) : String(v);
          // Apply some basic dimming for non-string values or objects to keep it clean
          if (typeof v === "string") {
            valStr = `${DIM}${valStr}${RESET}`;
          } else {
            valStr = `${DIM}${valStr}${RESET}`;
          }
          return `${CYAN}${k}${RESET}=${valStr}`;
        })
        .join(" ");
      if (pairs) {
        entry.message = `${entry.message}  ${pairs}`;
      }
      entry.meta = {} as typeof entry.meta;
    }

    next(entry);
  };
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Resolve a LoggingConfig | false | undefined into a LoggerLike or null.
 */
export function initLogger(
  config: LoggingConfig | false | undefined,
  defaultContext?: Record<string, unknown>,
): LoggerLike | null {
  // Explicitly disabled
  if (config === false) return null;
  if (config?.enabled === false) return null;

  // Custom external logger provided — use as-is
  if (config?.logger) {
    if (defaultContext && config.logger.child) {
      return config.logger.child(defaultContext);
    }
    return config.logger;
  }

  // Build default voltlog-io
  const level = (config?.level ?? "INFO") as LogLevelName;
  const usePrettify = config?.prettify ?? false;

  const transports = usePrettify
    ? [prettyTransport({ level })]
    : [consoleTransport({ level })];

  if (config?.handler) {
    const customTransport = config.handler;
    transports.push({
      name: "customHandler",
      write: (entry) => customTransport(entry),
    });
  }

  // Build display middleware if any display options are set
  const middleware: LogMiddleware[] = [];
  if (config && hasDisplayCustomization(config)) {
    middleware.push(buildDisplayMiddleware(config));
  }

  const logger = createLogger({
    level,
    transports,
    middleware: middleware.length > 0 ? middleware : undefined,
  });

  // Bind default context (e.g. identity)
  if (defaultContext && Object.keys(defaultContext).length > 0) {
    return logger.child(defaultContext);
  }

  return logger;
}
