import { describe, it, expect } from "vitest";
import { InMemorySessionStore } from "../../src/core/session.js";
import type { TranslationContext } from "../../src/core/types.js";
import { corePreset } from "../../src/presets/core.js";
import {
  availabilityMap16to21,
  availabilityMap21to16,
  statusMap16to21,
  statusMap21to16,
} from "../../src/presets/status-enums.js";

function makeCtx(overrides?: Partial<TranslationContext>): TranslationContext {
  return {
    identity: "test-cp",
    sourceProtocol: "ocpp1.6",
    targetProtocol: "ocpp2.1",
    session: new InMemorySessionStore(),
    ...overrides,
  };
}

describe("Status Enum Mappings", () => {
  it("should map all 1.6 statuses to 2.1", () => {
    expect(statusMap16to21["Available"]).toBe("Available");
    expect(statusMap16to21["Preparing"]).toBe("Occupied");
    expect(statusMap16to21["Charging"]).toBe("Occupied");
    expect(statusMap16to21["SuspendedEVSE"]).toBe("Occupied");
    expect(statusMap16to21["SuspendedEV"]).toBe("Occupied");
    expect(statusMap16to21["Finishing"]).toBe("Occupied");
    expect(statusMap16to21["Reserved"]).toBe("Reserved");
    expect(statusMap16to21["Unavailable"]).toBe("Unavailable");
    expect(statusMap16to21["Faulted"]).toBe("Faulted");
  });

  it("should map all 2.1 statuses back to 1.6", () => {
    expect(statusMap21to16["Available"]).toBe("Available");
    expect(statusMap21to16["Occupied"]).toBe("Charging");
    expect(statusMap21to16["Reserved"]).toBe("Reserved");
    expect(statusMap21to16["Unavailable"]).toBe("Unavailable");
    expect(statusMap21to16["Faulted"]).toBe("Faulted");
  });

  it("should map availability types bidirectionally", () => {
    expect(availabilityMap21to16["Operative"]).toBe("Available");
    expect(availabilityMap21to16["Inoperative"]).toBe("Unavailable");
    expect(availabilityMap16to21["Available"]).toBe("Operative");
    expect(availabilityMap16to21["Unavailable"]).toBe("Inoperative");
  });
});

