import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OCPPServer, OCPPClient } from "../../src/index.js";
import { createRPCError } from "../../src/core/util.js";
import { getStandardValidator } from "../../src/core/validation/standard-validators.js";
import type { OCPPRequestType } from "../../src/generated/index.js";
import { OCPPProtocolProxy } from "../../src/proxy/proxy.js";
import { OcppWsIoAdapter } from "../../src/proxy/adapters/ocpp-ws-io.adapter.js";
import { presets } from "../../src/proxy/presets/index.js";

// Utility to get dynamic port
const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

describe("OCPPProtocolProxy Integration", () => {
  let csmsServer: OCPPServer;
  let proxy: OCPPProtocolProxy;
  let mockCharger: OCPPClient;
  let upstreamPort: number;
  let proxyPort: number;

  beforeAll(async () => {
    // 1. Boot up mock 2.1 CSMS
    csmsServer = new OCPPServer({ protocols: ["ocpp2.1"] });
    csmsServer.auth((ctx) => ctx.accept({ protocol: "ocpp2.1" }));

    csmsServer.on("client", (client) => {
      client.reconfigure({ strictMode: false });
      client.on("error", (err) => console.error("CSMS ERROR:", err));
      client.on("badMessage", (err) => console.error("CSMS BAD MSG:", err));
      client.handle("BootNotification", () => ({
        currentTime: new Date().toISOString(),
        interval: 300,
        status: "Accepted",
      }));

      client.handle("TransactionEvent", () => ({
        idTokenInfo: { status: "Blocked" },
      }));

      // A CALLERROR with a code only 2.x has (1.6 calls it FormationViolation).
      // rpcErrorMessage carries the description onto the wire: a thrown
      // FormatViolation would send its class's default text instead (O26).
      client.handle("DataTransfer", () => {
        throw Object.assign(createRPCError("FormatViolation", "csms says no"), {
          rpcErrorMessage: "csms says no",
        });
      });
    });

    const csmsHttp = await csmsServer.listen(0);
    upstreamPort = getPort(csmsHttp);

    // 2. Boot up Proxy
    proxy = new OCPPProtocolProxy({
      upstreamEndpoint: `ws://localhost:${upstreamPort}`,
      upstreamProtocol: "ocpp2.1",
    });

    const adapter = new OcppWsIoAdapter({
      port: 0, // Auto-assign later
      protocols: ["ocpp1.6"],
    });

    proxy.translate({
      upstream: { ...presets.ocpp16_to_ocpp21.upstream },
      downstream: { ...presets.ocpp16_to_ocpp21.downstream },
      responses: { ...presets.ocpp16_to_ocpp21.responses },
      errors: { ...presets.ocpp16_to_ocpp21.errors },
    });

    await proxy.listenOnAdapter(adapter);
    
    // Get dynamic port
    const proxyHttp = adapter.httpServer;
    if (!proxyHttp) throw new Error("the adapter is not listening");
    proxyPort = getPort(proxyHttp);

    // 3. Connect 1.6 Charger to Proxy
    mockCharger = new OCPPClient({
      identity: "TEST-CP-1",
      endpoint: `ws://localhost:${proxyPort}`,
      protocols: ["ocpp1.6"],
      reconnect: false,
    });

    await mockCharger.connect();
  });

  afterAll(async () => {
    if (mockCharger) await mockCharger.close({ force: true }).catch(() => {});
    if (proxy) await proxy.close();
    if (csmsServer) await csmsServer.close({ force: true });
  });

  it("should translate Upstream BootNotification transparently", async () => {
    try {
      const res = await mockCharger.call("BootNotification", {
        chargePointVendor: "ACME",
        chargePointModel: "EV-123",
        firmwareVersion: "1.0",
        chargePointSerialNumber: "SN12345",
      });

      expect(res).toHaveProperty("currentTime");
      expect(res).toHaveProperty("interval");
      expect(res).toHaveProperty("status", "Accepted");
    } catch (e) {
      console.error("TEST FAILED WITH ERROR:", e);
      throw e;
    }
  });

  it("passes a CSMS CALLERROR on to the charger in 1.6's terms", async () => {
    await expect(
      mockCharger.call("DataTransfer", { vendorId: "ACME" }),
    ).rejects.toMatchObject({
      rpcErrorCode: "FormationViolation",
      message: "csms says no",
    });
  });

  it("should translate Upstream StartTransaction to TransactionEvent Started transparently", async () => {
    // Fire a 1.6 start transaction
    const res = await mockCharger.call("StartTransaction", {
      connectorId: 1,
      idTag: "DEADBEEF",
      meterStart: 1234,
      timestamp: new Date().toISOString(),
    });

    // The proxy maps it to 2.1 TransactionEvent and receives TransactionEventResponse
    // The proxy maps it to 2.1 TransactionEvent and receives TransactionEventResponse
    // It maps that back to StartTransactionResponse
    expect(res).toHaveProperty("idTagInfo");
    expect(res.idTagInfo).toHaveProperty("status", "Blocked");
    expect(res).toHaveProperty("transactionId");
  });

  /** A 2.1 SetChargingProfile with one schedule, as the CSMS sends it. */
  const setChargingProfile = (
    chargingProfilePurpose: "TxDefaultProfile" | "PriorityCharging",
  ): OCPPRequestType<"ocpp2.1", "SetChargingProfile"> => ({
    evseId: 1,
    chargingProfile: {
      id: 1,
      stackLevel: 0,
      chargingProfilePurpose,
      chargingProfileKind: "Absolute",
      chargingSchedule: [
        {
          id: 1,
          chargingRateUnit: "A",
          chargingSchedulePeriod: [{ startPeriod: 0, limit: 16 }],
        },
      ],
    },
  });

  it("should translate Downstream SetChargingProfile transparently", async () => {
    // 1. Mock the EVSE side to handle SetChargingProfile, checking the request
    // against the OCA 1.6 schema as a validating charger does
    const received: string[] = [];
    mockCharger.handle("SetChargingProfile", (ctx) => {
      getStandardValidator("ocpp1.6")!.validate(
        "urn:SetChargingProfile.req",
        ctx.params,
      );
      received.push(JSON.stringify(ctx.params));
      return { status: "Accepted" };
    });

    // 2. The upstream client the proxy opened is the CSMS's only client
    const [proxyClient] = csmsServer.clients;
    if (!proxyClient) throw new Error("the proxy has not connected");

    // 3. Fire the CALL from CSMS to the Proxy
    const res = await proxyClient.call(
      "SetChargingProfile",
      setChargingProfile("TxDefaultProfile"),
    );

    expect(res).toHaveProperty("status", "Accepted");
    expect(received.map((r) => JSON.parse(r))).toEqual([
      {
        connectorId: 1,
        csChargingProfiles: {
          chargingProfileId: 1,
          stackLevel: 0,
          chargingProfilePurpose: "TxDefaultProfile",
          chargingProfileKind: "Absolute",
          chargingSchedule: {
            chargingRateUnit: "A",
            chargingSchedulePeriod: [{ startPeriod: 0, limit: 16 }],
          },
        },
      },
    ]);
  });

  it("answers a 1.6 NotSupported to SetChargingProfile with Rejected", async () => {
    mockCharger.removeHandler("SetChargingProfile");
    mockCharger.handle("SetChargingProfile", () => ({
      status: "NotSupported",
    }));
    const [proxyClient] = csmsServer.clients;
    if (!proxyClient) throw new Error("the proxy has not connected");

    const res = await proxyClient.call(
      "SetChargingProfile",
      setChargingProfile("TxDefaultProfile"),
    );

    expect(res).toEqual({
      status: "Rejected",
      statusInfo: {
        reasonCode: "NotSupported",
        additionalInfo: "The OCPP 1.6 charger does not support it",
      },
    });
  });

  it("refuses a profile 1.6 cannot hold with NotSupported", async () => {
    const received: string[] = [];
    mockCharger.removeHandler("SetChargingProfile");
    mockCharger.handle("SetChargingProfile", (ctx) => {
      received.push(JSON.stringify(ctx.params));
      return { status: "Accepted" };
    });
    const [proxyClient] = csmsServer.clients;
    if (!proxyClient) throw new Error("the proxy has not connected");

    await expect(
      proxyClient.call(
        "SetChargingProfile",
        setChargingProfile("PriorityCharging"),
      ),
    ).rejects.toMatchObject({ rpcErrorCode: "NotSupported" });
    expect(received).toEqual([]);
  });

  it("answers GetCompositeSchedule with the 2.x schedule", async () => {
    mockCharger.handle("GetCompositeSchedule", () => ({
      status: "Accepted",
      connectorId: 1,
      scheduleStart: "2026-10-12T10:00:00Z",
      chargingSchedule: {
        duration: 600,
        chargingRateUnit: "A",
        chargingSchedulePeriod: [{ startPeriod: 0, limit: 16 }],
      },
    }));
    const [proxyClient] = csmsServer.clients;
    if (!proxyClient) throw new Error("the proxy has not connected");

    const res = await proxyClient.call("GetCompositeSchedule", {
      evseId: 1,
      duration: 600,
    });

    expect(res).toEqual({
      status: "Accepted",
      schedule: {
        evseId: 1,
        duration: 600,
        scheduleStart: "2026-10-12T10:00:00Z",
        chargingRateUnit: "A",
        chargingSchedulePeriod: [{ startPeriod: 0, limit: 16 }],
      },
    });
    expect(() =>
      getStandardValidator("ocpp2.1")!.validate(
        "urn:GetCompositeSchedule.conf",
        res,
      ),
    ).not.toThrow();
  });

  it("passes a charger's CALLERROR on to the CSMS in 2.x's terms", async () => {
    mockCharger.handle("Reset", () => {
      throw createRPCError("FormationViolation", "charger says no", {
        field: "type",
      });
    });
    const translationErrors: string[] = [];
    const onTranslationError = (err: Error) =>
      translationErrors.push(err.message);
    proxy.on("translationError", onTranslationError);
    const [proxyClient] = csmsServer.clients;
    if (!proxyClient) throw new Error("the proxy has not connected");

    try {
      await expect(
        proxyClient.call("Reset", { type: "Immediate" }),
      ).rejects.toMatchObject({
        rpcErrorCode: "FormatViolation",
        message: "charger says no",
        details: { field: "type" },
      });
      // A charger's refusal is an answer, not a failure to translate.
      expect(translationErrors).toEqual([]);
    } finally {
      proxy.off("translationError", onTranslationError);
    }
  });
});
