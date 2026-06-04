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
  TimeOfUseWindow,
  SessionUpdate,
  StarvedSession,
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
  /** Label for the active strategy ("CUSTOM" when a user function is supplied). */
  private algorithm: Strategy | "CUSTOM";
  private strategyFn: StrategyFn;
  private readonly phases: 1 | 2 | 3;
  private readonly dispatcher: SmartChargingEngineConfig["dispatcher"];
  private readonly clearDispatcher: SmartChargingEngineConfig["clearDispatcher"];
  private readonly autoClearOnRemove: boolean;
  private readonly debug: boolean;
  private autoDispatchTimer: ReturnType<typeof setInterval> | null = null;

  /** Time-of-Use windows retained so the strategy can be hot-swapped at runtime. */
  private timeOfUseWindows: TimeOfUseWindow[] | undefined;
  /** Timezone used to evaluate Time-of-Use windows (host local time if unset). */
  private timeOfUseTimezone: string | undefined;
  /** In-flight dispatch promise — coalesces overlapping dispatch() calls. */
  private dispatchInFlight: Promise<SessionProfile[]> | null = null;

  /** Internal session map keyed by transactionId (as string) */
  private readonly sessions = new Map<string, ActiveSession>();

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
    const voltageV = config.voltageV ?? 230;
    if (voltageV <= 0) {
      throw new SmartChargingConfigError(
        `voltageV must be > 0, got ${voltageV}`,
      );
    }
    const phases = config.phases ?? 3;
    if (phases !== 1 && phases !== 2 && phases !== 3) {
      throw new SmartChargingConfigError(
        `phases must be 1, 2, or 3, got ${phases}`,
      );
    }

    // ── Store config ────────────────────────────────────────────────────────
    this.siteId = config.siteId;
    this.gridLimitKw = config.maxGridPowerKw;
    this.safetyMarginPct = safetyMarginPct;
    this.voltageV = voltageV;
    this.phases = phases;
    const algorithm = config.algorithm ?? "EQUAL_SHARE";
    this.algorithm = typeof algorithm === "function" ? "CUSTOM" : algorithm;
    this.timeOfUseWindows = config.timeOfUseWindows;
    this.timeOfUseTimezone = config.timeOfUseTimezone;
    this.dispatcher = config.dispatcher;
    this.clearDispatcher = config.clearDispatcher;
    this.autoClearOnRemove = config.autoClearOnRemove ?? false;
    this.debug = config.debug ?? false;

    // ── Strategy ────────────────────────────────────────────────────────────
    this.strategyFn = this.resolveStrategy(algorithm, config);
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

    this.validateSession(session);

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
   * Update a session's parameters **in place** — e.g. when the EV reports a new
   * acceptance limit, or you want to change its priority mid-charge.
   *
   * Unlike `removeSession()` + `addSession()`, this preserves `addedAt` and does
   * NOT trigger `autoClearOnRemove`, so no spurious `ClearChargingProfile` is
   * sent. `transactionId` and `clientId` are immutable and cannot be changed.
   * The merged result is validated; takes effect on the next `optimize()`/`dispatch()`.
   *
   * @throws {SessionNotFoundError} if the transactionId is not registered.
   * @throws {SmartChargingConfigError} if the patched values are invalid.
   */
  updateSession(
    transactionId: number | string,
    patch: SessionUpdate,
  ): ActiveSession {
    const key = String(transactionId);
    const existing = this.sessions.get(key);
    if (!existing) {
      throw new SessionNotFoundError(transactionId);
    }

    const merged: ActiveSession = {
      ...existing,
      ...patch,
      // Identity & bookkeeping are immutable.
      transactionId: existing.transactionId,
      clientId: existing.clientId,
      connectorId: patch.connectorId ?? existing.connectorId,
      priority: patch.priority ?? existing.priority,
      phases: patch.phases ?? existing.phases,
      addedAt: existing.addedAt,
    };

    this.validateSession(merged);
    this.sessions.set(key, merged);
    this.log(`[${this.siteId}] Session updated: ${key}`);
    this.emit("sessionUpdated", merged);
    return { ...merged };
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
   * Returns shallow copies — mutating them does NOT affect engine state.
   */
  getSessions(): ReadonlyArray<ActiveSession> {
    return Array.from(this.sessions.values(), (s) => ({ ...s }));
  }

  /**
   * Read-only snapshot of a single session by transactionId, or `undefined`.
   * Returns a shallow copy — mutating it does NOT affect engine state.
   */
  getSession(transactionId: number | string): ActiveSession | undefined {
    const s = this.sessions.get(String(transactionId));
    return s ? { ...s } : undefined;
  }

  /**
   * Serializable snapshot of all active sessions — safe to `JSON.stringify` and
   * persist (e.g. to Redis/DB), then restore with `loadSnapshot()` after a
   * process restart. Returns shallow copies including `addedAt`.
   */
  getSnapshot(): ActiveSession[] {
    return Array.from(this.sessions.values(), (s) => ({ ...s }));
  }

  /**
   * Restore sessions from a previously-saved `getSnapshot()` (or any list of
   * `ChargingSession`s). Every entry is validated up front, so a single bad
   * entry throws **before** any change is applied (atomic).
   *
   * @param sessions Sessions to load. `addedAt` is preserved when present.
   * @param opts.clear Replace all existing sessions (default `true`). When
   *   `false`, the snapshot is merged in (entries with an existing
   *   transactionId are overwritten).
   * @throws {SmartChargingConfigError} if any entry has invalid numeric fields.
   */
  loadSnapshot(
    sessions: ReadonlyArray<ChargingSession & { addedAt?: number }>,
    opts: { clear?: boolean } = {},
  ): void {
    // Validate everything first — never partially apply a bad snapshot.
    for (const s of sessions) {
      this.validateSession(s);
    }

    if (opts.clear ?? true) {
      this.sessions.clear();
    }

    for (const s of sessions) {
      const key = String(s.transactionId);
      this.sessions.set(key, {
        ...s,
        connectorId: s.connectorId ?? 1,
        priority: s.priority ?? 1,
        phases: s.phases ?? this.phases,
        addedAt: s.addedAt ?? Date.now(),
      });
    }

    this.log(
      `[${this.siteId}] Snapshot loaded: ${sessions.length} session(s) ` +
        `(clear: ${opts.clear ?? true})`,
    );
    this.emit("snapshotLoaded", this.getSessions());
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
      profiles = this.strategyFn(sessions, effectiveGridLimitKw, {
        voltageV: this.voltageV,
      });
    } catch (err) {
      const error = new StrategyError(
        this.algorithm,
        err instanceof Error ? err.message : String(err),
      );
      this.emit("error", error);
      throw error;
    }

    // ── Grid-budget guard ────────────────────────────────────────────────────
    // Strategies cap each session to its share, but per-session minimum-rate
    // floors can push the SUM above the grid limit. This final pass guarantees
    // the hard invariant: total allocated power never exceeds the grid.
    profiles = this.enforceGridBudget(profiles, effectiveGridLimitKw);

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
    // Re-entrancy guard: if a dispatch is already running (e.g. a slow dispatcher
    // while auto-dispatch ticks again, or a concurrent manual call), coalesce
    // onto the in-flight run instead of sending overlapping/out-of-order profiles.
    if (this.dispatchInFlight) return this.dispatchInFlight;
    this.dispatchInFlight = this._runDispatch().finally(() => {
      this.dispatchInFlight = null;
    });
    return this.dispatchInFlight;
  }

  private async _runDispatch(): Promise<SessionProfile[]> {
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
    // Don't keep the Node process alive solely for the dispatch interval.
    (this.autoDispatchTimer as { unref?: () => void }).unref?.();
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
   * Change the allocation strategy at runtime — a built-in `Strategy` name or a
   * custom `StrategyFn`. Takes effect on the next `optimize()` / `dispatch()`.
   */
  setAlgorithm(
    algorithm: Strategy | StrategyFn,
    config?: Partial<SmartChargingEngineConfig>,
  ): void {
    this.algorithm = typeof algorithm === "function" ? "CUSTOM" : algorithm;
    this.strategyFn = this.resolveStrategy(algorithm, config);
    this.log(`[${this.siteId}] Algorithm changed to: ${this.algorithm}`);
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
    algorithm: Strategy | "CUSTOM";
    phases: 1 | 2 | 3;
    voltageV: number;
    effectiveGridLimitKw: number;
    autoDispatchActive: boolean;
    timeOfUseWindows: TimeOfUseWindow[] | undefined;
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
      timeOfUseWindows: this.timeOfUseWindows
        ? this.timeOfUseWindows.map((w) => ({ ...w }))
        : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Guarantee that the sum of allocated power never exceeds the grid limit.
   *
   * Strategies already cap each session to its fair share, but per-session
   * `minChargeRateKw` floors are applied independently and can push the total
   * over budget. This pass scales the allocations back down to fit:
   *
   *  - If the sum of the minimum floors still fits the grid, only the
   *    above-floor portion is reduced (proportionally) so every session keeps
   *    at least its guaranteed minimum.
   *  - If even the floors alone exceed the grid (over-subscribed site), grid
   *    safety wins: everything is scaled down proportionally and a
   *    `gridOverCommitted` event with `feasible: false` is emitted.
   */
  private enforceGridBudget(
    profiles: SessionProfile[],
    effectiveGridLimitKw: number,
  ): SessionProfile[] {
    const EPS = 1e-9;
    const total = profiles.reduce((s, p) => s + p.allocatedKw, 0);
    if (total <= effectiveGridLimitKw + EPS) return profiles;

    const floorSum = profiles.reduce((s, p) => s + p.minChargeRateKw, 0);
    const feasible = floorSum <= effectiveGridLimitKw + EPS;

    let result: SessionProfile[];
    if (feasible) {
      // Reduce only the discretionary (above-floor) power, keeping every floor.
      const aboveFloorTotal = total - floorSum;
      const excess = total - effectiveGridLimitKw;
      const scale =
        aboveFloorTotal > EPS ? (aboveFloorTotal - excess) / aboveFloorTotal : 0;
      result = profiles.map((p) => {
        const above = Math.max(0, p.allocatedKw - p.minChargeRateKw);
        return this.rebuildProfileKw(p, p.minChargeRateKw + above * scale);
      });
    } else {
      // Infeasible — floors alone exceed the grid. Scale everything proportionally.
      const scale = effectiveGridLimitKw / total;
      result = profiles.map((p) => this.rebuildProfileKw(p, p.allocatedKw * scale));
    }

    // Per-session starvation detail (only the infeasible branch can starve floors).
    const starvedSessions: StarvedSession[] = result
      .filter((p) => p.allocatedKw < p.minChargeRateKw - EPS)
      .map((p) => ({
        clientId: p.clientId,
        transactionId: p.transactionId,
        connectorId: p.connectorId,
        minChargeRateKw: p.minChargeRateKw,
        allocatedKw: p.allocatedKw,
      }));

    this.emit("gridOverCommitted", {
      siteId: this.siteId,
      effectiveGridLimitKw,
      requestedKw: parseFloat(total.toFixed(2)),
      sessionCount: profiles.length,
      feasible,
      starvedSessions,
    });
    this.log(
      `[${this.siteId}] Grid over-committed: requested ${total.toFixed(2)}kW > ` +
        `${effectiveGridLimitKw.toFixed(2)}kW (feasible: ${feasible}, ` +
        `starved: ${starvedSessions.length}). Scaling down.`,
    );

    return result;
  }

  /**
   * Recompute a profile's W and amps from an adjusted kW value, rounding DOWN
   * to 2 decimals so the grid invariant is never broken by rounding.
   */
  private rebuildProfileKw(
    profile: SessionProfile,
    newKw: number,
  ): SessionProfile {
    const floor2 = (n: number) => Math.floor(Math.max(0, n) * 100) / 100;
    const kw = floor2(newKw);
    const watts = floor2(kw * 1000);
    const ampsPerPhase = floor2(watts / (profile.voltageV * profile.phases));
    return {
      ...profile,
      allocatedKw: kw,
      allocatedW: watts,
      allocatedAmpsPerPhase: ampsPerPhase,
    };
  }

  private resolveStrategy(
    algorithm: Strategy | StrategyFn,
    config?: Partial<SmartChargingEngineConfig>,
  ): StrategyFn {
    // Custom user-supplied strategy function — use it as-is.
    if (typeof algorithm === "function") {
      return algorithm;
    }
    switch (algorithm) {
      case "EQUAL_SHARE":
        return equalShareStrategy;
      case "PRIORITY":
        return priorityStrategy;
      case "TIME_OF_USE": {
        // Prefer windows passed to this call, else fall back to the windows the
        // engine was constructed with — so setAlgorithm("TIME_OF_USE") works.
        const windows = config?.timeOfUseWindows ?? this.timeOfUseWindows;
        if (!windows || windows.length === 0) {
          throw new SmartChargingConfigError(
            'algorithm "TIME_OF_USE" requires at least one entry in timeOfUseWindows.',
          );
        }
        this.validateTimeOfUseWindows(windows);
        // Retain for any later runtime swaps.
        this.timeOfUseWindows = windows;
        if (config?.timeOfUseTimezone !== undefined) {
          this.timeOfUseTimezone = config.timeOfUseTimezone;
        }
        return createTimeOfUseStrategy(windows, this.timeOfUseTimezone);
      }
      default:
        throw new SmartChargingConfigError(
          `Unknown algorithm "${algorithm as string}". Valid: EQUAL_SHARE, PRIORITY, TIME_OF_USE`,
        );
    }
  }

  /**
   * Validate the numeric fields of a session before it enters the solver.
   * Rejects negative / NaN / non-finite values that would otherwise produce
   * negative or `NaN` power limits in the dispatched charging profile.
   */
  private validateSession(session: ChargingSession): void {
    // Upper caps: a positive finite number, or Infinity ("uncapped").
    const checkCap = (name: string, v: number | undefined): void => {
      if (v === undefined || v === Infinity) return;
      if (!Number.isFinite(v) || v <= 0) {
        throw new SmartChargingConfigError(
          `${name} must be a positive number or Infinity, got ${v}`,
        );
      }
    };
    checkCap("maxHardwarePowerKw", session.maxHardwarePowerKw);
    checkCap("maxEvAcceptancePowerKw", session.maxEvAcceptancePowerKw);

    // Non-negative finite numbers.
    const checkNonNeg = (name: string, v: number | undefined): void => {
      if (v === undefined) return;
      if (!Number.isFinite(v) || v < 0) {
        throw new SmartChargingConfigError(
          `${name} must be a non-negative finite number, got ${v}`,
        );
      }
    };
    checkNonNeg("minChargeRateKw", session.minChargeRateKw);
    checkNonNeg("priority", session.priority);

    if (
      session.connectorId !== undefined &&
      (!Number.isInteger(session.connectorId) || session.connectorId < 0)
    ) {
      throw new SmartChargingConfigError(
        `connectorId must be a non-negative integer, got ${session.connectorId}`,
      );
    }
    if (
      session.phases !== undefined &&
      session.phases !== 1 &&
      session.phases !== 2 &&
      session.phases !== 3
    ) {
      throw new SmartChargingConfigError(
        `phases must be 1, 2, or 3, got ${session.phases}`,
      );
    }
  }

  /** Validate Time-of-Use windows: hours in 0–23, multiplier in 0–1. */
  private validateTimeOfUseWindows(windows: TimeOfUseWindow[]): void {
    for (const w of windows) {
      const hoursOk = (h: number) => Number.isInteger(h) && h >= 0 && h <= 23;
      if (!hoursOk(w.peakStartHour) || !hoursOk(w.peakEndHour)) {
        throw new SmartChargingConfigError(
          `Time-of-Use window hours must be integers between 0 and 23, got ` +
            `start=${w.peakStartHour}, end=${w.peakEndHour}.`,
        );
      }
      if (
        !(w.peakPowerMultiplier >= 0 && w.peakPowerMultiplier <= 1) // also rejects NaN
      ) {
        throw new SmartChargingConfigError(
          `Time-of-Use peakPowerMultiplier must be between 0 and 1, got ` +
            `${w.peakPowerMultiplier}. Values > 1 would exceed the grid limit.`,
        );
      }
    }
  }

  private log(msg: string): void {
    if (this.debug) {
      console.debug(msg);
    }
  }
}

export { SmartChargingEngine };
