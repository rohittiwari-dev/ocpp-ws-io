import { describe, it, expect } from "vitest";
import { InMemorySessionStore } from "../../src/core/session.js";
import type { TranslationContext } from "../../src/core/types.js";
import { localAuthPreset } from "../../src/presets/local-auth.js";
import { reservationPreset } from "../../src/presets/reservation.js";

function makeCtx(): TranslationContext {
  return {
    identity: "test-cp",
    sourceProtocol: "ocpp1.6",
    targetProtocol: "ocpp2.1",
    session: new InMemorySessionStore(),
  };
}

describe("Reservation Preset", () => {
  const down = reservationPreset.downstream!;

  it("ReserveNow: maps evseId, idToken, expiryDateTime", async () => {
    const result = await down["ocpp2.1:ReserveNow"](
      {
        id: 99,
        evseId: 2,
        expiryDateTime: "2026-01-01T12:00:00Z",
        idToken: { idToken: "RFID123", type: "ISO14443" },
      },
      makeCtx(),
    );
    expect(result.payload.reservationId).toBe(99);
    expect(result.payload.connectorId).toBe(2);
    expect(result.payload.expiryDate).toBe("2026-01-01T12:00:00Z");
    expect(result.payload.idTag).toBe("RFID123");
  });

  it("CancelReservation: passes through reservationId", async () => {
    const result = await down["ocpp2.1:CancelReservation"](
      { reservationId: 42 },
      makeCtx(),
    );
    expect(result.payload.reservationId).toBe(42);
  });
});

describe("Local Auth List Preset", () => {
  const down = localAuthPreset.downstream!;

  it("GetLocalListVersion: returns empty payload", async () => {
    const result = await down["ocpp2.1:GetLocalListVersion"]({}, makeCtx());
    expect(result.payload).toEqual({});
  });

  it("SendLocalList: maps idToken objects to idTag strings", async () => {
    const result = await down["ocpp2.1:SendLocalList"](
      {
        versionNumber: 5,
        updateType: "Full",
        localAuthorizationList: [
          {
            idToken: { idToken: "TAG-A", type: "ISO14443" },
            idTokenInfo: {
              status: "Accepted",
              cacheExpiryDateTime: "2027-01-01T00:00:00Z",
            },
          },
          {
            idToken: { idToken: "TAG-B", type: "ISO14443" },
          },
        ],
      },
      makeCtx(),
    );
    expect(result.payload.listVersion).toBe(5);
    expect(result.payload.updateType).toBe("Full");
    expect(result.payload.localAuthorizationList).toHaveLength(2);
    expect(result.payload.localAuthorizationList[0].idTag).toBe("TAG-A");
    expect(result.payload.localAuthorizationList[0].idTagInfo.status).toBe(
      "Accepted",
    );
    expect(result.payload.localAuthorizationList[1].idTag).toBe("TAG-B");
    expect(result.payload.localAuthorizationList[1].idTagInfo).toBeUndefined();
  });
});
