import type { ActiveSession, SessionProfile, StrategyFn } from "../types.js";
import { buildSessionProfile } from "./utils.js";


/**
 * PRIORITY strategy.
 *
 * Allocates power proportionally to each session's `priority` field (higher = more).
 * The total is guaranteed to never exceed `effectiveGridLimitKw`.
 *
 * Allocation formula:
 *   share_i = (priority_i / sumAllPriorities) * effectiveGridLimitKw
 * Then each share is capped by hardware / EV limits.
 * Any unclaimed headroom (from caps) is NOT redistributed in v0.1.0-alpha.
 *
 * @example
 * Session A: priority 8, Session B: priority 2 → 80 kW / 20 kW on a 100kW grid
 * If Session A's hardware caps at 40 kW → A gets 40kW, B gets 20kW (60kW total used)
 */
export const priorityStrategy: StrategyFn = (
  sessions: ActiveSession[],
  effectiveGridLimitKw: number,
): SessionProfile[] => {
  if (sessions.length === 0) return [];

  const totalPriority = sessions.reduce((sum, s) => sum + s.priority, 0);

  return sessions.map((session) => {
    const share = (session.priority / totalPriority) * effectiveGridLimitKw;
    const hardwareCap = session.maxHardwarePowerKw ?? Infinity;
    const evCap = session.maxEvAcceptancePowerKw ?? Infinity;
    const allocatedKw = Math.min(share, hardwareCap, evCap);

    return buildSessionProfile(session, allocatedKw);
  });
};
