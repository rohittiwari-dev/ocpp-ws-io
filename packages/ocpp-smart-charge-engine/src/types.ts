/**
 * ocpp-smart-charge-engine — Public Types
 *
 * Library-agnostic. No imports from ocpp-ws-io, ws, or any other OCPP library.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — the ONLY integration point with the user's chosen OCPP library.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The payload the engine hands to your dispatcher when it needs to send a
 * SetChargingProfile to a specific charging station.
 *
 * The `sessionProfile` contains the raw calculated numbers (kW, W, A).
 * Use the version-specific builder helpers to convert to the right OCPP shape:
 *   - `buildOcpp16Profile(sessionProfile)`  → OCPP 1.6 `CsChargingProfiles`
 *   - `buildOcpp201Profile(sessionProfile)` → OCPP 2.0.1/2.1 `ChargingProfile`
 *
 * @example Using with ocpp-ws-io (OCPP 1.6):
 *   import { buildOcpp16Profile } from 'ocpp-smart-charge-engine/builders';
 *
 *   dispatcher: async ({ clientId, connectorId, sessionProfile }) => {
 *     await server.safeSendToClient(clientId, 'ocpp1.6', 'SetChargingProfile', {
 *       connectorId,
 *       csChargingProfiles: buildOcpp16Profile(sessionProfile),
 *     });
 *   }
 *
 * @example Using with ocpp-ws-io (OCPP 2.0.1):
 *   import { buildOcpp201Profile } from 'ocpp-smart-charge-engine/builders';
 *
 *   dispatcher: async ({ clientId, connectorId, sessionProfile }) => {
 *     await server.safeSendToClient(clientId, 'ocpp2.0.1', 'SetChargingProfile', {
 *       evseId: connectorId,   // NOTE: connectorId → evseId in 2.0.1
 *       chargingProfile: buildOcpp201Profile(sessionProfile),
 *     });
 *   }
 *
 * @note If your charger does not support SmartCharging (common on OCPP 1.6
 * chargers that only implement the Core profile), your dispatcher should catch
 * the CALLERROR response and handle it gracefully. The engine will emit a
 * 'dispatchError' event for that session but will NOT affect other sessions.
 */
export type ChargingProfileDispatcher = (
  payload: DispatchPayload,
) => Promise<void>;

/** The full context passed to every dispatcher call. */
export interface DispatchPayload {
  /** The charging station identity string (e.g., "CP-001"). */
  clientId: string;

  /**
   * The connector to target (OCPP 1.6) / EVSE ID (OCPP 2.0.1).
   * 0 = all connectors on the station (1.6 only), 1+ for a specific connector.
   */
  connectorId: number;

  /** The transactionId this profile targets. */
  transactionId: number | string;

  /**
   * Raw calculated session profile (kW, W, A numbers).
   * Use `buildOcpp16Profile` or `buildOcpp201Profile` from
   * `'ocpp-smart-charge-engine/builders'` to convert to version-specific shapes.
   */
  sessionProfile: SessionProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clear Dispatcher — for removing profiles when sessions end
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The payload passed to `clearDispatcher` when a session ends or `clearDispatch()`
 * is called. Use this to send `ClearChargingProfile` to the charger.
 *
 * @example Using with ocpp-ws-io (OCPP 1.6):
 *   clearDispatcher: async ({ clientId, connectorId, transactionId }) => {
 *     await server.safeSendToClient(clientId, 'ocpp1.6', 'ClearChargingProfile', {
 *       connectorId,
 *       chargingProfilePurpose: 'TxProfile',
 *       stackLevel: 0,
 *     });
 *   }
 *
 * @example Using with ocpp-ws-io (OCPP 2.0.1):
 *   clearDispatcher: async ({ clientId, connectorId }) => {
 *     await server.safeSendToClient(clientId, 'ocpp2.0.1', 'ClearChargingProfile', {
 *       chargingProfileCriteria: {
 *         evseId: connectorId,
 *         chargingProfilePurpose: 'TxProfile',
 *         stackLevel: 0,
 *       },
 *     });
 *   }
 */
export type ClearProfileDispatcher = (
  payload: ClearDispatchPayload,
) => Promise<void>;

/** The full context passed to every clearDispatcher call. */
export interface ClearDispatchPayload {
  /** The charging station identity string. */
  clientId: string;
  /** Connector / EVSE ID the profile was targeting. */
  connectorId: number;
  /** The transactionId of the session that ended. */
  transactionId: number | string;
}



// ─────────────────────────────────────────────────────────────────────────────
// Session — the engine's view of an active charging session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A charging session registered with the engine.
 * Populated from OCPP `StartTransaction` (1.6) or `TransactionEvent(Started)` (2.0.1).
 */
export interface ChargingSession {
  /** Unique transaction identifier from the CSMS or the charger. */
  transactionId: number | string;

