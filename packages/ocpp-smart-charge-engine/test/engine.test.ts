import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SmartChargingEngine,
  Strategies,
  DuplicateSessionError,
  SessionNotFoundError,
  SmartChargingConfigError,
} from "../src/index.js";
import type { ChargingProfileDispatcher } from "../src/index.js";

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
