/**
 * Version-specific ChargingProfile builder helpers.
 *
 * The engine produces library-agnostic `SessionProfile` objects (raw kW/W/A numbers).
 * Use these builders in your dispatcher to convert them into the correct
 * OCPP version-specific `SetChargingProfile` payload.
 *
 * OCPP Charging Profile differences by version:
 *   - 1.6:   `chargingProfileId`, `ChargePointMaxProfile`, single `chargingSchedule` object
 *   - 2.0.1: `id`, `ChargingStationMaxProfile`, `chargingSchedule` is an ARRAY,
 *             transactionId is a string, new `salesTariff` and `powerTolerance` fields
 *   - 2.1:   extends 2.0.1 with ISO 15118-20 V2G discharge profiles (`dischargeLimit`)
 */

import type { SessionProfile } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper types
// ─────────────────────────────────────────────────────────────────────────────

/** A manually-defined schedule period (for multi-period profiles). */
export interface ManualSchedulePeriod {
  /** Offset in seconds from schedule start. First entry must be 0. */
  startPeriod: number;
  /** Power limit in the chosen `rateUnit` (W or A). */
  limit: number;
  numberPhases?: 1 | 2 | 3;
}

// ─────────────────────────────────────────────────────────────────────────────
// OCPP 1.6 ChargingProfile
// ─────────────────────────────────────────────────────────────────────────────

export interface Ocpp16ChargingProfile {
  chargingProfileId: number;
  transactionId?: number;
  stackLevel: number;
  chargingProfilePurpose:
    | "ChargePointMaxProfile"
    | "TxDefaultProfile"
    | "TxProfile";
  chargingProfileKind: "Absolute" | "Recurring" | "Relative";
  recurrencyKind?: "Daily" | "Weekly";
  validFrom?: string;
  validTo?: string;
  chargingSchedule: Ocpp16ChargingSchedule;
}

export interface Ocpp16ChargingSchedule {
  duration?: number;
  startSchedule?: string;
  chargingRateUnit: "W" | "A";
  chargingSchedulePeriod: Ocpp16ChargingSchedulePeriod[];
  minChargingRate?: number;
}

export interface Ocpp16ChargingSchedulePeriod {
  startPeriod: number;
  limit: number;
  numberPhases?: 1 | 2 | 3;
}

/** Options for the OCPP 1.6 profile builder */
export interface Ocpp16ProfileOptions {
  profileId?: number;
  stackLevel?: number;
  purpose?: Ocpp16ChargingProfile["chargingProfilePurpose"];
  /** Rate unit — defaults to 'W' */
  rateUnit?: "W" | "A";
  numberPhases?: 1 | 2 | 3;
  /**
   * Override with custom multi-period schedule.
   * If not provided, a single period is built from the sessionProfile's limit.
   * Limits in the periods array are used AS-IS (not converted by rateUnit).
   *
   * @example
   * // 22kW for 1h, then 7kW until full
   * periods: [
   *   { startPeriod: 0,    limit: 22000, numberPhases: 3 },
   *   { startPeriod: 3600, limit: 7000,  numberPhases: 3 },
   * ]
   */
  periods?: ManualSchedulePeriod[];
}

/**
 * Build an OCPP **1.6** `CsChargingProfiles` object from a `SessionProfile`.
 *
 * Pass the result as `csChargingProfiles` inside `SetChargingProfile`.
 *
 * @example
 * ```typescript
 * dispatcher: async ({ clientId, connectorId, sessionProfile }) => {
 *   const profile = buildOcpp16Profile(sessionProfile);
 *   await server.safeSendToClient(clientId, 'ocpp1.6', 'SetChargingProfile', {
 *     connectorId,
 *     csChargingProfiles: profile,
 *   });
 * }
 * ```
 */
let ocpp16IdCounter = 1;

