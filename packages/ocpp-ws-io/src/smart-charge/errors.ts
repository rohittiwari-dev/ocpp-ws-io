/** Thrown when the engine is configured incorrectly. */
export class SmartChargingConfigError extends Error {
  readonly code = "SMART_CHARGING_CONFIG_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "SmartChargingConfigError";
  }
}

/** Thrown when a session with the given transactionId does not exist. */
export class SessionNotFoundError extends Error {
  readonly code = "SESSION_NOT_FOUND";
  readonly transactionId: number | string;
  constructor(transactionId: number | string) {
    super(`Session with transactionId "${transactionId}" not found.`);
    this.name = "SessionNotFoundError";
    this.transactionId = transactionId;
  }
}

/** Thrown when a session with the same transactionId is already registered. */
export class DuplicateSessionError extends Error {
  readonly code = "DUPLICATE_SESSION";
  readonly transactionId: number | string;
  constructor(transactionId: number | string) {
    super(
      `Session with transactionId "${transactionId}" is already registered. ` +
        "Call removeSession() first or use a unique transactionId.",
    );
    this.name = "DuplicateSessionError";
    this.transactionId = transactionId;
  }
}

/** Thrown when a strategy function returns an invalid result. */
export class StrategyError extends Error {
  readonly code = "STRATEGY_ERROR";
  readonly strategyName: string;
  constructor(strategyName: string, message: string) {
    super(`Strategy "${strategyName}" error: ${message}`);
    this.name = "StrategyError";
    this.strategyName = strategyName;
  }
}
