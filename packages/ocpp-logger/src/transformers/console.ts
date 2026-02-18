/**
 * @module voltlog
 * @description Console transformer — outputs structured JSON logs to console.
 * Works in Node.js, browsers, and all runtimes.
 *
 * @example
 * ```ts
 * import { createLogger, consoleTransport } from 'voltlog';
 *
 * const logger = createLogger({
 *   transports: [consoleTransport()],
 * });
 * ```
 */

import {
  LogLevel,
  type LogEntry,
  type LogLevelName,
  type Transformer,
} from "../core/types.js";

export interface ConsoleTransportOptions {
  /** Per-transport level filter */
  level?: LogLevelName;
  /**
   * Use appropriate console method per level (console.warn, console.error, etc.).
   * Default: true
   */
  useConsoleLevels?: boolean;
  /**
   * Format the entry before outputting. Return any value that console.log can handle.
   * Default: serializes to JSON string.
   */
  formatter?: (entry: LogEntry) => unknown;
}

/**
 * Create a console transformer. Outputs structured JSON to the console.
 */
export function consoleTransport(
  options: ConsoleTransportOptions = {},
): Transformer {
  const useConsoleLevels = options.useConsoleLevels ?? true;
  const formatter =
    options.formatter ?? ((entry: LogEntry) => JSON.stringify(entry));

  return {
    name: "console",
    level: options.level,
    transform(entry: LogEntry): void {
      const output = formatter(entry);

      if (!useConsoleLevels) {
        console.log(output);
        return;
      }

      if (entry.level >= LogLevel.FATAL) {
        console.error(output);
      } else if (entry.level >= LogLevel.ERROR) {
        console.error(output);
      } else if (entry.level >= LogLevel.WARN) {
        console.warn(output);
      } else if (entry.level >= LogLevel.DEBUG) {
        console.debug(output);
      } else {
        console.log(output);
      }
    },
  };
}
