/**
 * @module voltlog
 * @description Pipeline — middleware composition and transformer fan-out.
 */

import { resolveLevel, shouldLog } from "./levels.js";
import type { LogEntry, LogMiddleware, Transformer } from "./types.js";

/**
 * Build a composed middleware function from an array of middleware.
 * Each middleware calls `next()` to pass the entry forward.
 * Omit `next()` to drop the entry (e.g. sampling).
 */
export function composeMiddleware<TMeta = Record<string, unknown>>(
  middleware: LogMiddleware<TMeta>[],
  final: (entry: LogEntry<TMeta>) => void,
): (entry: LogEntry<TMeta>) => void {
  if (middleware.length === 0) return final;

  return (entry: LogEntry<TMeta>) => {
    let index = 0;

    const next = (e: LogEntry<TMeta>): void => {
      if (index < middleware.length) {
        const mw = middleware[index++]!;
        mw(e, next);
      } else {
        final(e);
      }
    };

    next(entry);
  };
}

/**
 * Fan out a log entry to all transformers, respecting per-transformer level filters.
 * All transformers run concurrently and fire-and-forget for non-blocking logging.
 */
export function fanOutToTransformers<TMeta = Record<string, unknown>>(
  entry: LogEntry<TMeta>,
  transformers: Transformer<TMeta>[],
  loggerLevel: number,
): void {
  for (const t of transformers) {
    const tLevel = t.level ? resolveLevel(t.level) : loggerLevel;

    if (!shouldLog(entry.level, tLevel)) continue;

    try {
      const result = t.transform(entry);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {
          /* Swallow transport errors to avoid crashing the host app */
        });
      }
    } catch {
      /* Sync transport errors swallowed */
    }
  }
}
