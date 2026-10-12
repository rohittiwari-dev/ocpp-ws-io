import { describe, it, expect } from "vitest";
import { calls, responses } from "../helpers.js";
import { getStandardValidator } from "../../../src/core/validation/standard-validators.js";
import { InMemorySessionStore } from "../../../src/proxy/core/session.js";
import type {
  ProxyPayload,
  TranslationContext,
} from "../../../src/proxy/core/types.js";
import { smartChargingPreset } from "../../../src/proxy/presets/smart-charging.js";

function makeCtx(): TranslationContext {
  return {
    identity: "test-cp",
    sourceProtocol: "ocpp1.6",
    targetProtocol: "ocpp2.1",
    session: new InMemorySessionStore(),
  };
}

const v16 = getStandardValidator("ocpp1.6")!;
const v21 = getStandardValidator("ocpp2.1")!;

/** A 2.1 charging profile with one schedule, valid against the 2.1 schema. */
function profile21(): ProxyPayload {
  return {
    id: 7,
    stackLevel: 1,
    chargingProfilePurpose: "TxDefaultProfile",
    chargingProfileKind: "Absolute",
    validFrom: "2026-10-12T00:00:00Z",
    validTo: "2026-10-13T00:00:00Z",
    chargingSchedule: [
      {
        id: 1,
        startSchedule: "2026-10-12T00:00:00Z",
        duration: 3600,
        chargingRateUnit: "W",
        minChargingRate: 1000,
        chargingSchedulePeriod: [
          { startPeriod: 0, limit: 11000, numberPhases: 1, phaseToUse: 1 },
          { startPeriod: 1800, limit: 7400 },
        ],
        salesTariff: {
          id: 1,
          salesTariffEntry: [{ relativeTimeInterval: { start: 0 } }],
        },
      },
    ],
  };
}

/** A 2.1 SetChargingProfile request, checked against the 2.1 schema. */
function setRequest(evseId: number, chargingProfile: ProxyPayload) {
  const request = { evseId, chargingProfile };
  v21.validate("urn:SetChargingProfile.req", request);
  return request;
}

