import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SmartChargingEngine,
  Strategies,
  DuplicateSessionError,
  SessionNotFoundError,
  SmartChargingConfigError,
  StrategyError,
} from "../src/index.js";
import type { ChargingProfileDispatcher, StrategyFn } from "../src/index.js";
import { buildSessionProfile } from "../src/strategies/utils.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeDispatcher(): ChargingProfileDispatcher {
  return vi.fn().mockResolvedValue(undefined);
}

function makeEngine(
  gridKw = 100,
  algorithm: "EQUAL_SHARE" | "PRIORITY" | "TIME_OF_USE" = "EQUAL_SHARE",
  dispatcher?: ChargingProfileDispatcher,
) {
  return new SmartChargingEngine({
    siteId: "TEST-SITE",
    maxGridPowerKw: gridKw,
    algorithm,
    safetyMarginPct: 0, // disable margin for predictable test math
    dispatcher: dispatcher ?? makeDispatcher(),
    timeOfUseWindows:
      algorithm === "TIME_OF_USE"
        ? [{ peakStartHour: 18, peakEndHour: 22, peakPowerMultiplier: 0.5 }]
        : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Config validation
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — Config", () => {
  it("throws SmartChargingConfigError if maxGridPowerKw <= 0", () => {
    expect(() =>
      new SmartChargingEngine({
        siteId: "X",
        maxGridPowerKw: 0,
        dispatcher: makeDispatcher(),
      }),
    ).toThrow(SmartChargingConfigError);
  });

  it("throws SmartChargingConfigError for invalid safetyMarginPct", () => {
    expect(() =>
      new SmartChargingEngine({
        siteId: "X",
        maxGridPowerKw: 100,
        safetyMarginPct: 110,
        dispatcher: makeDispatcher(),
      }),
    ).toThrow(SmartChargingConfigError);
  });

  it("exposes config snapshot via .config getter", () => {
    const engine = makeEngine(100);
    expect(engine.config.gridLimitKw).toBe(100);
    expect(engine.config.algorithm).toBe("EQUAL_SHARE");
    expect(engine.config.effectiveGridLimitKw).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session Management
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — Session Management", () => {
  it("adds a session and returns an ActiveSession", () => {
    const engine = makeEngine();
    const session = engine.addSession({ transactionId: 1, clientId: "CP-001" });
    expect(session.transactionId).toBe(1);
    expect(session.connectorId).toBe(1); // default
    expect(session.priority).toBe(1);    // default
    expect(session.phases).toBe(3);      // default
    expect(engine.sessionCount).toBe(1);
  });

  it("throws DuplicateSessionError on duplicate transactionId", () => {
    const engine = makeEngine();
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    expect(() =>
      engine.addSession({ transactionId: 1, clientId: "CP-002" }),
    ).toThrow(DuplicateSessionError);
  });

  it("removes a session correctly", () => {
    const engine = makeEngine();
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    engine.removeSession(1);
    expect(engine.sessionCount).toBe(0);
    expect(engine.isEmpty()).toBe(true);
  });

  it("throws SessionNotFoundError when removing unknown session", () => {
    const engine = makeEngine();
    expect(() => engine.removeSession(9999)).toThrow(SessionNotFoundError);
  });

  it("safeRemoveSession returns undefined for unknown session (no throw)", () => {
    const engine = makeEngine();
    const result = engine.safeRemoveSession(9999);
    expect(result).toBeUndefined();
  });

  it("emits sessionAdded and sessionRemoved events", () => {
    const engine = makeEngine();
    const added = vi.fn();
    const removed = vi.fn();
    engine.on("sessionAdded", added);
    engine.on("sessionRemoved", removed);

    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    expect(added).toHaveBeenCalledTimes(1);

    engine.removeSession(1);
    expect(removed).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EQUAL_SHARE strategy
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — EQUAL_SHARE", () => {
  it("returns empty array when no sessions", () => {
    const engine = makeEngine(100);
    const profiles = engine.optimize();
    expect(profiles).toHaveLength(0);
  });

  it("gives all power to a single session", () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    const [p] = engine.optimize();
    expect(p!.allocatedKw).toBe(100);
  });

  it("divides equally among 3 sessions", () => {
    const engine = makeEngine(99); // 99kW / 3 = 33kW each (clean number)
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    engine.addSession({ transactionId: 2, clientId: "CP-002" });
    engine.addSession({ transactionId: 3, clientId: "CP-003" });
    const profiles = engine.optimize();
    expect(profiles).toHaveLength(3);
    profiles.forEach((p) => expect(p.allocatedKw).toBe(33));
  });

  it("caps allocation to hardware limit", () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "CP-001", maxHardwarePowerKw: 20 });
    const [p] = engine.optimize();
    expect(p!.allocatedKw).toBe(20); // capped at hardware limit
  });

  it("caps allocation to EV acceptance limit", () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "CP-001", maxEvAcceptancePowerKw: 11 });
    const [p] = engine.optimize();
    expect(p!.allocatedKw).toBe(11);
  });

  it("applies safety margin", () => {
    const engine = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100,
      safetyMarginPct: 10, // 100 * 0.90 = 90kW effective
      dispatcher: makeDispatcher(),
    });
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    const [p] = engine.optimize();
    expect(p!.allocatedKw).toBe(90);
  });

  it("recalculates after a session is removed", () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    engine.addSession({ transactionId: 2, clientId: "CP-002" });
    engine.removeSession(2);
    const [p] = engine.optimize();
    expect(p!.allocatedKw).toBe(100); // now solo
  });

  it("emits 'optimized' event with profiles", () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    const listener = vi.fn();
    engine.on("optimized", listener);
    engine.optimize();
    expect(listener).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY strategy
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — PRIORITY", () => {
  it("allocates proportionally by priority", () => {
    const engine = makeEngine(100, "PRIORITY");
    engine.addSession({ transactionId: 1, clientId: "CP-001", priority: 8 });
    engine.addSession({ transactionId: 2, clientId: "CP-002", priority: 2 });
    const profiles = engine.optimize();

    const p1 = profiles.find((p) => p.clientId === "CP-001")!;
    const p2 = profiles.find((p) => p.clientId === "CP-002")!;

    expect(p1.allocatedKw).toBe(80); // 8/(8+2) * 100
    expect(p2.allocatedKw).toBe(20); // 2/(8+2) * 100
  });

  it("equal priority = equal share", () => {
    const engine = makeEngine(100, "PRIORITY");
    engine.addSession({ transactionId: 1, clientId: "CP-001", priority: 5 });
    engine.addSession({ transactionId: 2, clientId: "CP-002", priority: 5 });
    const [p1, p2] = engine.optimize();
    expect(p1!.allocatedKw).toBe(50);
    expect(p2!.allocatedKw).toBe(50);
  });

  it("total power never exceeds grid limit (with caps)", () => {
    const engine = makeEngine(100, "PRIORITY");
    engine.addSession({ transactionId: 1, clientId: "CP-001", priority: 9, maxHardwarePowerKw: 30 });
    engine.addSession({ transactionId: 2, clientId: "CP-002", priority: 1 });
    const profiles = engine.optimize();
    const total = profiles.reduce((s, p) => s + p.allocatedKw, 0);
    expect(total).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — dispatch()", () => {
  it("calls dispatcher once per session", async () => {
    const dispatcher = makeDispatcher();
    const engine = makeEngine(100, "EQUAL_SHARE", dispatcher);
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    engine.addSession({ transactionId: 2, clientId: "CP-002" });

    await engine.dispatch();
    expect(dispatcher).toHaveBeenCalledTimes(2);
  });

  it("passes sessionProfile with correct raw numbers in dispatch payload", async () => {
    const dispatcher = makeDispatcher();
    const engine = makeEngine(100, "EQUAL_SHARE", dispatcher);
    engine.addSession({ transactionId: 10, clientId: "CP-001" });

    await engine.dispatch();

    const [payload] = (dispatcher as ReturnType<typeof vi.fn>).mock.calls[0] as [import("../src/index.js").DispatchPayload];
    expect(payload.clientId).toBe("CP-001");
    expect(payload.connectorId).toBe(1);
    expect(payload.transactionId).toBe(10);
    // sessionProfile contains raw numbers — the user builds the OCPP profile in dispatcher
    expect(payload.sessionProfile.allocatedKw).toBe(100);
    expect(payload.sessionProfile.allocatedW).toBe(100_000);
    expect(payload.sessionProfile.allocatedAmpsPerPhase).toBeGreaterThan(0);
  });

  it("emits 'dispatched' when all calls succeed", async () => {
    const engine = makeEngine(100, "EQUAL_SHARE", makeDispatcher());
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    const listener = vi.fn();
    engine.on("dispatched", listener);
    await engine.dispatch();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("emits 'dispatchError' for failing dispatcher without crashing other sessions", async () => {
    let callCount = 0;
    const dispatcher: ChargingProfileDispatcher = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("ChargePoint rejected SetChargingProfile");
    });

    const engine = makeEngine(100, "EQUAL_SHARE", dispatcher);
    engine.addSession({ transactionId: 1, clientId: "CP-FAIL" });
    engine.addSession({ transactionId: 2, clientId: "CP-OK" });

    const errorListener = vi.fn();
    engine.on("dispatchError", errorListener);

    const profiles = await engine.dispatch();
    expect(profiles).toHaveLength(2);     // both returned
    expect(errorListener).toHaveBeenCalledOnce(); // one error emitted
    expect(errorListener.mock.calls[0]?.[0].clientId).toBe("CP-FAIL");
    expect(dispatcher).toHaveBeenCalledTimes(2);  // still tried both
  });

  it("returns empty array and does NOT call dispatcher when no sessions", async () => {
    const dispatcher = makeDispatcher();
    const engine = makeEngine(100, "EQUAL_SHARE", dispatcher);
    const result = await engine.dispatch();
    expect(result).toHaveLength(0);
    expect(dispatcher).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Runtime config changes
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — Runtime Config", () => {
  it("setGridLimit changes allocation immediately", () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    engine.setGridLimit(50);
    const [p] = engine.optimize();
    expect(p!.allocatedKw).toBe(50);
  });

  it("setAlgorithm swaps strategy at runtime", () => {
    const engine = makeEngine(100, "EQUAL_SHARE");
    engine.addSession({ transactionId: 1, clientId: "CP-001", priority: 8 });
    engine.addSession({ transactionId: 2, clientId: "CP-002", priority: 2 });

    // With EQUAL_SHARE both get 50
    let profiles = engine.optimize();
    expect(profiles[0]!.allocatedKw).toBe(50);

    // Switch to PRIORITY — now 80/20
    engine.setAlgorithm("PRIORITY");
    profiles = engine.optimize();
    const p1 = profiles.find((p) => p.clientId === "CP-001")!;
    expect(p1.allocatedKw).toBe(80);
  });

  it("setGridLimit throws on invalid value", () => {
    const engine = makeEngine(100);
    expect(() => engine.setGridLimit(0)).toThrow(SmartChargingConfigError);
    expect(() => engine.setGridLimit(-5)).toThrow(SmartChargingConfigError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// minChargeRateKw
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — minChargeRateKw", () => {
  it("allocates at least minChargeRateKw even if grid share would be lower", () => {
    // 3 sessions on 10kW grid = 3.33kW each, but session 1 has minChargeRateKw: 5
    const engine = makeEngine(10);
    engine.addSession({ transactionId: 1, clientId: "CP-001", minChargeRateKw: 5 });
    engine.addSession({ transactionId: 2, clientId: "CP-002" });
    engine.addSession({ transactionId: 3, clientId: "CP-003" });
    const profiles = engine.optimize();

    const p1 = profiles.find((p) => p.clientId === "CP-001")!;
    expect(p1.allocatedKw).toBeGreaterThanOrEqual(5);
    expect(p1.minChargeRateKw).toBe(5);
  });

  it("passes minChargeRateKw: 0 when not set", () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    const [p] = engine.optimize();
    expect(p!.minChargeRateKw).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearDispatch()
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — clearDispatch()", () => {
  it("is a no-op and resolves when no clearDispatcher configured", async () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    // Should not throw
    await expect(engine.clearDispatch()).resolves.toBeUndefined();
  });

  it("calls clearDispatcher for all sessions when no transactionId given", async () => {
    const clearDispatcher = vi.fn().mockResolvedValue(undefined);
    const engine = new SmartChargingEngine({
      siteId: "TEST",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      dispatcher: makeDispatcher(),
      clearDispatcher,
    });
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    engine.addSession({ transactionId: 2, clientId: "CP-002" });

    await engine.clearDispatch();
    expect(clearDispatcher).toHaveBeenCalledTimes(2);
  });

  it("calls clearDispatcher only for specified transactionId", async () => {
    const clearDispatcher = vi.fn().mockResolvedValue(undefined);
    const engine = new SmartChargingEngine({
      siteId: "TEST",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      dispatcher: makeDispatcher(),
      clearDispatcher,
    });
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    engine.addSession({ transactionId: 2, clientId: "CP-002" });

    await engine.clearDispatch(1);
    expect(clearDispatcher).toHaveBeenCalledTimes(1);
    expect(clearDispatcher.mock.calls[0]?.[0].transactionId).toBe(1);
  });

  it("emits 'cleared' event on success", async () => {
    const clearDispatcher = vi.fn().mockResolvedValue(undefined);
    const engine = new SmartChargingEngine({
      siteId: "TEST",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      dispatcher: makeDispatcher(),
      clearDispatcher,
    });
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    const cleared = vi.fn();
    engine.on("cleared", cleared);
    await engine.clearDispatch();
    expect(cleared).toHaveBeenCalledOnce();
  });

  it("autoClearOnRemove sends ClearChargingProfile when session is removed", async () => {
    const clearDispatcher = vi.fn().mockResolvedValue(undefined);
    const engine = new SmartChargingEngine({
      siteId: "TEST",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      dispatcher: makeDispatcher(),
      clearDispatcher,
      autoClearOnRemove: true,
    });
    engine.addSession({ transactionId: 1, clientId: "CP-001" });
    engine.removeSession(1);
    // clearDispatcher is fire-and-forget so we wait a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(clearDispatcher).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startAutoDispatch / stopAutoDispatch
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — startAutoDispatch() / stopAutoDispatch()", () => {
  it("throws SmartChargingConfigError if intervalMs < 1000", () => {
    const engine = makeEngine(100);
    expect(() => engine.startAutoDispatch(500)).toThrow(SmartChargingConfigError);
  });

  it("emits autoDispatchStarted event with intervalMs", () => {
    const engine = makeEngine(100);
    const listener = vi.fn();
    engine.on("autoDispatchStarted", listener);
    engine.startAutoDispatch(5000);
    expect(listener).toHaveBeenCalledWith(5000);
    engine.stopAutoDispatch();
  });

  it("emits autoDispatchStopped event when stopped", () => {
    const engine = makeEngine(100);
    const listener = vi.fn();
    engine.on("autoDispatchStopped", listener);
    engine.startAutoDispatch(5000);
    engine.stopAutoDispatch();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("stopAutoDispatch is a no-op when not running", () => {
    const engine = makeEngine(100);
    // Should not throw
    expect(() => engine.stopAutoDispatch()).not.toThrow();
  });

  it("config.autoDispatchActive reflects timer state", () => {
    const engine = makeEngine(100);
    expect(engine.config.autoDispatchActive).toBe(false);
    engine.startAutoDispatch(5000);
    expect(engine.config.autoDispatchActive).toBe(true);
    engine.stopAutoDispatch();
    expect(engine.config.autoDispatchActive).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Headroom redistribution / water-filling (Bug E)
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — headroom redistribution", () => {
  it("EQUAL_SHARE redistributes a capped session's surplus to the rest", () => {
    // A caps at 10kW; its ~40kW unused share should flow to B.
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "A", maxHardwarePowerKw: 10 });
    engine.addSession({ transactionId: 2, clientId: "B" });
    const profiles = engine.optimize();
    const a = profiles.find((p) => p.clientId === "A")!;
    const b = profiles.find((p) => p.clientId === "B")!;
    const total = profiles.reduce((s, p) => s + p.allocatedKw, 0);
    expect(a.allocatedKw).toBe(10);
    expect(b.allocatedKw).toBe(90); // 10 + redistributed 40 + own 50
    expect(total).toBe(100); // full grid utilized, none wasted
  });

  it("EQUAL_SHARE never exceeds a session cap during redistribution", () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "A", maxHardwarePowerKw: 10 });
    engine.addSession({ transactionId: 2, clientId: "B", maxHardwarePowerKw: 20 });
    const profiles = engine.optimize();
    profiles.forEach((p) => expect(p.allocatedKw).toBeLessThanOrEqual(20 + 1e-6));
    const total = profiles.reduce((s, p) => s + p.allocatedKw, 0);
    expect(total).toBe(30); // both capped — only 30kW usable, rest unallocated
  });

  it("PRIORITY redistributes a capped session's surplus by priority weight", () => {
    // A priority 8 caps at 40kW; surplus flows to B (priority 2).
    const engine = makeEngine(100, "PRIORITY");
    engine.addSession({ transactionId: 1, clientId: "A", priority: 8, maxHardwarePowerKw: 40 });
    engine.addSession({ transactionId: 2, clientId: "B", priority: 2 });
    const profiles = engine.optimize();
    const a = profiles.find((p) => p.clientId === "A")!;
    const b = profiles.find((p) => p.clientId === "B")!;
    const total = profiles.reduce((s, p) => s + p.allocatedKw, 0);
    expect(a.allocatedKw).toBe(40); // capped
    expect(b.allocatedKw).toBe(60); // gets the rest
    expect(total).toBe(100); // full grid utilized
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grid-budget guard (Bugs A & B)
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — grid-budget guard", () => {
  it("total never exceeds grid even when minChargeRateKw floors over-commit", () => {
    // 3 sessions × 1.4kW floor on a 3kW grid would naively sum to 4.2kW.
    const engine = makeEngine(3);
    engine.addSession({ transactionId: 1, clientId: "A", minChargeRateKw: 1.4 });
    engine.addSession({ transactionId: 2, clientId: "B", minChargeRateKw: 1.4 });
    engine.addSession({ transactionId: 3, clientId: "C", minChargeRateKw: 1.4 });
    const profiles = engine.optimize();
    const total = profiles.reduce((s, p) => s + p.allocatedKw, 0);
    expect(total).toBeLessThanOrEqual(3);
  });

  it("emits 'gridOverCommitted' with feasible:false when floors alone exceed grid", () => {
    const engine = makeEngine(3);
    const spy = vi.fn();
    engine.on("gridOverCommitted", spy);
    // 3 × 1.4 = 4.2kW of guaranteed minimums on a 3kW grid → infeasible
    engine.addSession({ transactionId: 1, clientId: "A", minChargeRateKw: 1.4 });
    engine.addSession({ transactionId: 2, clientId: "B", minChargeRateKw: 1.4 });
    engine.addSession({ transactionId: 3, clientId: "C", minChargeRateKw: 1.4 });
    engine.optimize();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0].feasible).toBe(false);
  });

  it("keeps each session at its floor when feasible, trimming only the surplus", () => {
    // 10kW grid: session A floored at 5kW, B and C share the rest.
    const engine = makeEngine(10);
    engine.addSession({ transactionId: 1, clientId: "A", minChargeRateKw: 5 });
    engine.addSession({ transactionId: 2, clientId: "B" });
    engine.addSession({ transactionId: 3, clientId: "C" });
    const profiles = engine.optimize();
    const a = profiles.find((p) => p.clientId === "A")!;
    const total = profiles.reduce((s, p) => s + p.allocatedKw, 0);
    expect(a.allocatedKw).toBeGreaterThanOrEqual(5); // floor honored
    expect(total).toBeLessThanOrEqual(10); // grid respected
  });

  it("minChargeRateKw never overrides the hardware cap", () => {
    const engine = makeEngine(100);
    engine.addSession({
      transactionId: 1,
      clientId: "A",
      maxHardwarePowerKw: 1.0,
      minChargeRateKw: 1.4,
    });
    const [p] = engine.optimize();
    expect(p!.allocatedKw).toBeLessThanOrEqual(1.0); // hardware cap wins
    expect(p!.minChargeRateKw).toBeLessThanOrEqual(1.0); // reported floor clamped too
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Voltage plumbing (Bug C)
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — voltageV", () => {
  it("uses the configured voltage for the amps calculation", () => {
    const engine = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      voltageV: 400,
      dispatcher: vi.fn().mockResolvedValue(undefined),
    });
    engine.addSession({ transactionId: 1, clientId: "A", phases: 3 });
    const [p] = engine.optimize();
    // 100kW at 400V, 3-phase = 100000 / (400*3) = 83.33A
    expect(p!.allocatedAmpsPerPhase).toBeCloseTo(83.33, 1);
    expect(p!.voltageV).toBe(400);
  });

  it("rejects voltageV <= 0", () => {
    expect(
      () =>
        new SmartChargingEngine({
          siteId: "X",
          maxGridPowerKw: 100,
          voltageV: 0,
          dispatcher: vi.fn().mockResolvedValue(undefined),
        }),
    ).toThrow(SmartChargingConfigError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY zero-guard (Bug D)
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — PRIORITY zero guard", () => {
  it("falls back to equal share when all priorities are 0 (no NaN)", () => {
    const engine = makeEngine(100, "PRIORITY");
    engine.addSession({ transactionId: 1, clientId: "A", priority: 0 });
    engine.addSession({ transactionId: 2, clientId: "B", priority: 0 });
    const profiles = engine.optimize();
    expect(profiles.every((p) => Number.isFinite(p.allocatedKw))).toBe(true);
    expect(profiles[0]!.allocatedKw).toBe(50);
    expect(profiles[1]!.allocatedKw).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TIME_OF_USE runtime swap + validation
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — TIME_OF_USE runtime swap & validation", () => {
  it("setAlgorithm('TIME_OF_USE') works using constructor windows (no config arg)", () => {
    const engine = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      algorithm: "EQUAL_SHARE",
      timeOfUseWindows: [
        { peakStartHour: 18, peakEndHour: 22, peakPowerMultiplier: 0.5 },
      ],
      dispatcher: vi.fn().mockResolvedValue(undefined),
    });
    // Should not throw — windows are retained from construction.
    expect(() => engine.setAlgorithm("TIME_OF_USE")).not.toThrow();
    expect(engine.config.algorithm).toBe("TIME_OF_USE");
  });

  it("rejects peakPowerMultiplier > 1 at construction", () => {
    expect(
      () =>
        new SmartChargingEngine({
          siteId: "X",
          maxGridPowerKw: 100,
          algorithm: "TIME_OF_USE",
          timeOfUseWindows: [
            { peakStartHour: 18, peakEndHour: 22, peakPowerMultiplier: 1.5 },
          ],
          dispatcher: vi.fn().mockResolvedValue(undefined),
        }),
    ).toThrow(SmartChargingConfigError);
  });

  it("rejects out-of-range peak hours", () => {
    expect(
      () =>
        new SmartChargingEngine({
          siteId: "X",
          maxGridPowerKw: 100,
          algorithm: "TIME_OF_USE",
          timeOfUseWindows: [
            { peakStartHour: 25, peakEndHour: 22, peakPowerMultiplier: 0.5 },
          ],
          dispatcher: vi.fn().mockResolvedValue(undefined),
        }),
    ).toThrow(SmartChargingConfigError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2: session input validation
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — addSession validation", () => {
  it("rejects negative / NaN / invalid numeric session fields", () => {
    const e = makeEngine();
    expect(() =>
      e.addSession({ transactionId: 1, clientId: "A", maxHardwarePowerKw: -5 }),
    ).toThrow(SmartChargingConfigError);
    expect(() =>
      e.addSession({ transactionId: 2, clientId: "A", maxHardwarePowerKw: NaN }),
    ).toThrow(SmartChargingConfigError);
    expect(() =>
      e.addSession({ transactionId: 3, clientId: "A", maxEvAcceptancePowerKw: 0 }),
    ).toThrow(SmartChargingConfigError);
    expect(() =>
      e.addSession({ transactionId: 4, clientId: "A", minChargeRateKw: -1 }),
    ).toThrow(SmartChargingConfigError);
    expect(() =>
      e.addSession({ transactionId: 5, clientId: "A", priority: -1 }),
    ).toThrow(SmartChargingConfigError);
    expect(() =>
      e.addSession({ transactionId: 6, clientId: "A", connectorId: -2 }),
    ).toThrow(SmartChargingConfigError);
  });

  it("accepts Infinity as an uncapped hardware/EV limit", () => {
    const e = makeEngine();
    expect(() =>
      e.addSession({
        transactionId: 1,
        clientId: "A",
        maxHardwarePowerKw: Infinity,
        maxEvAcceptancePowerKw: Infinity,
      }),
    ).not.toThrow();
  });

  it("buildSessionProfile clamps a negative minChargeRateKw to 0 (defensive)", () => {
    const profile = buildSessionProfile(
      {
        transactionId: 1,
        clientId: "A",
        connectorId: 1,
        priority: 1,
        phases: 3,
        minChargeRateKw: -10,
        addedAt: 0,
      } as never,
      50,
    );
    expect(profile.minChargeRateKw).toBe(0);
    expect(profile.allocatedKw).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2: getSessions / getSession encapsulation
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — session snapshots are copies", () => {
  it("mutating getSessions() result does not affect engine state", () => {
    const engine = makeEngine(100, "PRIORITY");
    engine.addSession({ transactionId: 1, clientId: "A", priority: 1 });
    engine.addSession({ transactionId: 2, clientId: "B", priority: 1 });
    (engine.getSessions()[0] as { priority: number }).priority = 999;
    const profiles = engine.optimize();
    const a = profiles.find((p) => p.clientId === "A")!;
    expect(a.allocatedKw).toBe(50); // unchanged — mutation didn't leak in
  });

  it("getSession returns a copy, or undefined for unknown ids", () => {
    const engine = makeEngine();
    engine.addSession({ transactionId: 7, clientId: "A", priority: 1 });
    const snap = engine.getSession(7)!;
    expect(snap.clientId).toBe("A");
    (snap as { priority: number }).priority = 42;
    expect(engine.getSession(7)!.priority).toBe(1); // engine state intact
    expect(engine.getSession(999)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2: custom strategy support
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — custom strategy", () => {
  const firstGetsAll: StrategyFn = (sessions, grid, ctx) =>
    sessions.map((s, i) =>
      buildSessionProfile(s, i === 0 ? grid : 0, ctx?.voltageV),
    );

  it("accepts a custom StrategyFn via config.algorithm", () => {
    const engine = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      algorithm: firstGetsAll,
      dispatcher: vi.fn().mockResolvedValue(undefined),
    });
    engine.addSession({ transactionId: 1, clientId: "A" });
    engine.addSession({ transactionId: 2, clientId: "B" });
    const profiles = engine.optimize();
    expect(profiles.find((p) => p.clientId === "A")!.allocatedKw).toBe(100);
    expect(profiles.find((p) => p.clientId === "B")!.allocatedKw).toBe(0);
    expect(engine.config.algorithm).toBe("CUSTOM");
  });

  it("setAlgorithm accepts a custom StrategyFn at runtime", () => {
    const engine = makeEngine(100, "EQUAL_SHARE");
    engine.addSession({ transactionId: 1, clientId: "A" });
    engine.addSession({ transactionId: 2, clientId: "B" });
    engine.setAlgorithm(firstGetsAll);
    const profiles = engine.optimize();
    expect(profiles.find((p) => p.clientId === "A")!.allocatedKw).toBe(100);
    expect(engine.config.algorithm).toBe("CUSTOM");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2: dispatch() re-entrancy guard
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — dispatch overlap guard", () => {
  it("coalesces overlapping dispatch() calls onto the in-flight run", async () => {
    const dispatcher = vi.fn().mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 20)),
    );
    const engine = makeEngine(100, "EQUAL_SHARE", dispatcher);
    engine.addSession({ transactionId: 1, clientId: "A" });

    const p1 = engine.dispatch();
    const p2 = engine.dispatch(); // coalesces onto p1, never overlaps it
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(r2); // same in-flight result
    // The coalesced call schedules ONE trailing re-run (so state changes made
    // mid-flight are applied) — runs are sequential, never overlapping.
    await vi.waitFor(() => expect(dispatcher).toHaveBeenCalledTimes(2));

    // After settling, a fresh dispatch runs normally again.
    await engine.dispatch();
    expect(dispatcher).toHaveBeenCalledTimes(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2: TOU timezone + config snapshot
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — TOU timezone & config snapshot", () => {
  const windows = [
    { peakStartHour: 18, peakEndHour: 22, peakPowerMultiplier: 0.5 },
  ];

  it("exposes a defensive copy of timeOfUseWindows in config", () => {
    const engine = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      algorithm: "TIME_OF_USE",
      timeOfUseWindows: windows,
      dispatcher: vi.fn().mockResolvedValue(undefined),
    });
    expect(engine.config.timeOfUseWindows).toHaveLength(1);
    // Mutating the snapshot must not affect the engine's retained windows.
    engine.config.timeOfUseWindows![0]!.peakPowerMultiplier = 0.1;
    expect(engine.config.timeOfUseWindows![0]!.peakPowerMultiplier).toBe(0.5);
  });

  it("accepts a valid timezone and falls back gracefully on an invalid one", () => {
    const good = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      algorithm: "TIME_OF_USE",
      timeOfUseWindows: windows,
      timeOfUseTimezone: "America/New_York",
      dispatcher: vi.fn().mockResolvedValue(undefined),
    });
    good.addSession({ transactionId: 1, clientId: "A" });
    expect(() => good.optimize()).not.toThrow();

    const bad = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      algorithm: "TIME_OF_USE",
      timeOfUseWindows: windows,
      timeOfUseTimezone: "Not/ARealZone",
      dispatcher: vi.fn().mockResolvedValue(undefined),
    });
    bad.addSession({ transactionId: 1, clientId: "A" });
    expect(() => bad.optimize()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: updateSession()
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — updateSession()", () => {
  it("updates fields in place, preserving addedAt and identity", () => {
    const engine = makeEngine(100, "PRIORITY");
    const added = engine.addSession({ transactionId: 1, clientId: "A", priority: 2 });
    const updated = engine.updateSession(1, { priority: 9, maxEvAcceptancePowerKw: 11 });
    expect(updated.priority).toBe(9);
    expect(updated.maxEvAcceptancePowerKw).toBe(11);
    expect(updated.clientId).toBe("A");
    expect(updated.transactionId).toBe(1);
    expect(updated.addedAt).toBe(added.addedAt); // preserved
    // Reflected in the next optimize
    engine.addSession({ transactionId: 2, clientId: "B", priority: 1 });
    const profiles = engine.optimize();
    const a = profiles.find((p) => p.clientId === "A")!;
    expect(a.allocatedKw).toBe(11); // capped by new EV acceptance limit
  });

  it("does NOT fire clearDispatcher (unlike remove+add)", () => {
    const clearDispatcher = vi.fn().mockResolvedValue(undefined);
    const engine = new SmartChargingEngine({
      siteId: "X", maxGridPowerKw: 100, safetyMarginPct: 0,
      dispatcher: vi.fn().mockResolvedValue(undefined),
      clearDispatcher, autoClearOnRemove: true,
    });
    engine.addSession({ transactionId: 1, clientId: "A", priority: 1 });
    engine.updateSession(1, { priority: 5 });
    expect(clearDispatcher).not.toHaveBeenCalled();
  });

  it("emits 'sessionUpdated' and throws for unknown / invalid input", () => {
    const engine = makeEngine();
    const spy = vi.fn();
    engine.on("sessionUpdated", spy);
    engine.addSession({ transactionId: 1, clientId: "A" });
    engine.updateSession(1, { minChargeRateKw: 3 });
    expect(spy).toHaveBeenCalledOnce();
    expect(() => engine.updateSession(999, { priority: 1 })).toThrow(SessionNotFoundError);
    expect(() => engine.updateSession(1, { priority: -1 })).toThrow(SmartChargingConfigError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: snapshot persistence
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — getSnapshot() / loadSnapshot()", () => {
  it("round-trips sessions through a snapshot (incl. addedAt)", () => {
    const a = makeEngine(100);
    a.addSession({ transactionId: 1, clientId: "CP-1", priority: 3, maxHardwarePowerKw: 22 });
    a.addSession({ transactionId: 2, clientId: "CP-2", minChargeRateKw: 1.4 });
    const snap = JSON.parse(JSON.stringify(a.getSnapshot())); // simulate persistence

    const b = makeEngine(100);
    b.loadSnapshot(snap);
    expect(b.sessionCount).toBe(2);
    expect(b.getSession(1)!.maxHardwarePowerKw).toBe(22);
    expect(b.getSession(1)!.addedAt).toBe(a.getSession(1)!.addedAt); // preserved
    expect(b.getSession(2)!.minChargeRateKw).toBe(1.4);
  });

  it("clears by default and emits 'snapshotLoaded'; merges when clear:false", () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 99, clientId: "OLD" });
    const spy = vi.fn();
    engine.on("snapshotLoaded", spy);

    engine.loadSnapshot([{ transactionId: 1, clientId: "NEW" }]);
    expect(engine.sessionCount).toBe(1); // OLD cleared
    expect(spy).toHaveBeenCalledOnce();

    engine.loadSnapshot([{ transactionId: 2, clientId: "MERGED" }], { clear: false });
    expect(engine.sessionCount).toBe(2);
  });

  it("is atomic — a bad entry throws before applying anything", () => {
    const engine = makeEngine(100);
    engine.addSession({ transactionId: 1, clientId: "KEEP" });
    expect(() =>
      engine.loadSnapshot([
        { transactionId: 2, clientId: "OK" },
        { transactionId: 3, clientId: "BAD", maxHardwarePowerKw: -1 },
      ]),
    ).toThrow(SmartChargingConfigError);
    // Original session untouched, nothing partially applied.
    expect(engine.sessionCount).toBe(1);
    expect(engine.getSession(1)!.clientId).toBe("KEEP");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: per-session starvation signal
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — starvation signal", () => {
  it("reports which sessions fell below their minimum (infeasible grid)", () => {
    // 3 × 1.4kW floors on a 3kW grid → infeasible, everyone starved.
    const engine = makeEngine(3);
    const spy = vi.fn();
    engine.on("gridOverCommitted", spy);
    engine.addSession({ transactionId: 1, clientId: "A", minChargeRateKw: 1.4 });
    engine.addSession({ transactionId: 2, clientId: "B", minChargeRateKw: 1.4 });
    engine.addSession({ transactionId: 3, clientId: "C", minChargeRateKw: 1.4 });
    engine.optimize();
    const info = spy.mock.calls[0]![0];
    expect(info.feasible).toBe(false);
    expect(info.starvedSessions).toHaveLength(3);
    expect(info.starvedSessions[0]).toMatchObject({
      clientId: expect.any(String),
      minChargeRateKw: 1.4,
    });
    expect(info.starvedSessions[0].allocatedKw).toBeLessThan(1.4);
  });

  it("reports no starvation in the feasible branch", () => {
    const engine = makeEngine(10);
    const spy = vi.fn();
    engine.on("gridOverCommitted", spy);
    engine.addSession({ transactionId: 1, clientId: "A", minChargeRateKw: 5 });
    engine.addSession({ transactionId: 2, clientId: "B" });
    engine.addSession({ transactionId: 3, clientId: "C" });
    engine.optimize();
    expect(spy.mock.calls[0]![0].feasible).toBe(true);
    expect(spy.mock.calls[0]![0].starvedSessions).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: split-phase (2-phase) support
// ─────────────────────────────────────────────────────────────────────────────

describe("SmartChargingEngine — split-phase (phases: 2)", () => {
  it("accepts phases: 2 and computes amps across 2 phases", () => {
    const engine = new SmartChargingEngine({
      siteId: "X", maxGridPowerKw: 48, safetyMarginPct: 0, voltageV: 120,
      dispatcher: vi.fn().mockResolvedValue(undefined),
    });
    engine.addSession({ transactionId: 1, clientId: "A", phases: 2 });
    const [p] = engine.optimize();
    expect(p!.phases).toBe(2);
    // 48kW at 120V across 2 phases = 48000 / (120*2) = 200A
    expect(p!.allocatedAmpsPerPhase).toBeCloseTo(200, 1);
  });

  it("still rejects an out-of-range phase count", () => {
    const engine = makeEngine();
    expect(() =>
      engine.addSession({ transactionId: 1, clientId: "A", phases: 4 as 1 | 2 | 3 }),
    ).toThrow(SmartChargingConfigError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Review fixes (report.md 2026-06-11)
// ─────────────────────────────────────────────────────────────────────────────

describe("Review H1 — no crash without an 'error' listener", () => {
  it("auto-dispatch tick with a throwing strategy does not throw uncaught", () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const engine = new SmartChargingEngine({
        siteId: "X",
        maxGridPowerKw: 100,
        algorithm: () => {
          throw new Error("strategy boom");
        },
        dispatcher: makeDispatcher(),
      });
      engine.addSession({ transactionId: 1, clientId: "A" });
      engine.startAutoDispatch(1000);
      // No 'error' listener attached — the tick must not throw out of the timer
      expect(() => vi.advanceTimersByTime(3500)).not.toThrow();
      engine.stopAutoDispatch();
      expect(consoleSpy).toHaveBeenCalled(); // error still surfaced via console
    } finally {
      consoleSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("still emits 'error' when a listener is attached", () => {
    const engine = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100,
      algorithm: () => {
        throw new Error("strategy boom");
      },
      dispatcher: makeDispatcher(),
    });
    engine.addSession({ transactionId: 1, clientId: "A" });
    const errors: Error[] = [];
    engine.on("error", (e) => errors.push(e));
    expect(() => engine.optimize()).toThrow(StrategyError);
    expect(errors).toHaveLength(1);
  });
});

describe("Review H2 — clearDispatch(0) targets only transaction 0", () => {
  it("does not clear all sessions for a falsy transactionId", async () => {
    const cleared: Array<number | string> = [];
    const engine = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100,
      dispatcher: makeDispatcher(),
      clearDispatcher: async (p) => {
        cleared.push(p.transactionId);
      },
    });
    engine.addSession({ transactionId: 0, clientId: "A" });
    engine.addSession({ transactionId: 1, clientId: "B" });

    await engine.clearDispatch(0);
    expect(cleared).toEqual([0]);

    cleared.length = 0;
    await engine.clearDispatch(); // no arg still clears everything
    expect(cleared.sort()).toEqual([0, 1]);
  });
});

describe("Review M1 — no spurious gridOverCommitted from rounding", () => {
  it("3 uncapped sessions on a non-exact division stay within budget", () => {
    const engine = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100, // 5% default margin → 95 kW / 3 = 31.666…
      dispatcher: makeDispatcher(),
    });
    let fired = false;
    engine.on("gridOverCommitted", () => {
      fired = true;
    });
    for (let i = 1; i <= 3; i++)
      engine.addSession({ transactionId: i, clientId: `CP${i}` });

    const profiles = engine.optimize();
    const sum = profiles.reduce((s, p) => s + p.allocatedKw, 0);
    expect(sum).toBeLessThanOrEqual(95);
    expect(profiles.every((p) => p.allocatedKw === 31.66)).toBe(true);
    expect(fired).toBe(false);
  });

  it("still fires for genuine floor-induced overcommit", () => {
    const engine = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 10,
      safetyMarginPct: 0,
      dispatcher: makeDispatcher(),
    });
    let info: unknown = null;
    engine.on("gridOverCommitted", (i) => {
      info = i;
    });
    engine.addSession({ transactionId: 1, clientId: "A", minChargeRateKw: 8 });
    engine.addSession({ transactionId: 2, clientId: "B", minChargeRateKw: 8 });
    engine.optimize();
    expect(info).not.toBeNull();
  });
});

describe("Review M3 — trailing re-dispatch after coalesced call", () => {
  it("applies state changes made during an in-flight dispatch", async () => {
    const seen: number[] = [];
    let resolveFirst!: () => void;
    let callCount = 0;
    const engine = new SmartChargingEngine({
      siteId: "X",
      maxGridPowerKw: 100,
      safetyMarginPct: 0,
      dispatcher: async ({ sessionProfile }) => {
        callCount++;
        seen.push(sessionProfile.allocatedKw);
        if (callCount === 1) {
          await new Promise<void>((r) => {
            resolveFirst = r;
          });
        }
      },
    });
    engine.addSession({ transactionId: 1, clientId: "A" });

    const first = engine.dispatch(); // hangs in the dispatcher
    await new Promise((r) => setTimeout(r, 10));
    engine.setGridLimit(50); // state change mid-flight
    const coalesced = engine.dispatch(); // coalesces onto the first run
    resolveFirst();
    await first;
    await coalesced;
    // Trailing run must have fired with the NEW limit
    await vi.waitFor(() => expect(seen).toContain(50));
  });
});

describe("Review L6/L7 — validation hardening", () => {
  it("rejects snapshots with duplicate transactionIds", () => {
    const engine = makeEngine();
    expect(() =>
      engine.loadSnapshot([
        { transactionId: 1, clientId: "A" },
        { transactionId: 1, clientId: "B" },
      ]),
    ).toThrow(SmartChargingConfigError);
  });

  it("rejects sessions without identity fields", () => {
    const engine = makeEngine();
    expect(() =>
      engine.addSession({ transactionId: 1, clientId: "" }),
    ).toThrow(SmartChargingConfigError);
    expect(() =>
      engine.addSession({
        transactionId: undefined as unknown as number,
        clientId: "A",
      }),
    ).toThrow(SmartChargingConfigError);
  });
});

describe("Review L3 — events emit copies", () => {
  it("mutating an emitted session does not affect engine state", () => {
    const engine = makeEngine();
    let emitted: { priority: number } | null = null;
    engine.on("sessionAdded", (s) => {
      emitted = s;
    });
    const returned = engine.addSession({ transactionId: 1, clientId: "A" });
    emitted!.priority = 999;
    returned.priority = 888;
    expect(engine.getSession(1)!.priority).toBe(1);
  });
});
