import { EventEmitter } from "node:events";
import type {
  SmartChargingEngineConfig,
  SmartChargingEngineEvents,
  ChargingSession,
  ActiveSession,
  SessionProfile,
  Strategy,
  StrategyFn,
  DispatchPayload,
  ClearDispatchPayload,
} from "./types.js";
import {
  SmartChargingConfigError,
  DuplicateSessionError,
  SessionNotFoundError,
  StrategyError,
} from "./errors.js";
import { equalShareStrategy } from "./strategies/equal-share.js";
import { priorityStrategy } from "./strategies/priority.js";
import { createTimeOfUseStrategy } from "./strategies/time-of-use.js";

// ─────────────────────────────────────────────────────────────────────────────
// Typed EventEmitter shim
// ─────────────────────────────────────────────────────────────────────────────

declare interface SmartChargingEngine {
  on<K extends keyof SmartChargingEngineEvents>(
    event: K,
    listener: SmartChargingEngineEvents[K],
  ): this;
  off<K extends keyof SmartChargingEngineEvents>(
    event: K,
    listener: SmartChargingEngineEvents[K],
  ): this;
  once<K extends keyof SmartChargingEngineEvents>(
    event: K,
    listener: SmartChargingEngineEvents[K],
  ): this;
  emit<K extends keyof SmartChargingEngineEvents>(
    event: K,
    ...args: Parameters<SmartChargingEngineEvents[K]>
  ): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartChargingEngine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Library-agnostic OCPP Smart Charging constraint solver.
 *
 * The engine calculates optimal charging profiles for connected EVs and
 * invokes a user-supplied `dispatcher` callback. The dispatcher is
 * responsible for actually sending the `SetChargingProfile` command via
 * whatever OCPP library you are using (ocpp-ws-io, raw ws, etc).
 *
 * @example
 * ```typescript
 * import { SmartChargingEngine, Strategies } from 'ocpp-smart-charge-engine';
 * import { buildOcpp16Profile } from 'ocpp-smart-charge-engine/builders';
 *
 * const engine = new SmartChargingEngine({
 *   siteId: 'SITE-001',
 *   maxGridPowerKw: 100,
 *   algorithm: Strategies.EQUAL_SHARE,
 *   // dispatcher receives raw numbers — you pick the OCPP version
 *   dispatcher: async ({ clientId, connectorId, sessionProfile }) => {
 *     await server.safeSendToClient(clientId, 'ocpp1.6', 'SetChargingProfile', {
 *       connectorId,
 *       csChargingProfiles: buildOcpp16Profile(sessionProfile),
 *     });
 *   },
 *   // optional: send ClearChargingProfile when sessions end
 *   clearDispatcher: async ({ clientId, connectorId }) => {
 *     await server.safeSendToClient(clientId, 'ocpp1.6', 'ClearChargingProfile', {
 *       connectorId,
 *       chargingProfilePurpose: 'TxProfile',
 *       stackLevel: 0,
 *     });
 *   },
 *   autoClearOnRemove: true,
 * });
 * ```
 */
class SmartChargingEngine extends EventEmitter {
  private readonly siteId: string;
  private gridLimitKw: number;
  private safetyMarginPct: number;
  private readonly voltageV: number;
  private algorithm: Strategy;
  private strategyFn: StrategyFn;
  private readonly phases: 1 | 3;
  private readonly dispatcher: SmartChargingEngineConfig["dispatcher"];
  private readonly clearDispatcher: SmartChargingEngineConfig["clearDispatcher"];
  private readonly autoClearOnRemove: boolean;
  private readonly debug: boolean;
  private autoDispatchTimer: ReturnType<typeof setInterval> | null = null;

  /** Internal session map keyed by transactionId (as string) */
  private readonly sessions = new Map<string, ActiveSession>();

  /** Auto-incrementing profile ID counter */
  private profileIdCounter = 1;

