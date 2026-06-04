import type {
  ActiveSession,
  SessionProfile,
  StrategyContext,
  StrategyFn,
  TimeOfUseWindow,
} from "../types.js";
import { buildSessionProfile, computeWaterFill, sessionCapKw } from "./utils.js";


/**
 * TIME_OF_USE strategy.
 *
 * Adjusts the effective grid limit based on the current wall-clock time.
 * During configured peak windows, power is multiplied by `peakPowerMultiplier`
 * (a value between 0 and 1). Outside peak windows, full power is available.
 *
 * After the per-window adjustment, power is divided equally among all sessions
 * (capped by their hardware / EV acceptance limits), with any surplus from
 * capped sessions redistributed to the rest via weighted water-filling.
 *
 * @example
 * Peak window: 18:00–22:00, multiplier: 0.5
 * Grid limit: 100 kW
 * At 19:00: effectiveGridLimit = 100 * 0.5 = 50 kW
 * At 14:00: effectiveGridLimit = 100 kW (off-peak)
 */
/**
 * Resolve the current hour-of-day (0–23). When an IANA `timezone` is given the
 * hour is evaluated in that zone; otherwise the host's local time is used.
 * Falls back to local time if the timezone string is invalid.
 */
function currentHourInTimezone(timezone?: string): number {
  if (!timezone) return new Date().getHours();
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(new Date());
    const hour = parseInt(formatted, 10);
    // Some platforms render midnight as "24" — normalize to 0–23.
    return Number.isFinite(hour) ? hour % 24 : new Date().getHours();
  } catch {
    return new Date().getHours();
  }
}

export const createTimeOfUseStrategy = (
  windows: TimeOfUseWindow[],
  timezone?: string,
): StrategyFn => {
  return (
    sessions: ActiveSession[],
    effectiveGridLimitKw: number,
    ctx?: StrategyContext,
  ): SessionProfile[] => {
    if (sessions.length === 0) return [];

    const currentHour = currentHourInTimezone(timezone);
    let gridLimitKw = effectiveGridLimitKw;

    for (const window of windows) {
      const inPeak =
        window.peakStartHour <= window.peakEndHour
          ? currentHour >= window.peakStartHour && currentHour < window.peakEndHour
          // handles overnight windows like 22:00–06:00
          : currentHour >= window.peakStartHour || currentHour < window.peakEndHour;

      if (inPeak) {
        gridLimitKw = effectiveGridLimitKw * window.peakPowerMultiplier;
        break; // First matching window wins
      }
    }

    const items = sessions.map((session) => ({
      cap: sessionCapKw(session),
      weight: 1,
    }));
    const allocations = computeWaterFill(items, gridLimitKw);

    return sessions.map((session, i) =>
      buildSessionProfile(session, allocations[i]!, ctx?.voltageV),
    );
  };
};
