/**
 * @module voltlog
 * @description Alert middleware — evaluates configurable rules and fires callbacks.
 *
 * @example
 * ```ts
 * import { createLogger, consoleTransport, alertMiddleware } from 'voltlog';
 *
 * const logger = createLogger({
 *   transports: [consoleTransport()],
 *   middleware: [
 *     alertMiddleware([
 *       {
 *         name: 'error-spike',
 *         when: (entry) => entry.level >= 50, // ERROR+
 *         threshold: 10,
 *         windowMs: 60_000,
 *         cooldownMs: 300_000,
 *         onAlert: async (entries) => {
 *           await sendEmail({ subject: `${entries.length} errors in 1 min` });
 *         },
 *       },
 *       {
 *         name: 'callerror-alert',
 *         when: (entry) => entry.meta.messageType === 'CALLERROR',
 *         threshold: 5,
 *         windowMs: 60_000,
 *         onAlert: (entries) => sendSlackNotification(entries),
 *       },
 *     ]),
 *   ],
 * });
 * ```
 */

import type { LogMiddleware, LogEntry, AlertRule } from "../core/types.js";

interface AlertState<TMeta> {
  entries: LogEntry<TMeta>[];
  lastFired: number;
}

/**
 * Create an alert middleware that evaluates rules against every log entry.
 *
 * Alerts are non-blocking — `onAlert` failures are silently caught
 * to never interfere with the logging pipeline.
 */
export function alertMiddleware<TMeta = Record<string, unknown>>(
  rules: AlertRule<TMeta>[],
): LogMiddleware<TMeta> {
  const states = new Map<string, AlertState<TMeta>>();

  // Initialize state for each rule
  for (const rule of rules) {
    states.set(rule.name, { entries: [], lastFired: -Infinity });
  }

  return (entry: LogEntry<TMeta>, next) => {
    const now = entry.timestamp;

    for (const rule of rules) {
      if (!rule.when(entry)) continue;

      const state = states.get(rule.name)!;
      const windowMs = rule.windowMs ?? Infinity;
      const threshold = rule.threshold ?? 1;
      const cooldownMs = rule.cooldownMs ?? 0;

      // Trim entries outside the window
      if (Number.isFinite(windowMs)) {
        state.entries = state.entries.filter(
          (e) => now - e.timestamp < windowMs,
        );
      }

      state.entries.push(entry);

      // Check if threshold is met and cooldown has passed
      if (
        state.entries.length >= threshold &&
        now - state.lastFired >= cooldownMs
      ) {
        const alertEntries = [...state.entries];
        state.entries = [];
        state.lastFired = now;

        // Fire alert asynchronously — never block the pipeline
        try {
          const result = rule.onAlert(alertEntries);
          if (result && typeof (result as Promise<void>).catch === "function") {
            (result as Promise<void>).catch(() => {
              /* Alert callback errors swallowed */
            });
          }
        } catch {
          /* Sync alert errors swallowed */
        }
      }
    }

    // Always pass through — alerts don't drop entries
    next(entry);
  };
}