  constructor(config: SmartChargingEngineConfig) {
    super();

    // ── Validation ─────────────────────────────────────────────────────────
    if (config.maxGridPowerKw <= 0) {
      throw new SmartChargingConfigError(
        `maxGridPowerKw must be > 0, got ${config.maxGridPowerKw}`,
      );
    }
    const safetyMarginPct = config.safetyMarginPct ?? 5;
    if (safetyMarginPct < 0 || safetyMarginPct >= 100) {
      throw new SmartChargingConfigError(
        `safetyMarginPct must be between 0 and 99, got ${safetyMarginPct}`,
      );
    }

    // ── Store config ────────────────────────────────────────────────────────
    this.siteId = config.siteId;
    this.gridLimitKw = config.maxGridPowerKw;
    this.safetyMarginPct = safetyMarginPct;
    this.voltageV = config.voltageV ?? 230;
    this.phases = config.phases ?? 3;
    this.algorithm = config.algorithm ?? "EQUAL_SHARE";
    this.dispatcher = config.dispatcher;
    this.clearDispatcher = config.clearDispatcher;
    this.autoClearOnRemove = config.autoClearOnRemove ?? false;
    this.debug = config.debug ?? false;

    // ── Strategy ────────────────────────────────────────────────────────────
    this.strategyFn = this.resolveStrategy(this.algorithm, config);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Session Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register a new active charging session with the engine.
   *
   * Call this from your OCPP `StartTransaction` (1.6) or
   * `TransactionEvent(Started)` (2.0.1) handler.
   *
   * @throws {DuplicateSessionError} if a session with the same transactionId is already registered.
   */
  addSession(session: ChargingSession): ActiveSession {
    const key = String(session.transactionId);

    if (this.sessions.has(key)) {
      throw new DuplicateSessionError(session.transactionId);
    }

    const active: ActiveSession = {
      ...session,
      connectorId: session.connectorId ?? 1,
      priority: session.priority ?? 1,
      phases: session.phases ?? this.phases,
      addedAt: Date.now(),
    };

    this.sessions.set(key, active);
    this.log(`[${this.siteId}] Session added: ${key} (client: ${session.clientId})`);
    this.emit("sessionAdded", active);
    return active;
  }

  /**
   * Remove a charging session — call this from `StopTransaction` (1.6) or
   * `TransactionEvent(Ended)` (2.0.1).
   *
   * If `autoClearOnRemove: true` AND `clearDispatcher` is configured,
   * automatically sends `ClearChargingProfile` to the charger (fire-and-forget).
   *
   * @throws {SessionNotFoundError} if the transactionId is not registered.
   */
  removeSession(transactionId: number | string): ActiveSession {
    const key = String(transactionId);
    const session = this.sessions.get(key);

    if (!session) {
      throw new SessionNotFoundError(transactionId);
    }

    this.sessions.delete(key);
    this.log(`[${this.siteId}] Session removed: ${key}`);
    this.emit("sessionRemoved", session);

    // Auto-clear profile from charger if configured
    if (this.autoClearOnRemove && this.clearDispatcher) {
      const clearPayload: ClearDispatchPayload = {
        clientId: session.clientId,
        connectorId: session.connectorId,
        transactionId: session.transactionId,
      };
      this.clearDispatcher(clearPayload)
        .then(() => this.emit("cleared", clearPayload))
        .catch((err: unknown) =>
          this.emit("clearError", { ...clearPayload, error: err }),
        );
    }

    return session;
  }

  /**
   * A safe variant of `removeSession` — returns `undefined` instead of
   * throwing when the session is not found. Useful in cleanup code where
   * you don't want to deal with the exception.
   */
  safeRemoveSession(transactionId: number | string): ActiveSession | undefined {
    try {
      return this.removeSession(transactionId);
    } catch {
      return undefined;
    }
  }

  /**
   * Read-only snapshot of all currently active sessions.
   */
  getSessions(): ReadonlyArray<ActiveSession> {
    return Array.from(this.sessions.values());
  }

  /**
   * Returns `true` if there are no active sessions.
   */
  isEmpty(): boolean {
    return this.sessions.size === 0;
  }

  /**
   * Returns the number of active sessions.
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Optimization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Run the current strategy algorithm and return the calculated profiles.
   * Does NOT call the dispatcher — only calculates.
   * Useful for inspecting the distribution before committing.
   *
   * Emits the `'optimized'` event with the resulting profiles.
   */
  optimize(): SessionProfile[] {
    const sessions = Array.from(this.sessions.values());

    if (sessions.length === 0) {
      this.emit("optimized", []);
      return [];
    }

    const effectiveGridLimitKw =
      this.gridLimitKw * (1 - this.safetyMarginPct / 100);

    let profiles: SessionProfile[];
    try {
      profiles = this.strategyFn(sessions, effectiveGridLimitKw);
    } catch (err) {
      const error = new StrategyError(
        this.algorithm,
        err instanceof Error ? err.message : String(err),
      );
      this.emit("error", error);
      throw error;
    }

    this.log(
      `[${this.siteId}] Optimized ${profiles.length} sessions. ` +
        `Grid: ${this.gridLimitKw}kW, effective: ${effectiveGridLimitKw.toFixed(2)}kW`,
    );

    this.emit("optimized", profiles);
    return profiles;
  }

  /**
   * Calculate profiles AND invoke the dispatcher for each session.
   *
   * Each dispatcher call is isolated — if one throws (e.g., a charger
   * doesn't support SmartCharging), the error is caught, the `'dispatchError'`
   * event is emitted, and dispatching continues for all remaining sessions.
   *
   * Emits `'dispatched'` with all profiles when all dispatches complete.
   *
   * @returns The array of SessionProfiles that were dispatched.
   */
  async dispatch(): Promise<SessionProfile[]> {
    const profiles = this.optimize();
    if (profiles.length === 0) return profiles;

    const dispatchResults = await Promise.allSettled(
      profiles.map((profile) => {
        const payload: DispatchPayload = {
          clientId: profile.clientId,
          transactionId: profile.transactionId,
          connectorId: profile.connectorId,
          sessionProfile: profile,
        };
        return this.dispatcher(payload);
      }),
    );

    // Handle errors per session — do NOT throw
    dispatchResults.forEach((result, i) => {
      if (result.status === "rejected") {
        const profile = profiles[i]!;
        this.log(
          `[${this.siteId}] Dispatcher error for client ${profile.clientId}: ${result.reason}`,
        );
        this.emit("dispatchError", {
          clientId: profile.clientId,
          transactionId: profile.transactionId,
          error: result.reason,
        });
      }
    });

    this.emit("dispatched", profiles);
    return profiles;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ClearChargingProfile
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Explicitly send `ClearChargingProfile` to one or all active sessions.
   *
   * Requires `clearDispatcher` to be configured. If not set, this is a no-op.
   * Each clear call is isolated — errors are emitted as `'clearError'` events.
   *
   * @param transactionId - Clears only that session. If omitted, clears ALL sessions.
   */
  async clearDispatch(transactionId?: number | string): Promise<void> {
    if (!this.clearDispatcher) {
      this.log(`[${this.siteId}] clearDispatch called but no clearDispatcher configured. Skipping.`);
      return;
    }

    const targets: ActiveSession[] = transactionId
      ? [this.sessions.get(String(transactionId))].filter(
          (s): s is ActiveSession => s !== undefined,
        )
      : Array.from(this.sessions.values());

    await Promise.allSettled(
      targets.map(async (session) => {
        const payload: ClearDispatchPayload = {
          clientId: session.clientId,
          connectorId: session.connectorId,
          transactionId: session.transactionId,
        };
        try {
          await this.clearDispatcher!(payload);
          this.emit("cleared", payload);
        } catch (err) {
          this.log(`[${this.siteId}] clearDispatcher error for ${session.clientId}: ${err}`);
          this.emit("clearError", { ...payload, error: err });
        }
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-dispatch
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start automatic periodic dispatch.
   * The engine will call `dispatch()` every `intervalMs` milliseconds.
   * Stops any previously running interval before starting a new one.
   *
   * @param intervalMs - Dispatch interval in ms. Minimum 1000ms.
   * @example engine.startAutoDispatch(60_000); // recalculate every 60 seconds
   */
  startAutoDispatch(intervalMs: number): void {
    if (intervalMs < 1000) {
      throw new SmartChargingConfigError(
        `startAutoDispatch intervalMs must be >= 1000ms, got ${intervalMs}`,
      );
    }
    this.stopAutoDispatch(); // cancel any existing
    this.autoDispatchTimer = setInterval(() => {
      if (this.sessions.size > 0) {
        this.dispatch().catch((err: unknown) => {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        });
      }
    }, intervalMs);
    this.log(`[${this.siteId}] Auto-dispatch started every ${intervalMs}ms`);
    this.emit("autoDispatchStarted", intervalMs);
  }

  /**
   * Stop the automatic periodic dispatch interval.
   * Safe to call even if auto-dispatch was never started.
   */
  stopAutoDispatch(): void {
    if (this.autoDispatchTimer !== null) {
      clearInterval(this.autoDispatchTimer);
      this.autoDispatchTimer = null;
      this.log(`[${this.siteId}] Auto-dispatch stopped`);
      this.emit("autoDispatchStopped");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Runtime configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Change the allocation strategy at runtime.
   * Takes effect on the next `optimize()` / `dispatch()` call.
   */
  setAlgorithm(algorithm: Strategy, config?: SmartChargingEngineConfig): void {
    this.algorithm = algorithm;
    this.strategyFn = this.resolveStrategy(algorithm, config);
    this.log(`[${this.siteId}] Algorithm changed to: ${algorithm}`);
  }

  /**
   * Update the site's maximum grid power limit.
   * Useful for dynamic grid constraints (e.g., utility demand response signals).
   * Takes effect on the next `optimize()` / `dispatch()` call.
   */
  setGridLimit(maxGridPowerKw: number): void {
    if (maxGridPowerKw <= 0) {
      throw new SmartChargingConfigError(
        `maxGridPowerKw must be > 0, got ${maxGridPowerKw}`,
      );
    }
    this.gridLimitKw = maxGridPowerKw;
    this.log(`[${this.siteId}] Grid limit updated to: ${maxGridPowerKw} kW`);
  }

  /**
   * Update the safety margin percentage.
   * Takes effect on the next `optimize()` / `dispatch()` call.
   */
  setSafetyMargin(pct: number): void {
    if (pct < 0 || pct >= 100) {
      throw new SmartChargingConfigError(
        `safetyMarginPct must be between 0 and 99, got ${pct}`,
      );
    }
    this.safetyMarginPct = pct;
  }

  /**
   * Current configuration snapshot (read-only).
   */
  get config(): {
    siteId: string;
    gridLimitKw: number;
    safetyMarginPct: number;
    algorithm: Strategy;
    phases: 1 | 3;
    voltageV: number;
    effectiveGridLimitKw: number;
    autoDispatchActive: boolean;
  } {
    return {
      siteId: this.siteId,
      gridLimitKw: this.gridLimitKw,
      safetyMarginPct: this.safetyMarginPct,
      algorithm: this.algorithm,
      phases: this.phases,
      voltageV: this.voltageV,
      effectiveGridLimitKw: this.gridLimitKw * (1 - this.safetyMarginPct / 100),
      autoDispatchActive: this.autoDispatchTimer !== null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private resolveStrategy(
    algorithm: Strategy,
    config?: Partial<SmartChargingEngineConfig>,
  ): StrategyFn {
    switch (algorithm) {
      case "EQUAL_SHARE":
        return equalShareStrategy;
      case "PRIORITY":
        return priorityStrategy;
      case "TIME_OF_USE": {
        const windows = config?.timeOfUseWindows;
        if (!windows || windows.length === 0) {
          throw new SmartChargingConfigError(
            'algorithm "TIME_OF_USE" requires at least one entry in timeOfUseWindows.',
          );
        }
        return createTimeOfUseStrategy(windows);
      }
      default:
        throw new SmartChargingConfigError(
          `Unknown algorithm "${algorithm as string}". Valid: EQUAL_SHARE, PRIORITY, TIME_OF_USE`,
        );
    }
  }

  private log(msg: string): void {
    if (this.debug) {
      console.debug(msg);
    }
  }
}

export { SmartChargingEngine };
