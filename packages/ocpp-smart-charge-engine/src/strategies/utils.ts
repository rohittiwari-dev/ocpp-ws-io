import type { ActiveSession, SessionProfile } from "../types.js";

/** Default grid voltage when none is supplied (European / Indian standard). */
const DEFAULT_VOLTAGE_V = 230;

/** One participant in the water-fill allocation. */
export interface WaterFillItem {
  /** Maximum kW this session can accept (min of hardware & EV caps). */
  cap: number;
  /** Relative weight — 1 for equal share, `priority` for the priority strategy. */
  weight: number;
}

/**
 * Weighted water-filling allocator.
 *
 * Distributes `totalKw` across the items proportionally to their weight, but
 * **never above each item's `cap`**. When an item saturates at its cap, the
 * power it cannot use is redistributed among the still-unsaturated items —
 * repeating until all power is allocated or every item is capped. This is what
 * makes the engine a real constraint solver rather than a single-pass divider:
 * no grid headroom is left unused while a charger could still accept more.
 *
 * Guarantees: `Σ result ≤ totalKw`, and `result[i] ≤ items[i].cap` for all i.
 *
 * @returns kW allocated per item, in the same order as `items`.
 */
export function computeWaterFill(
  items: WaterFillItem[],
  totalKw: number,
): number[] {
  const n = items.length;
  const alloc = new Array<number>(n).fill(0);
  if (n === 0 || totalKw <= 0) return alloc;

  const EPS = 1e-9;
  const saturated = new Array<boolean>(n).fill(false);
  let remaining = totalKw;
  // Each pass saturates at least one item (or exhausts `remaining`), so n+2
  // passes is a safe upper bound; the guard just prevents pathological loops.
  let guard = n + 2;

  while (remaining > EPS && guard-- > 0) {
    const active: number[] = [];
    let weightSum = 0;
    for (let i = 0; i < n; i++) {
      if (!saturated[i] && items[i]!.cap - alloc[i]! > EPS) {
        active.push(i);
        weightSum += items[i]!.weight;
      }
    }
    if (active.length === 0) break; // everyone is capped — stop (rest is unusable)

    // If weights are unusable (all zero / negative), fall back to an equal split.
    const useEqual = weightSum <= EPS;
    const effWeightSum = useEqual ? active.length : weightSum;
    const wOf = (i: number) => (useEqual ? 1 : items[i]!.weight);

    // The smallest amount of `remaining` at which some active item hits its cap.
    let minThreshold = Infinity;
    for (const i of active) {
      const w = wOf(i);
      if (w <= EPS) continue; // zero-weight item takes nothing in a weighted pass
      const remainingCap = items[i]!.cap - alloc[i]!;
      const threshold = (remainingCap * effWeightSum) / w;
      if (threshold < minThreshold) minThreshold = threshold;
    }

    if (!Number.isFinite(minThreshold) || minThreshold >= remaining - EPS) {
      // No item saturates — hand out everything proportionally and finish.
      for (const i of active) {
        alloc[i]! += (remaining * wOf(i)) / effWeightSum;
      }
      remaining = 0;
    } else {
      // Fill up to the binding threshold; snap any newly-capped items.
      for (const i of active) {
        alloc[i]! += (minThreshold * wOf(i)) / effWeightSum;
      }
      remaining -= minThreshold;
      for (const i of active) {
        if (items[i]!.cap - alloc[i]! <= EPS) {
          alloc[i] = items[i]!.cap;
          saturated[i] = true;
        }
      }
    }
  }

  return alloc;
}

/** The hardware/EV upper cap for a session (Infinity when uncapped). */
export function sessionCapKw(session: ActiveSession): number {
  return Math.min(
    session.maxHardwarePowerKw ?? Infinity,
    session.maxEvAcceptancePowerKw ?? Infinity,
  );
}

/**
 * Shared helper used by all strategies to build a SessionProfile
 * from an ActiveSession and an allocated kW figure.
 *
 * - Normalises the value to 2 decimal places.
 * - Enforces `session.minChargeRateKw` as a floor, **but clamps that floor to
 *   the hardware / EV caps** so the result never exceeds what the hardware can
 *   deliver (the floor can never override an upper cap).
 * - Uses the supplied `voltageV` (falls back to 230) for the amps calculation
 *   so the site's configured voltage is actually honored.
 *
 * Note: this enforces the floor per-session. The engine runs a separate
 * grid-budget pass afterwards to guarantee the SUM never exceeds the grid.
 */
export function buildSessionProfile(
  session: ActiveSession,
  allocatedKw: number,
  voltageV: number = DEFAULT_VOLTAGE_V,
): SessionProfile {
  const voltage = voltageV > 0 ? voltageV : DEFAULT_VOLTAGE_V;

  // Upper bound this session can ever receive (hardware & EV acceptance).
  const cap = Math.min(
    session.maxHardwarePowerKw ?? Infinity,
    session.maxEvAcceptancePowerKw ?? Infinity,
  );

  // The floor must never exceed the caps — you can't force a charger above its
  // own hardware limit just because a minimum was requested — and never go
  // negative (defensive against unvalidated values from custom strategies).
  const requestedMin = session.minChargeRateKw ?? 0;
  const effectiveMin = Math.max(0, Math.min(requestedMin, cap));

  // allocatedKw is already <= cap (the strategy capped it); raise to the floor,
  // and re-cap defensively so the result is always within [effectiveMin, cap].
  const rawKw = Math.min(Math.max(allocatedKw, effectiveMin), cap);
  const kw = parseFloat(rawKw.toFixed(2));
  const watts = parseFloat((kw * 1000).toFixed(2));
  // Amps per phase: P(W) = V * I * phases  →  I = P / (V * phases)
  const ampsPerPhase = parseFloat(
    (watts / (voltage * session.phases)).toFixed(2),
  );

  return {
    transactionId: session.transactionId,
    clientId: session.clientId,
    connectorId: session.connectorId,
    allocatedKw: kw,
    allocatedW: watts,
    allocatedAmpsPerPhase: ampsPerPhase,
    minChargeRateKw: parseFloat(effectiveMin.toFixed(2)),
    phases: session.phases,
    voltageV: voltage,
  };
}
