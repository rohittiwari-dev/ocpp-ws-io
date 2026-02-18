/**
 * @module voltlog
 * @description Pretty transformer — human-readable colored output with OCPP exchange formatting.
 *
 * @example Dev mode
 * ```ts
 * import { createLogger, prettyTransport } from 'voltlog';
 *
 * const logger = createLogger({
 *   transports: [prettyTransport()],
 * });
 *
 * logger.info('Server started', { port: 9000 });
 * // → ℹ 2024-01-15T10:30:00.000Z  INFO  Server started  { port: 9000 }
 * ```
 *
 * @example OCPP exchange logs
 * ```ts
 * logger.info('OCPP exchange', {
 *   chargePointId: 'CP-101',
 *   action: 'BootNotification',
 *   messageType: 'CALL',
 *   direction: 'IN',
 *   latencyMs: 34,
 *   status: 'Accepted',
 * });
 * // → ⚡ CP-101  →  BootNotification  [IN]  CALL
 * // → ✔ Accepted  (34ms)
 * ```
 */

import {
  LogLevel,
  type LogEntry,
  type LogLevelName,
  type OcppExchangeMeta,
  type Transformer,
} from "../core/types.js";

export interface PrettyTransportOptions {
  /** Per-transport level filter */
  level?: LogLevelName;
  /** Show timestamps (default: true) */
  timestamps?: boolean;
  /** Use colors in output (default: true) */
  colors?: boolean;
}

// ─── ANSI Color Codes ────────────────────────────────────────────

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

const COLORS: Record<string, string> = {
  TRACE: "\x1b[90m", // gray
  DEBUG: "\x1b[36m", // cyan
  INFO: "\x1b[32m", // green
  WARN: "\x1b[33m", // yellow
  ERROR: "\x1b[31m", // red
  FATAL: "\x1b[35;1m", // bold magenta
};

const ICONS: Record<string, string> = {
  TRACE: "🔍",
  DEBUG: "🐛",
  INFO: "ℹ",
  WARN: "⚠",
  ERROR: "✖",
  FATAL: "💀",
};

const EXCHANGE_ICONS: Record<string, string> = {
  CALL: "⚡",
  CALLRESULT: "✔",
  CALLERROR: "🚨",
};

const DIRECTION_ARROWS: Record<string, string> = {
  IN: "→",
  OUT: "←",
};

/**
 * Create a pretty-print transformer for dev/debug use.
 * Includes OCPP exchange log prettification.
 */
export function prettyTransport(
  options: PrettyTransportOptions = {},
): Transformer {
  const showTimestamps = options.timestamps ?? true;
  const useColors = options.colors ?? true;

  function colorize(text: string, color: string): string {
    return useColors ? `${color}${text}${RESET}` : text;
  }

  function formatExchange(entry: LogEntry): string | null {
    const meta = entry.meta as unknown as OcppExchangeMeta;
    if (!meta || !meta.action || !meta.messageType) return null;

    const icon = EXCHANGE_ICONS[meta.messageType] ?? "•";
    const arrow = DIRECTION_ARROWS[meta.direction ?? "IN"] ?? "→";
    const cpId = meta.chargePointId ?? "unknown";
    const action = meta.action;
    const msgType = meta.messageType;
    const dir = meta.direction ?? "";

    let line = `${icon} ${colorize(cpId, BOLD)}  ${arrow}  ${colorize(action, BOLD)}  [${dir}]  ${colorize(msgType, DIM)}`;

    // Second line for response info
    if (meta.status || meta.latencyMs !== undefined) {
      const statusIcon = meta.messageType === "CALLERROR" ? "❌" : "✔";
      const status = meta.status ?? "";
      const latency =
        meta.latencyMs !== undefined ? `(${meta.latencyMs}ms)` : "";
      line += `\n${statusIcon} ${status}  ${colorize(latency, DIM)}`;
    }

    return line;
  }

  function formatStandard(entry: LogEntry): string {
    const icon = ICONS[entry.levelName] ?? "•";
    const levelColor = COLORS[entry.levelName] ?? "";
    const level = colorize(entry.levelName.padEnd(5), levelColor);
    const ts = showTimestamps
      ? colorize(new Date(entry.timestamp).toISOString(), DIM) + "  "
      : "";

    let line = `${icon} ${ts}${level}  ${entry.message}`;

    // Add context
    if (entry.context && Object.keys(entry.context).length > 0) {
      line += `  ${colorize(JSON.stringify(entry.context), DIM)}`;
    }

    // Add meta (only non-OCPP fields or all if no exchange)
    if (
      entry.meta &&
      Object.keys(entry.meta as Record<string, unknown>).length > 0
    ) {
      line += `  ${colorize(JSON.stringify(entry.meta), DIM)}`;
    }

    // Add error
    if (entry.error) {
      line += `\n  ${colorize(`${entry.error.name ?? "Error"}: ${entry.error.message}`, COLORS["ERROR"] ?? "")}`;
      if (entry.error.stack) {
        line += `\n${colorize(entry.error.stack, DIM)}`;
      }
    }

    return line;
  }

  return {
    name: "pretty",
    level: options.level,
    transform(entry: LogEntry): void {
      // Try exchange format first
      const exchangeOutput = formatExchange(entry);
      if (exchangeOutput) {
        console.log(exchangeOutput);
        return;
      }

      // Fall back to standard pretty format
      const output = formatStandard(entry);

      if (entry.level >= LogLevel.ERROR) {
        console.error(output);
      } else if (entry.level >= LogLevel.WARN) {
        console.warn(output);
      } else {
        console.log(output);
      }
    },
  };
}
