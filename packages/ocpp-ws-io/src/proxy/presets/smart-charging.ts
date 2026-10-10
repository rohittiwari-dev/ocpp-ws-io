import type { TranslationMap } from "../core/types.js";

/**
 * Smart Charging profile preset.
 * Covers: SetChargingProfile, ClearChargingProfile, GetCompositeSchedule.
 */
export const smartChargingPreset: Partial<TranslationMap> = {
  downstream: {
    "ocpp2.1:SetChargingProfile": (params) => ({
      action: "SetChargingProfile",
      payload: {
        connectorId: params.evseId,
        csChargingProfiles: params.chargingProfile,
      },
    }),
    "ocpp2.1:ClearChargingProfile": (params) => ({
      action: "ClearChargingProfile",
      payload: {
        id: params.chargingProfileId,
        connectorId: params.chargingProfileCriteria?.evseId,
        chargingProfilePurpose:
          params.chargingProfileCriteria?.chargingProfilePurpose,
        stackLevel: params.chargingProfileCriteria?.stackLevel,
      },
    }),
    "ocpp2.1:GetCompositeSchedule": (params) => ({
      action: "GetCompositeSchedule",
      payload: {
        connectorId: params.evseId,
        duration: params.duration,
        chargingRateUnit: params.chargingRateUnit,
      },
    }),
  },
};
