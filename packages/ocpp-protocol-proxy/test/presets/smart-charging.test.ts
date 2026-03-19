import { describe, it, expect } from "vitest";
import { InMemorySessionStore } from "../../src/core/session.js";
import type { TranslationContext } from "../../src/core/types.js";
import { smartChargingPreset } from "../../src/presets/smart-charging.js";

function makeCtx(): TranslationContext {
  return {
    identity: "test-cp",
    sourceProtocol: "ocpp1.6",
    targetProtocol: "ocpp2.1",
    session: new InMemorySessionStore(),
  };
}

describe("Smart Charging Preset", () => {
  const down = smartChargingPreset.downstream!;

  it("SetChargingProfile: maps evseId to connectorId", async () => {
    const result = await down["ocpp2.1:SetChargingProfile"](
      {
        evseId: 2,
        chargingProfile: {
          id: 1,
          stackLevel: 0,
          chargingProfilePurpose: "TxDefaultProfile",
        },
      },
      makeCtx(),
    );
    expect(result.payload.connectorId).toBe(2);
    expect(result.payload.csChargingProfiles.id).toBe(1);
  });

  it("ClearChargingProfile: maps criteria fields", async () => {
    const result = await down["ocpp2.1:ClearChargingProfile"](
      {
        chargingProfileId: 5,
        chargingProfileCriteria: {
          evseId: 1,
          chargingProfilePurpose: "TxDefaultProfile",
          stackLevel: 0,
        },
      },
      makeCtx(),
    );
    expect(result.payload.id).toBe(5);
    expect(result.payload.connectorId).toBe(1);
    expect(result.payload.chargingProfilePurpose).toBe("TxDefaultProfile");
    expect(result.payload.stackLevel).toBe(0);
  });

  it("GetCompositeSchedule: maps evseId to connectorId", async () => {
    const result = await down["ocpp2.1:GetCompositeSchedule"](
      { evseId: 1, duration: 600, chargingRateUnit: "W" },
      makeCtx(),
    );
    expect(result.payload.connectorId).toBe(1);
    expect(result.payload.duration).toBe(600);
    expect(result.payload.chargingRateUnit).toBe("W");
  });
});