describe("Core Preset — Upstream", () => {
  const up = corePreset.upstream!;

  it("BootNotification: maps chargePoint fields to chargingStation", async () => {
    const result = await up["ocpp1.6:BootNotification"](
      {
        chargePointVendor: "ACME",
        chargePointModel: "EV-123",
        firmwareVersion: "1.0",
        chargePointSerialNumber: "SN001",
      },
      makeCtx(),
    );
    expect(result).toEqual({
      action: "BootNotification",
      payload: {
        reason: "PowerUp",
        chargingStation: {
          model: "EV-123",
          vendorName: "ACME",
          firmwareVersion: "1.0",
          serialNumber: "SN001",
        },
      },
    });
  });

  it("Heartbeat: returns empty payload", async () => {
    const result = await up["ocpp1.6:Heartbeat"]({}, makeCtx());
    expect(result).toEqual({ action: "Heartbeat", payload: {} });
  });

  it("StatusNotification: maps status via enum table", async () => {
    const result = await up["ocpp1.6:StatusNotification"](
      { connectorId: 1, status: "Charging", timestamp: "2026-01-01T00:00:00Z" },
      makeCtx(),
    );
    expect(result.payload.connectorStatus).toBe("Occupied");
    expect(result.payload.evseId).toBe(1);
  });

  it("StatusNotification: passes through unknown statuses", async () => {
    const result = await up["ocpp1.6:StatusNotification"](
      { connectorId: 1, status: "CustomStatus" },
      makeCtx(),
    );
    expect(result.payload.connectorStatus).toBe("CustomStatus");
  });

  it("Authorize: maps idTag to idToken object", async () => {
    const result = await up["ocpp1.6:Authorize"](
      { idTag: "DEADBEEF" },
      makeCtx(),
    );
    expect(result.payload.idToken).toEqual({
      idToken: "DEADBEEF",
      type: "ISO14443",
    });
  });

  it("StartTransaction: generates UUID and stores in session", async () => {
    const ctx = makeCtx();
    const result = await up["ocpp1.6:StartTransaction"](
      {
        connectorId: 1,
        idTag: "TAG1",
        meterStart: 100,
        timestamp: "2026-01-01T00:00:00Z",
      },
      ctx,
    );

    expect(result.action).toBe("TransactionEvent");
    expect(result.payload.eventType).toBe("Started");
    expect(result.payload.transactionInfo.transactionId).toMatch(
      /^[0-9a-f]{8}-/,
    );

    const pending = await ctx.session.get(ctx.identity, "pendingStartTx");
    expect(pending).toBeDefined();
    expect(pending.uuid).toBe(result.payload.transactionInfo.transactionId);
  });

  it("StopTransaction: looks up UUID from session", async () => {
    const ctx = makeCtx();
    await ctx.session.set(ctx.identity, "txId_int2uuid_42", "some-uuid-123");

    const result = await up["ocpp1.6:StopTransaction"](
      {
        transactionId: 42,
        meterStop: 500,
        timestamp: "2026-01-01T01:00:00Z",
        reason: "EVDisconnected",
      },
      ctx,
    );

    expect(result.action).toBe("TransactionEvent");
    expect(result.payload.eventType).toBe("Ended");
    expect(result.payload.transactionInfo.transactionId).toBe("some-uuid-123");
    expect(result.payload.transactionInfo.stoppedReason).toBe("EVDisconnected");
  });

  it("MeterValues: maps sampledValue array with measurand", async () => {
    const ctx = makeCtx();
    await ctx.session.set(ctx.identity, "txId_int2uuid_10", "tx-uuid-abc");

    const result = await up["ocpp1.6:MeterValues"](
      {
        connectorId: 1,
        transactionId: 10,
        meterValue: [
          {
            timestamp: "2026-01-01T00:30:00Z",
            sampledValue: [{ value: 250, measurand: "Power.Active.Import" }],
          },
        ],
      },
      ctx,
    );

    expect(result.action).toBe("TransactionEvent");
    expect(result.payload.eventType).toBe("Updated");
    expect(result.payload.transactionInfo.transactionId).toBe("tx-uuid-abc");
    expect(result.payload.meterValue[0].sampledValue[0].value).toBe(250);
    expect(result.payload.meterValue[0].sampledValue[0].measurand).toBe(
      "Power.Active.Import",
    );
  });
});

describe("Core Preset — Downstream", () => {
  const down = corePreset.downstream!;

  it("ChangeAvailability: maps operationalStatus to type", async () => {
    const result = await down["ocpp2.1:ChangeAvailability"](
      { evse: { id: 1, connectorId: 1 }, operationalStatus: "Operative" },
      makeCtx(),
    );
    expect(result.payload.connectorId).toBe(1);
    expect(result.payload.type).toBe("Operative");
  });

  it("Reset: maps OnIdle to Soft", async () => {
    const result = await down["ocpp2.1:Reset"](
      { type: "OnIdle" },
      makeCtx(),
    );
    expect(result.payload.type).toBe("Soft");
  });

  it("Reset: passes through Immediate/Hard", async () => {
    const result = await down["ocpp2.1:Reset"](
      { type: "Immediate" },
      makeCtx(),
    );
    expect(result.payload.type).toBe("Immediate");
  });

  it("UnlockConnector: extracts connectorId", async () => {
    const result = await down["ocpp2.1:UnlockConnector"](
      { evseId: 1, connectorId: 2 },
      makeCtx(),
    );
    expect(result.payload.connectorId).toBe(2);
  });

  it("TriggerMessage: maps evse to connectorId", async () => {
    const result = await down["ocpp2.1:TriggerMessage"](
      { requestedMessage: "BootNotification", evse: { id: 1, connectorId: 3 } },
      makeCtx(),
    );
    expect(result.payload.requestedMessage).toBe("BootNotification");
    expect(result.payload.connectorId).toBe(3);
  });

  it("RemoteStopTransaction: looks up UUID→int from session", async () => {
    const ctx = makeCtx();
    await ctx.session.set(ctx.identity, "txId_uuid2int_my-uuid", 42);

    const result = await down["ocpp2.1:RemoteStopTransaction"](
      { transactionId: "my-uuid" },
      ctx,
    );
    expect(result.payload.transactionId).toBe(42);
  });

  it("RemoteStopTransaction: returns 0 for unknown UUID", async () => {
    const result = await down["ocpp2.1:RemoteStopTransaction"](
      { transactionId: "unknown-uuid" },
      makeCtx(),
    );
    expect(result.payload.transactionId).toBe(0);
  });
});

