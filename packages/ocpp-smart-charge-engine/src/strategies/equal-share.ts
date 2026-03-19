import type { ActiveSession, SessionProfile, StrategyFn } from "../types.js";
import { buildSessionProfile } from "./utils.js";


/**
 * EQUAL_SHARE strategy.
 *
 * Divides the effective grid limit equally among all active sessions.
 * Each session is additionally capped to its own hardware and EV acceptance limits.
 *
 * @example
 * 3 cars on a 100 kW grid with 5% safety margin:
 * effectiveGridLimit = 100 * 0.95 = 95 kW
 * each car gets: 95 / 3 = 31.67 kW (capped to hardware limits)
 */
export const equalShareStrategy: StrategyFn = (
  sessions: ActiveSession[],
  effectiveGridLimitKw: number,
): SessionProfile[] => {
  if (sessions.length === 0) return [];

  const perSessionKw = effectiveGridLimitKw / sessions.length;

  return sessions.map((session) => {
    const hardwareCap = session.maxHardwarePowerKw ?? Infinity;
    const evCap = session.maxEvAcceptancePowerKw ?? Infinity;
    const allocatedKw = Math.min(perSessionKw, hardwareCap, evCap);

    return buildSessionProfile(session, allocatedKw);
  });
};
