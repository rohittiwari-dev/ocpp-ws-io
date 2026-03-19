import type {
  ActiveSession,
  SessionProfile,
  StrategyFn,
  TimeOfUseWindow,
} from "../types.js";
import { buildSessionProfile } from "./utils.js";


/**
 * TIME_OF_USE strategy.
 *
 * Adjusts the effective grid limit based on the current wall-clock time.
 * During configured peak windows, power is multiplied by `peakPowerMultiplier`
 * (a value between 0 and 1). Outside peak windows, full power is available.
 *
 * After the per-window adjustment, power is divided equally among all sessions,
 * each capped by their hardware / EV acceptance limits.
 *
 * @example
 * Peak window: 18:00–22:00, multiplier: 0.5
 * Grid limit: 100 kW
 * At 19:00: effectiveGridLimit = 100 * 0.5 = 50 kW
 * At 14:00: effectiveGridLimit = 100 kW (off-peak)
 */
export const createTimeOfUseStrategy = (
  windows: TimeOfUseWindow[],
): StrategyFn => {
  return (sessions: ActiveSession[], effectiveGridLimitKw: number): SessionProfile[] => {
    if (sessions.length === 0) return [];

    const currentHour = new Date().getHours();
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

    const perSessionKw = gridLimitKw / sessions.length;

    return sessions.map((session) => {
      const hardwareCap = session.maxHardwarePowerKw ?? Infinity;
      const evCap = session.maxEvAcceptancePowerKw ?? Infinity;
      const allocatedKw = Math.min(perSessionKw, hardwareCap, evCap);
      return buildSessionProfile(session, allocatedKw);
    });
  };
};
