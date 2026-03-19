/**
 * ocpp-smart-charge-engine — Public API
 *
 * Library-agnostic OCPP Smart Charging constraint solver.
 * Works with ocpp-ws-io, raw WebSocket, or any OCPP implementation.
 */

// Core engine
export { SmartChargingEngine } from "./engine.js";

// Strategy constants for type-safe algorithm selection
export const Strategies = {
  EQUAL_SHARE: "EQUAL_SHARE",
  PRIORITY: "PRIORITY",
  TIME_OF_USE: "TIME_OF_USE",
} as const;

// Errors
export {
  SmartChargingConfigError,
  DuplicateSessionError,
  SessionNotFoundError,
  StrategyError,
} from "./errors.js";

// Types — engine, session, dispatcher, and strategies
export type {
  // Engine
  SmartChargingEngineConfig,
  SmartChargingEngineEvents,
  Strategy,
  // Session
  ChargingSession,
  ActiveSession,
  // Dispatch
  ChargingProfileDispatcher,
  DispatchPayload,
  DispatchErrorEvent,
  // Clear profile
  ClearProfileDispatcher,
  ClearDispatchPayload,
  // Calculation result (raw kW / W / A)
  SessionProfile,
  // Time-of-Use
  TimeOfUseWindow,
  // Strategy internals (for custom strategies)
  StrategyFn,
} from "./types.js";

// OCPP version-specific ChargingProfile types & builders are in 'ocpp-smart-charge-engine/builders'
// import { buildOcpp16Profile, buildOcpp201Profile, buildOcpp21Profile } from 'ocpp-smart-charge-engine/builders'