export function buildOcpp16Profile(
  sessionProfile: SessionProfile,
  options: Ocpp16ProfileOptions = {},
): Ocpp16ChargingProfile {
  const rateUnit = options.rateUnit ?? "W";
  const limit =
    rateUnit === "W"
      ? sessionProfile.allocatedW
      : sessionProfile.allocatedAmpsPerPhase;

  const minChargingRate =
    sessionProfile.minChargeRateKw > 0
      ? rateUnit === "W"
        ? sessionProfile.minChargeRateKw * 1000
        : (sessionProfile.minChargeRateKw * 1000) / ((options.numberPhases ?? 3) * 230)
      : undefined;

  const periods: Ocpp16ChargingSchedulePeriod[] = options.periods
    ? options.periods.map((p) => ({ ...p }))
    : [{ startPeriod: 0, limit, numberPhases: options.numberPhases ?? 3 }];

  return {
    chargingProfileId: options.profileId ?? ocpp16IdCounter++,
    ...(typeof sessionProfile.transactionId === "number"
      ? { transactionId: sessionProfile.transactionId }
      : {}),
    stackLevel: options.stackLevel ?? 0,
    chargingProfilePurpose: options.purpose ?? "TxProfile",
    chargingProfileKind: "Absolute",
    chargingSchedule: {
      chargingRateUnit: rateUnit,
      chargingSchedulePeriod: periods,
      ...(minChargingRate !== undefined ? { minChargingRate } : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OCPP 2.0.1 ChargingProfile
// ─────────────────────────────────────────────────────────────────────────────

export interface Ocpp201ChargingProfile {
  /** In 2.0.1 this is `id` (not `chargingProfileId`) */
  id: number;
  transactionId?: string; // string in 2.0.1 (not integer like 1.6)
  stackLevel: number;
  chargingProfilePurpose:
    | "ChargingStationExternalConstraints"
    | "ChargingStationMaxProfile"
    | "TxDefaultProfile"
    | "TxProfile";
  chargingProfileKind: "Absolute" | "Recurring" | "Relative";
  recurrencyKind?: "Daily" | "Weekly";
  validFrom?: string;
  validTo?: string;
  /** In 2.0.1+, chargingSchedule is an ARRAY (supports multiple tariff tiers) */
  chargingSchedule: Ocpp201ChargingSchedule[];
}

export interface Ocpp201ChargingSchedule {
  id: number;
  startSchedule?: string;
  duration?: number;
  chargingRateUnit: "W" | "A";
  chargingSchedulePeriod: Ocpp201ChargingSchedulePeriod[];
  minChargingRate?: number;
  /** Optional: power tolerance ±% around the limit */
  powerTolerance?: number;
}

export interface Ocpp201ChargingSchedulePeriod {
  startPeriod: number;
  limit: number;
  /** Phase count. Defaults to 3. */
  numberPhases?: 1 | 2 | 3;
  /** Which phase to use for single-phase charging. L1=1, L2=2, L3=3 */
  phaseToUse?: 1 | 2 | 3;
}

/** Options for the OCPP 2.0.1 profile builder */
export interface Ocpp201ProfileOptions {
  profileId?: number;
  stackLevel?: number;
  purpose?: Ocpp201ChargingProfile["chargingProfilePurpose"];
  rateUnit?: "W" | "A";
  numberPhases?: 1 | 2 | 3;
  /**
   * Override with custom multi-period schedule.
   * @example
   * // Charge at 22kW for 2h, then 11kW for 4h
   * periods: [
   *   { startPeriod: 0,    limit: 22000, numberPhases: 3 },
   *   { startPeriod: 7200, limit: 11000, numberPhases: 3 },
   * ]
   */
  periods?: ManualSchedulePeriod[];
}

/**
 * Build an OCPP **2.0.1** `ChargingProfile` object from a `SessionProfile`.
 *
 * Pass the result as `chargingProfile` inside `SetChargingProfile`.
 * The `evseId` in OCPP 2.0.1 replaces `connectorId` from 1.6.
 *
 * @example
 * ```typescript
 * dispatcher: async ({ clientId, connectorId, sessionProfile }) => {
 *   const profile = buildOcpp201Profile(sessionProfile);
 *   await server.safeSendToClient(clientId, 'ocpp2.0.1', 'SetChargingProfile', {
 *     evseId: connectorId,   // connectorId becomes evseId in 2.0.1
 *     chargingProfile: profile,
 *   });
 * }
 * ```
 */
let ocpp201IdCounter = 1;

export function buildOcpp201Profile(
  sessionProfile: SessionProfile,
  options: Ocpp201ProfileOptions = {},
): Ocpp201ChargingProfile {
  const rateUnit = options.rateUnit ?? "W";
  const limit =
    rateUnit === "W"
      ? sessionProfile.allocatedW
      : sessionProfile.allocatedAmpsPerPhase;

  const minChargingRate =
    sessionProfile.minChargeRateKw > 0
      ? rateUnit === "W"
        ? sessionProfile.minChargeRateKw * 1000
        : (sessionProfile.minChargeRateKw * 1000) / ((options.numberPhases ?? 3) * 230)
      : undefined;

  const periods: Ocpp201ChargingSchedulePeriod[] = options.periods
    ? options.periods.map((p) => ({ ...p }))
    : [{ startPeriod: 0, limit, numberPhases: options.numberPhases ?? 3 }];

  return {
    id: options.profileId ?? ocpp201IdCounter++,
    transactionId: String(sessionProfile.transactionId),
    stackLevel: options.stackLevel ?? 0,
    chargingProfilePurpose: options.purpose ?? "TxProfile",
    chargingProfileKind: "Absolute",
    chargingSchedule: [
      {
        id: 1,
        chargingRateUnit: rateUnit,
        chargingSchedulePeriod: periods,
        ...(minChargingRate !== undefined ? { minChargingRate } : {}),
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OCPP 2.1 ChargingProfile (extends 2.0.1 with V2G discharge)
// ─────────────────────────────────────────────────────────────────────────────

export interface Ocpp21ChargingSchedulePeriod extends Ocpp201ChargingSchedulePeriod {
  /**
   * Maximum discharge power (V2G). Negative limit = discharge to grid.
   * Only supported on bidirectional chargers (ISO 15118-20).
   * @example -7400  // discharge at 7.4kW
   */
  dischargeLimit?: number;
  /** EV setpoint (precise target, not just a limit). 2.1 only. */
  setpoint?: number;
  setpointReactive?: number;
}

export interface Ocpp21ChargingSchedule extends Omit<Ocpp201ChargingSchedule, "chargingSchedulePeriod"> {
  chargingSchedulePeriod: Ocpp21ChargingSchedulePeriod[];
}

export interface Ocpp21ChargingProfile extends Omit<Ocpp201ChargingProfile, "chargingSchedule"> {
  chargingSchedule: Ocpp21ChargingSchedule[];
}

/** Options for the OCPP 2.1 profile builder */
export interface Ocpp21ProfileOptions extends Ocpp201ProfileOptions {
  /**
   * V2G discharge limit in Watts (positive number, engine will negate).
   * Only relevant for bidirectional / V2G-capable chargers.
   * @example 7400  // 7.4kW V2G discharge
   */
  dischargeLimitW?: number;
}

/**
 * Build an OCPP **2.1** `ChargingProfile` object from a `SessionProfile`.
 *
 * Extends the 2.0.1 profile with optional V2G `dischargeLimit` field
 * for bidirectional charging (ISO 15118-20).
 *
 * @example
 * ```typescript
 * dispatcher: async ({ clientId, connectorId, sessionProfile }) => {
 *   const profile = buildOcpp21Profile(sessionProfile, { dischargeLimitW: 7400 });
 *   await server.safeSendToClient(clientId, 'ocpp2.1', 'SetChargingProfile', {
 *     evseId: connectorId,
 *     chargingProfile: profile,
 *   });
 * }
 * ```
 */
let ocpp21IdCounter = 1;

export function buildOcpp21Profile(
  sessionProfile: SessionProfile,
  options: Ocpp21ProfileOptions = {},
): Ocpp21ChargingProfile {
  const rateUnit = options.rateUnit ?? "W";
  const limit =
    rateUnit === "W"
      ? sessionProfile.allocatedW
      : sessionProfile.allocatedAmpsPerPhase;

  const minChargingRate =
    sessionProfile.minChargeRateKw > 0
      ? rateUnit === "W"
        ? sessionProfile.minChargeRateKw * 1000
        : (sessionProfile.minChargeRateKw * 1000) / ((options.numberPhases ?? 3) * 230)
      : undefined;

  const period: Ocpp21ChargingSchedulePeriod = {
    startPeriod: 0,
    limit,
    numberPhases: options.numberPhases ?? 3,
    ...(options.dischargeLimitW !== undefined
      ? { dischargeLimit: -Math.abs(options.dischargeLimitW) }
      : {}),
  };

  const periods: Ocpp21ChargingSchedulePeriod[] = options.periods
    ? options.periods.map((p) => ({ ...p }))
    : [period];

  return {
    id: options.profileId ?? ocpp21IdCounter++,
    transactionId: String(sessionProfile.transactionId),
    stackLevel: options.stackLevel ?? 0,
    chargingProfilePurpose: options.purpose ?? "TxProfile",
    chargingProfileKind: "Absolute",
    chargingSchedule: [
      {
        id: 1,
        chargingRateUnit: rateUnit,
        chargingSchedulePeriod: periods,
        ...(minChargingRate !== undefined ? { minChargingRate } : {}),
      },
    ],
  };
}
