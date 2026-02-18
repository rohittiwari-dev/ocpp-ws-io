/**
 * Internal utility to initialize a logger from LoggingConfig.
 *
 * - `undefined` → default voltlog with console transport
 * - `false` → null (logging disabled)
 * - `LoggingConfig` → custom handler or configured voltlog
 */

import { createLogger, consoleTransport, prettyTransport } from "voltlog";
import type { LoggerLike, LoggingConfig } from "./types.js";

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

  // Custom handler provided — use as-is
  if (config?.handler) {
    if (defaultContext && config.handler.child) {
      return config.handler.child(defaultContext);
    }
    return config.handler;
  }

  // Build default voltlog
  const level = (config?.level ?? "INFO") as
    | "TRACE"
    | "DEBUG"
    | "INFO"
    | "WARN"
    | "ERROR"
    | "FATAL";
  const usePrettify = config?.prettify ?? false;

  const transports = usePrettify
    ? [prettyTransport({ level })]
    : [consoleTransport({ level })];

  const logger = createLogger({
    level,
    transports,
  });

  // Bind default context (e.g. identity)
  if (defaultContext && Object.keys(defaultContext).length > 0) {
    return logger.child(defaultContext);
  }

  return logger;
}
