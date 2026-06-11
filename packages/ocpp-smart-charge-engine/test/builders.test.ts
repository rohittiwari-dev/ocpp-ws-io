import { describe, expect, it } from "vitest";
import {
  buildOcpp16Profile,
  buildOcpp201Profile,
  buildOcpp21Profile,
} from "../src/builders.js";
import type { SessionProfile } from "../src/types.js";

function profile(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    transactionId: 42,
    clientId: "CP-1",
    connectorId: 1,
    allocatedKw: 7.36,
    allocatedW: 7360,
    allocatedAmpsPerPhase: 32, // 7360 / (230 * 1)
    minChargeRateKw: 1.4,
    phases: 1,
    voltageV: 230,
    ...overrides,
  };
}

describe("builders — phase consistency (M2)", () => {
  it("defaults numberPhases to the session's phase count", () => {
    const p16 = buildOcpp16Profile(profile());
    expect(p16.chargingSchedule.chargingSchedulePeriod[0]!.numberPhases).toBe(1);

    const p201 = buildOcpp201Profile(profile());
    expect(
      p201.chargingSchedule[0]!.chargingSchedulePeriod[0]!.numberPhases,
    ).toBe(1);

    const p21 = buildOcpp21Profile(profile());
    expect(
      p21.chargingSchedule[0]!.chargingSchedulePeriod[0]!.numberPhases,
    ).toBe(1);
  });

  it("minChargingRate amps conversion uses the same phase count as the limit", () => {
    const p16 = buildOcpp16Profile(profile(), { rateUnit: "A" });
    // min 1.4 kW at 230 V on 1 phase = 1400 / 230 ≈ 6.09 A
    expect(p16.chargingSchedule.minChargingRate).toBeCloseTo(1400 / 230, 2);
  });

  it("an explicit numberPhases option still wins", () => {
    const p16 = buildOcpp16Profile(profile(), { numberPhases: 3 });
    expect(p16.chargingSchedule.chargingSchedulePeriod[0]!.numberPhases).toBe(3);
  });
});

describe("builders — profile id seeding (M4)", () => {
  it("default ids are time-seeded (not 1, 2, 3…) and increase monotonically", () => {
    const a = buildOcpp16Profile(profile());
    const b = buildOcpp16Profile(profile());
    expect(a.chargingProfileId).toBeGreaterThan(1000); // not a restart-colliding 1
    expect(b.chargingProfileId).toBe(a.chargingProfileId + 1);
  });

  it("profileId option overrides the counter", () => {
    const p = buildOcpp16Profile(profile(), { profileId: 7 });
    expect(p.chargingProfileId).toBe(7);
  });
});

describe("builders — 2.1 dischargeLimit with custom periods (M5)", () => {
  it("applies dischargeLimitW to user-supplied periods", () => {
    const p = buildOcpp21Profile(profile(), {
      dischargeLimitW: 7400,
      periods: [
        { startPeriod: 0, limit: 22000 },
        { startPeriod: 3600, limit: 11000 },
      ],
    });
    const periods = p.chargingSchedule[0]!.chargingSchedulePeriod;
    expect(periods[0]!.dischargeLimit).toBe(-7400);
    expect(periods[1]!.dischargeLimit).toBe(-7400);
  });

  it("does not override a period's own dischargeLimit", () => {
    const p = buildOcpp21Profile(profile(), {
      dischargeLimitW: 7400,
      periods: [{ startPeriod: 0, limit: 22000, dischargeLimit: -3000 }],
    });
    expect(
      p.chargingSchedule[0]!.chargingSchedulePeriod[0]!.dischargeLimit,
    ).toBe(-3000);
  });

  it("still applies to the default single period", () => {
    const p = buildOcpp21Profile(profile(), { dischargeLimitW: 7400 });
    expect(
      p.chargingSchedule[0]!.chargingSchedulePeriod[0]!.dischargeLimit,
    ).toBe(-7400);
  });
});
