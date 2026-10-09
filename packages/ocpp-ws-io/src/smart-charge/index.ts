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
  DuplicateSessionError,
  SessionNotFoundError,
  SmartChargingConfigError,
  StrategyError,
} from "./errors.js";

// Types — engine, session, dispatcher, and strategies
export type {
  ActiveSession,
  // Dispatch
  ChargingProfileDispatcher,
  // Session
  ChargingSession,
  ClearDispatchPayload,
  // Clear profile
  ClearProfileDispatcher,
  DispatchErrorEvent,
  DispatchPayload,
  // Grid budget
  GridOverCommitInfo,
  // Calculation result (raw kW / W / A)
  SessionProfile,
  SessionUpdate,
  // Engine
  SmartChargingEngineConfig,
  SmartChargingEngineEvents,
  StarvedSession,
  Strategy,
  StrategyContext,
  // Strategy internals (for custom strategies)
  StrategyFn,
  // Time-of-Use
  TimeOfUseWindow,
} from "./types.js";

// OCPP version-specific ChargingProfile types & builders are in 'ocpp-smart-charge-engine/builders'
// import { buildOcpp16Profile, buildOcpp201Profile, buildOcpp21Profile } from 'ocpp-smart-charge-engine/builders'