  /** The charging station identity (same as client.identity in ocpp-ws-io). */
  clientId: string;

  /**
   * Which connector is being used. Defaults to 1 if not provided.
   * 0 is reserved for station-wide profiles.
   */
  connectorId?: number;

  /**
   * The maximum power this station's hardware can deliver to this connector.
   * Used as an upper cap — the engine will never assign more than this.
   * Set to `Infinity` to let the grid calculation solely determine the limit.
   */
  maxHardwarePowerKw?: number;

  /**
   * The maximum power the EV itself can accept (from OCPP RequestStartTransaction
   * or from an out-of-band source like an EVSEID database).
   * Set to `Infinity` if unknown — the engine caps by hardware limit instead.
   */
  maxEvAcceptancePowerKw?: number;

  /**
   * Minimum charging rate this session must receive.
   * Some EVs and heat pumps fault if power drops below a threshold.
   * The engine will never assign less than this value to this session.
   * If the grid cannot accommodate this minimum for all sessions, the session
   * still receives this value and headroom is reduced from others.
   * @example 1.4  // 1.4 kW minimum (6A × 230V)
   */
  minChargeRateKw?: number;

  /**
   * Session priority. Higher number = higher priority.
   * Only used by the PRIORITY strategy.
   * Defaults to 1 if not set.
   */
  priority?: number;

  /**
   * Optional: Number of AC phases this connector supports.
   * Used by the 3-phase balancer. Defaults to 3.
   */
  phases?: 1 | 3;

  /**
   * Optional: Arbitrary metadata you want attached to the session.
   * Useful for RFID tags, tariff IDs, fleet vehicle IDs, etc.
   * The engine stores this but does not use it for calculations.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Internal representation of a session — readonly snapshot after being added.
 * Exposed by `engine.getSessions()`.
 */
export type ActiveSession = Required<
  Pick<ChargingSession, "transactionId" | "clientId" | "priority" | "phases">
> &
  Omit<ChargingSession, "transactionId" | "clientId" | "priority" | "phases"> & {
    connectorId: number;
    addedAt: number; // Date.now()
  };

// ─────────────────────────────────────────────────────────────────────────────
// Strategy output
// ─────────────────────────────────────────────────────────────────────────────

/** What a strategy function returns per-session after optimization. */
export interface SessionProfile {
  transactionId: number | string;
  clientId: string;
  connectorId: number;
  /** Allocated power in kW */
  allocatedKw: number;
  /** Allocated power converted to Watts (allocatedKw * 1000) */
  allocatedW: number;
  /** Allocated amps per phase (allocatedW / phases / 230) */
  allocatedAmpsPerPhase: number;
  /** Minimum charge rate in kW (from session.minChargeRateKw, or 0 if not set) */
  minChargeRateKw: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Available built-in algorithm strategies */
export type Strategy = "EQUAL_SHARE" | "PRIORITY" | "TIME_OF_USE";

/** Configuration for Time-of-Use pricing windows */
export interface TimeOfUseWindow {
  /** Hour of day (0–23) when the peak pricing window starts */
  peakStartHour: number;
  /** Hour of day (0–23) when the peak pricing window ends (exclusive) */
  peakEndHour: number;
  /**
   * Power multiplier during peak hours. E.g. 0.5 = charge at 50% during peak.
   * Must be between 0 and 1.
   */
  peakPowerMultiplier: number;
}

/** Options for the SmartChargingEngine constructor */
export interface SmartChargingEngineConfig {
  /**
   * A human-readable site or group identifier. Used in logs and events.
   * @example "SITE-HQ-001"
   */
  siteId: string;