describe("Smart Charging Preset", () => {
  const down = calls(smartChargingPreset.downstream);
  const up = responses(smartChargingPreset.responses);

  // validate() skips a schema it does not have, so a wrong id would pass.
  it("has the schemas the tests check against", () => {
    const missing = [
      [v16, "urn:SetChargingProfile.req"],
      [v16, "urn:ClearChargingProfile.req"],
      [v21, "urn:SetChargingProfile.req"],
      [v21, "urn:SetChargingProfile.conf"],
    ] as const;
    expect(missing.filter(([v, id]) => !v.hasSchema(id)).map(([, id]) => id)).toEqual([]);
  });

  describe("SetChargingProfile", () => {
    it("sends a 1.6 profile the 1.6 schema accepts", async () => {
      const result = await down["ocpp2.1:SetChargingProfile"](
        setRequest(1, profile21()),
        makeCtx(),
      );
      const payload = JSON.parse(JSON.stringify(result.payload));

      expect(result.action).toBe("SetChargingProfile");
      expect(payload).toEqual({
        connectorId: 1,
        csChargingProfiles: {
          chargingProfileId: 7,
          stackLevel: 1,
          chargingProfilePurpose: "TxDefaultProfile",
          chargingProfileKind: "Absolute",
          validFrom: "2026-10-12T00:00:00Z",
          validTo: "2026-10-13T00:00:00Z",
          chargingSchedule: {
            startSchedule: "2026-10-12T00:00:00Z",
            duration: 3600,
            chargingRateUnit: "W",
            minChargingRate: 1000,
            chargingSchedulePeriod: [
              { startPeriod: 0, limit: 11000, numberPhases: 1 },
              { startPeriod: 1800, limit: 7400 },
            ],
          },
        },
      });
      expect(() =>
        v16.validate("urn:SetChargingProfile.req", payload),
      ).not.toThrow();
    });

    it("names the station-wide maximum ChargePointMaxProfile", async () => {
      const result = await down["ocpp2.1:SetChargingProfile"](
        setRequest(0, {
          ...profile21(),
          chargingProfilePurpose: "ChargingStationMaxProfile",
        }),
        makeCtx(),
      );
      const payload = JSON.parse(JSON.stringify(result.payload));

      expect(payload.connectorId).toBe(0);
      expect(payload.csChargingProfiles.chargingProfilePurpose).toBe(
        "ChargePointMaxProfile",
      );
      expect(() =>
        v16.validate("urn:SetChargingProfile.req", payload),
      ).not.toThrow();
    });

    it("sends the 1.6 transaction id the proxy gave the 2.x one", async () => {
      const ctx = makeCtx();
      const uuid = "3f1e7c52-6f0e-4c39-9d1b-2b5a0f0d9a11";
      await ctx.session.set(ctx.identity, `txId_uuid2int_${uuid}`, 42);

      const result = await down["ocpp2.1:SetChargingProfile"](
        setRequest(1, {
          ...profile21(),
          chargingProfilePurpose: "TxProfile",
          transactionId: uuid,
        }),
        ctx,
      );
      const payload = JSON.parse(JSON.stringify(result.payload));

      expect(payload.csChargingProfiles.transactionId).toBe(42);
      expect(() =>
        v16.validate("urn:SetChargingProfile.req", payload),
      ).not.toThrow();
    });

    const schedule = () =>
      (profile21().chargingSchedule as ProxyPayload[])[0] as ProxyPayload;

    it.each([
      [
        "an external-constraints profile",
        { chargingProfilePurpose: "ChargingStationExternalConstraints" },
      ],
      ["a priority-charging profile", { chargingProfilePurpose: "PriorityCharging" }],
      ["a local-generation profile", { chargingProfilePurpose: "LocalGeneration" }],
      ["a dynamic profile", { chargingProfileKind: "Dynamic" }],
      [
        "two schedules",
        { chargingSchedule: [schedule(), { ...schedule(), id: 2 }] },
      ],
      [
        "a period without a limit",
        {
          chargingSchedule: [
            {
              ...schedule(),
              chargingSchedulePeriod: [{ startPeriod: 0, setpoint: 5000 }],
            },
          ],
        },
      ],
      [
        "a transaction the proxy does not know",
        {
          chargingProfilePurpose: "TxProfile",
          transactionId: "0b9d3a7e-0000-4000-8000-000000000000",
        },
      ],
    ])("refuses %s with NotSupported", async (_name, change) => {
      await expect(
        down["ocpp2.1:SetChargingProfile"](
          setRequest(1, { ...profile21(), ...change }),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ rpcErrorCode: "NotSupported" });
    });

    it.each([
      ["Accepted", { status: "Accepted" }],
      ["Rejected", { status: "Rejected" }],
      [
        "NotSupported",
        {
          status: "Rejected",
          statusInfo: {
            reasonCode: "NotSupported",
            additionalInfo: "The OCPP 1.6 charger does not support it",
          },
        },
      ],
    ])("answers a 1.6 %s with a 2.x status", async (status, expected) => {
      const answer = await up["ocpp2.1:SetChargingProfileResponse"](
        { status },
        makeCtx(),
      );

      expect(answer).toEqual(expected);
      expect(() =>
        v21.validate("urn:SetChargingProfile.conf", answer),
      ).not.toThrow();
    });
  });

  describe("ClearChargingProfile", () => {
    it("maps criteria fields", async () => {
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
      expect(() =>
        v16.validate("urn:ClearChargingProfile.req", result.payload),
      ).not.toThrow();
    });

    it("names the station-wide maximum ChargePointMaxProfile", async () => {
      const result = await down["ocpp2.1:ClearChargingProfile"](
        {
          chargingProfileCriteria: {
            chargingProfilePurpose: "ChargingStationMaxProfile",
          },
        },
        makeCtx(),
      );
      expect(result.payload.chargingProfilePurpose).toBe(
        "ChargePointMaxProfile",
      );
      expect(() =>
        v16.validate(
          "urn:ClearChargingProfile.req",
          JSON.parse(JSON.stringify(result.payload)),
        ),
      ).not.toThrow();
    });

    // Leaving the purpose out would clear every profile on the connector.
    it("refuses a purpose 1.6 has not with NotSupported", async () => {
      await expect(
        down["ocpp2.1:ClearChargingProfile"](
          {
            chargingProfileCriteria: {
              chargingProfilePurpose: "PriorityCharging",
            },
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ rpcErrorCode: "NotSupported" });
    });
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
