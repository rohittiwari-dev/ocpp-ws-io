import type { ActiveSession, SessionProfile } from "../types.js";

/**
 * Shared helper used by all strategies to build a SessionProfile
 * from an ActiveSession and an allocated kW figure.
 * Normalises the value to 2 decimal places.
 * Ensures allocatedKw never goes below session.minChargeRateKw (if set).
 */
export function buildSessionProfile(
  session: ActiveSession,
  allocatedKw: number,
): SessionProfile {
  // Enforce minimum charge rate floor
  const minKw = session.minChargeRateKw ?? 0;
  const kw = Math.max(minKw, parseFloat(allocatedKw.toFixed(2)));
  const watts = parseFloat((kw * 1000).toFixed(2));
  // Amps per phase: P(W) = V * I * phases  →  I = P / (V * phases)
  const voltage = 230;
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
    minChargeRateKw: minKw,
  };
}