  /**
   * The maximum grid power available for EV charging at this site (in kW).
   * @example 100  // 100 kW grid connection
   */
  maxGridPowerKw: number;

  /**
   * Number of AC phases at the site. Defaults to 3.
   * Used for per-phase amperage calculations returned in profiles.
   */
  phases?: 1 | 3;

  /**
   * The allocation strategy. Defaults to "EQUAL_SHARE".
   * Can be changed at runtime via `engine.setAlgorithm()`.
   */
  algorithm?: Strategy;

  /**
   * Percentage of grid capacity to hold in reserve as a safety margin.
   * Prevents the site from running at 100% capacity continuously.
   * @default 5  (5%)
   */
  safetyMarginPct?: number;

  /**
   * Voltage to use for Amps calculation (V = W / A).
   * @default 230  (European standard, also common in India)
   */
  voltageV?: number;

  /**
   * Time-of-Use windows. Only applies when `algorithm === "TIME_OF_USE"`.
   */
  timeOfUseWindows?: TimeOfUseWindow[];

  /**
   * The dispatcher function — the ONLY integration point with your OCPP library.
   * The engine calls this once per session whenever `dispatch()` is triggered.
   *
   * If the dispatcher throws (e.g., charger rejected SetChargingProfile),
   * the engine catches it, emits a 'dispatchError' event, and continues
   * dispatching to all remaining sessions.
   */
  dispatcher: ChargingProfileDispatcher;

  /**
   * Optional clear dispatcher — called by `clearDispatch()` or `removeSession()`
   * (when `autoClearOnRemove` is true) to send `ClearChargingProfile` to the charger.
   *
   * If not provided, `clearDispatch()` / `autoClearOnRemove` are no-ops.
   */
  clearDispatcher?: ClearProfileDispatcher;

  /**
   * If `true` AND `clearDispatcher` is provided, automatically calls
   * `ClearChargingProfile` on the charger when `removeSession()` is called.
   * @default false
   */
  autoClearOnRemove?: boolean;

  /**
   * Enable verbose console debug logging.
   * @default false
   */
  debug?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

/** Events emitted by the engine (compatible with Node.js EventEmitter) */
export interface SmartChargingEngineEvents {
  /** Fired after a session is registered. */
  sessionAdded: (session: ActiveSession) => void;
  /** Fired after a session is removed. */
  sessionRemoved: (session: ActiveSession) => void;
  /** Fired after `optimize()` completes — includes the calculated profiles. */
  optimized: (profiles: SessionProfile[]) => void;
  /** Fired after `dispatch()` completes for ALL sessions. */
  dispatched: (profiles: SessionProfile[]) => void;
  /** Fired when a single dispatcher call throws. Engine continues to other sessions. */
  dispatchError: (error: DispatchErrorEvent) => void;
  /** Fired after `clearDispatch()` completes for a session. */
  cleared: (payload: ClearDispatchPayload) => void;
  /** Fired when a clearDispatcher call throws. */
  clearError: (payload: ClearDispatchPayload & { error: unknown }) => void;
  /** Fired when `startAutoDispatch()` begins. */
  autoDispatchStarted: (intervalMs: number) => void;
  /** Fired when `stopAutoDispatch()` stops the interval. */
  autoDispatchStopped: () => void;
  /** General engine errors (e.g., strategy threw an exception). */
  error: (error: Error) => void;
}

/** Payload for the 'dispatchError' event */
export interface DispatchErrorEvent {
  clientId: string;
  transactionId: number | string;
  error: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy function signature
// ─────────────────────────────────────────────────────────────────────────────

/** The signature all strategy implementations must conform to. */
export type StrategyFn = (
  sessions: ActiveSession[],
  effectiveGridLimitKw: number,
) => SessionProfile[];
