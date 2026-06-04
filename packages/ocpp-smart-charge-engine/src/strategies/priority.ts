import type {
  ActiveSession,
  SessionProfile,
  StrategyContext,
  StrategyFn,
} from "../types.js";
import { buildSessionProfile, computeWaterFill, sessionCapKw } from "./utils.js";


/**
 * PRIORITY strategy.
 *
 * Allocates power proportionally to each session's `priority` field (higher =
 * more), capped by hardware / EV limits. Power a capped session cannot use is
 * **redistributed** to the remaining sessions in proportion to their priority
 * (weighted water-filling), so the grid is fully utilized. The total never
 * exceeds `effectiveGridLimitKw`.
 *
 * If every session has priority 0 (or the priorities sum to ≤ 0), the strategy
 * falls back to an equal split to avoid a divide-by-zero producing `NaN`.
 *
 * @example
 * Session A: priority 8, Session B: priority 2 → 80 kW / 20 kW on a 100kW grid.
 * If A's hardware caps at 40 kW → A gets 40 kW and the surplus flows to B → B
 * gets 60 kW (the full 100 kW grid is used).
 */
export const priorityStrategy: StrategyFn = (
  sessions: ActiveSession[],
  effectiveGridLimitKw: number,
  ctx?: StrategyContext,
): SessionProfile[] => {
  if (sessions.length === 0) return [];

  // computeWaterFill falls back to an equal split when the weights sum to ≤ 0,
  // so all-zero priorities are handled without a divide-by-zero.
  const items = sessions.map((session) => ({
    cap: sessionCapKw(session),
    weight: session.priority,
  }));
  const allocations = computeWaterFill(items, effectiveGridLimitKw);

  return sessions.map((session, i) =>
    buildSessionProfile(session, allocations[i]!, ctx?.voltageV),
  );
};
