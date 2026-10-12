import { RPCNotSupportedError } from "../../core/errors.js";
import type {
  OCPPRequestType,
  OCPPResponseType,
} from "../../generated/index.js";
import type { TranslationContext, TranslationMap } from "../core/types.js";

type Profile21 = OCPPRequestType<
  "ocpp2.1",
  "SetChargingProfile"
>["chargingProfile"];
type Profile16 = OCPPRequestType<
  "ocpp1.6",
  "SetChargingProfile"
>["csChargingProfiles"];
type Purpose21 = Profile21["chargingProfilePurpose"];
type Purpose16 = Profile16["chargingProfilePurpose"];
type Period16 = Profile16["chargingSchedule"]["chargingSchedulePeriod"][number];

/**
 * The 2.x purposes 1.6 has. External constraints, priority charging and local
 * generation have no 1.6 counterpart.
 */
const purposes16: Partial<Record<Purpose21, Purpose16>> = {
  ChargingStationMaxProfile: "ChargePointMaxProfile",
  TxDefaultProfile: "TxDefaultProfile",
  TxProfile: "TxProfile",
};

function toPurpose16(purpose: Purpose21): Purpose16 {
  const purpose16 = purposes16[purpose];
  if (!purpose16) {
    throw new RPCNotSupportedError(
      `OCPP 1.6 has no ${purpose} charging profile`,
    );
  }
  return purpose16;
}

/**
 * A 2.x charging profile as 1.6's csChargingProfiles. What 1.6 cannot hold is
 * refused with NotSupported, not dropped: a Dynamic profile, a purpose 1.6 has
 * not, more than one schedule, a period without a limit, or a transaction the
 * proxy has no 1.6 id for. Fields 1.6 has no place for (a schedule's id and
 * sales tariff, a period's phaseToUse, 2.1's additions) are left out.
 */
async function toProfile16(
  profile: Profile21,
  ctx: TranslationContext,
): Promise<Profile16> {
  const kind = profile.chargingProfileKind;
  if (kind === "Dynamic") {
    throw new RPCNotSupportedError("OCPP 1.6 has no Dynamic charging profile");
  }

  const [schedule, ...more] = profile.chargingSchedule;
  if (!schedule || more.length > 0) {
    throw new RPCNotSupportedError(
      `OCPP 1.6 takes one charging schedule; the profile has ${profile.chargingSchedule.length}`,
    );
  }

  const periods = schedule.chargingSchedulePeriod.map((period): Period16 => {
    if (period.limit === undefined) {
      throw new RPCNotSupportedError(
        `OCPP 1.6 needs a limit in every schedule period; the one at ${period.startPeriod} s has none`,
      );
    }
    return {
      startPeriod: period.startPeriod,
      limit: period.limit,
      ...(period.numberPhases !== undefined && {
        numberPhases: period.numberPhases,
      }),
    };
  });

  // 1.6 numbers transactions; the core preset records the 1.6 id it gave each
  // 2.x transaction.
  let transactionId: number | undefined;
  if (profile.transactionId !== undefined) {
    transactionId = await ctx.session.get<number>(
      ctx.identity,
      `txId_uuid2int_${profile.transactionId}`,
    );
    if (transactionId === undefined) {
      throw new RPCNotSupportedError(
        `No OCPP 1.6 transaction is known for transaction ${profile.transactionId}`,
      );
    }
  }

  return {
    chargingProfileId: profile.id,
    ...(transactionId !== undefined && { transactionId }),
    stackLevel: profile.stackLevel,
    chargingProfilePurpose: toPurpose16(profile.chargingProfilePurpose),
    chargingProfileKind: kind,
    ...(profile.recurrencyKind !== undefined && {
      recurrencyKind: profile.recurrencyKind,
    }),
    ...(profile.validFrom !== undefined && { validFrom: profile.validFrom }),
    ...(profile.validTo !== undefined && { validTo: profile.validTo }),
    chargingSchedule: {
      ...(schedule.duration !== undefined && { duration: schedule.duration }),
      ...(schedule.startSchedule !== undefined && {
        startSchedule: schedule.startSchedule,
      }),
      chargingRateUnit: schedule.chargingRateUnit,
      chargingSchedulePeriod: periods,
      ...(schedule.minChargingRate !== undefined && {
        minChargingRate: schedule.minChargingRate,
      }),
    },
  };
}

/**
 * Smart Charging profile preset.
 * Covers: SetChargingProfile, ClearChargingProfile, GetCompositeSchedule.
 */
export const smartChargingPreset: Partial<TranslationMap> = {
  downstream: {
    "ocpp2.1:SetChargingProfile": async (params, ctx) => ({
      action: "SetChargingProfile",
      payload: {
        connectorId: params.evseId,
        csChargingProfiles: await toProfile16(params.chargingProfile, ctx),
      },
    }),
    "ocpp2.1:ClearChargingProfile": (params) => ({
      action: "ClearChargingProfile",
      payload: {
        id: params.chargingProfileId,
        connectorId: params.chargingProfileCriteria?.evseId,
        // Left out, the purpose would clear every profile on the connector.
        chargingProfilePurpose:
          params.chargingProfileCriteria?.chargingProfilePurpose === undefined
            ? undefined
            : toPurpose16(
                params.chargingProfileCriteria.chargingProfilePurpose,
              ),
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
  responses: {
    // The answer is the 1.6 charger's, which may be NotSupported; 2.x has only
    // Accepted and Rejected.
    "ocpp2.1:SetChargingProfileResponse": (
      params: OCPPResponseType<"ocpp1.6", "SetChargingProfile">,
    ): OCPPResponseType<"ocpp2.1", "SetChargingProfile"> =>
      params.status === "NotSupported"
        ? {
            status: "Rejected",
            statusInfo: {
              reasonCode: "NotSupported",
              additionalInfo: "The OCPP 1.6 charger does not support it",
            },
          }
        : { status: params.status },
  },
};