describe("Core Preset — Responses", () => {
  const res = corePreset.responses!;

  it("BootNotificationResponse: passes through all fields", async () => {
    const result = await res["ocpp2.1:BootNotificationResponse"](
      { currentTime: "2026-01-01T00:00:00Z", interval: 300, status: "Accepted" },
      makeCtx(),
    );
    expect(result).toEqual({
      currentTime: "2026-01-01T00:00:00Z",
      interval: 300,
      status: "Accepted",
    });
  });

  it("AuthorizeResponse: maps idTokenInfo to idTagInfo", async () => {
    const result = await res["ocpp2.1:AuthorizeResponse"](
      { idTokenInfo: { status: "Accepted" } },
      makeCtx(),
    );
    expect(result.idTagInfo.status).toBe("Accepted");
  });

  it("TransactionEventResponse: creates bidirectional ID mapping", async () => {
    const ctx = makeCtx();
    await ctx.session.set(ctx.identity, "pendingStartTx", {
      uuid: "test-uuid-abc",
      connectorId: 1,
    });

    const result = await res["ocpp2.1:TransactionEventResponse"](
      { idTokenInfo: { status: "Accepted" } },
      ctx,
    );

    expect(result.idTagInfo.status).toBe("Accepted");
    expect(typeof result.transactionId).toBe("number");

    const storedUuid = await ctx.session.get(
      ctx.identity,
      `txId_int2uuid_${result.transactionId}`,
    );
    const storedInt = await ctx.session.get(
      ctx.identity,
      "txId_uuid2int_test-uuid-abc",
    );
    expect(storedUuid).toBe("test-uuid-abc");
    expect(storedInt).toBe(result.transactionId);

    const pending = await ctx.session.get(ctx.identity, "pendingStartTx");
    expect(pending).toBeUndefined();
  });
});

describe("Core Preset — Error Mapping", () => {
  const errors = corePreset.errors!;

  it("maps SecurityError to InternalError", async () => {
    const result = await errors["ocpp2.1:Error"](
      "SecurityError", "desc", {}, makeCtx(),
    );
    expect(result.errorCode).toBe("InternalError");
  });

  it("maps FormatViolation to FormationViolation", async () => {
    const result = await errors["ocpp2.1:Error"](
      "FormatViolation", "desc", {}, makeCtx(),
    );
    expect(result.errorCode).toBe("FormationViolation");
  });

  it("maps RpcFrameworkError to InternalError", async () => {
    const result = await errors["ocpp2.1:Error"](
      "RpcFrameworkError", "desc", {}, makeCtx(),
    );
    expect(result.errorCode).toBe("InternalError");
  });

  it("falls back to InternalError for unknown codes", async () => {
    const result = await errors["ocpp2.1:Error"](
      "CompletelyUnknown", "desc", {}, makeCtx(),
    );
    expect(result.errorCode).toBe("InternalError");
  });
});
