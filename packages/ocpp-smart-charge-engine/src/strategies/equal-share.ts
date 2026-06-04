import type {
  ActiveSession,
  SessionProfile,
  StrategyContext,
  StrategyFn,
} from "../types.js";
import { buildSessionProfile, computeWaterFill, sessionCapKw } from "./utils.js";


/**
 * EQUAL_SHARE strategy.
 *
 * Divides the effective grid limit equally among all active sessions, capped to
 * each session's hardware and EV acceptance limits. Power that a capped session
 * cannot use is **redistributed** to sessions that can still accept more
 * (weighted water-filling), so the grid is fully utilized.
 *
 * @example
 * 3 cars on a 100 kW grid with 5% safety margin:
 * effectiveGridLimit = 100 * 0.95 = 95 kW → ~31.67 kW each (capped to limits).
 * If one car caps at 10 kW, its surplus is shared among the other two.
 */
export const equalShareStrategy: StrategyFn = (
  sessions: ActiveSession[],
  effectiveGridLimitKw: number,
  ctx?: StrategyContext,
): SessionProfile[] => {
  if (sessions.length === 0) return [];

  const items = sessions.map((session) => ({
    cap: sessionCapKw(session),
    weight: 1,
  }));
  const allocations = computeWaterFill(items, effectiveGridLimitKw);

  return sessions.map((session, i) =>
    buildSessionProfile(session, allocations[i]!, ctx?.voltageV),
  );
};
