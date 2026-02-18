/**
 * @module voltlog
 * @description Redaction middleware — auto-redacts sensitive fields from log meta and context.
 *
 * @example
 * ```ts
 * import { createLogger, consoleTransport, redactionMiddleware } from 'voltlog';
 *
 * const logger = createLogger({
 *   transports: [consoleTransport()],
 *   middleware: [redactionMiddleware({ paths: ['password', 'idToken', 'authorization'] })],
 * });
 *
 * logger.info('Auth attempt', { password: 's3cret', user: 'admin' });
 * // → { password: '[REDACTED]', user: 'admin' }
 * ```
 */

import type { LogMiddleware, LogEntry } from "../core/types.js";

const DEFAULT_REDACT_VALUE = "[REDACTED]";

export interface RedactionOptions {
  /** Field paths to redact (case-insensitive matching) */
  paths: string[];
  /** Replacement value (default: '[REDACTED]') */
  replacement?: string;
  /** Also redact matching keys in nested objects (default: true) */
  deep?: boolean;
}

/**
 * Create a redaction middleware that replaces sensitive field values.
 */
export function redactionMiddleware<TMeta = Record<string, unknown>>(
  options: RedactionOptions,
): LogMiddleware<TMeta> {
  const paths = new Set(options.paths.map((p) => p.toLowerCase()));
  const replacement = options.replacement ?? DEFAULT_REDACT_VALUE;
  const deep = options.deep ?? true;

  function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (paths.has(key.toLowerCase())) {
        result[key] = replacement;
      } else if (
        deep &&
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        result[key] = redactObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return (entry: LogEntry<TMeta>, next) => {
    const redacted = { ...entry };

    if (entry.meta && typeof entry.meta === "object") {
      redacted.meta = redactObject(
        entry.meta as Record<string, unknown>,
      ) as TMeta;
    }

    if (entry.context && typeof entry.context === "object") {
      redacted.context = redactObject(entry.context);
    }

    next(redacted);
  };
}
