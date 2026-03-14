import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OCPPServer, OCPPClient } from "ocpp-ws-io";
import { OCPPProtocolProxy } from "../src/proxy.js";
import { presets } from "../src/presets.js";

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
        idTagInfo: { status: "Accepted" },
      }));
    });

    const csmsHttp = await csmsServer.listen(0);
    upstreamPort = getPort(csmsHttp);

    // 2. Boot up Proxy
    proxy = new OCPPProtocolProxy({
      listenPort: 0, // Auto-assign later
      listenProtocols: ["ocpp1.6"],
      upstreamEndpoint: `ws://localhost:${upstreamPort}`,
      upstreamProtocol: "ocpp2.1",
    });

    proxy.translate({
      upstream: { ...presets.ocpp16_to_ocpp21.upstream },
      downstream: { ...presets.ocpp16_to_ocpp21.downstream },
      responses: { ...presets.ocpp16_to_ocpp21.responses },
    });

    // Hack internal server to get dynamic port
    // @ts-ignore
    const proxyHttp = await proxy.server.listen(0);
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
      const res = await mockCharger.call<any>("BootNotification", {
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

  it("should translate Upstream StartTransaction to TransactionEvent Started transparently", async () => {
    // Fire a 1.6 start transaction
    const res = await mockCharger.call<any>("StartTransaction", {
      connectorId: 1,
      idTag: "DEADBEEF",
      meterStart: 1234,
      timestamp: new Date().toISOString(),
    });

    // The proxy maps it to 2.1 TransactionEvent and receives TransactionEventResponse
    // The proxy maps it to 2.1 TransactionEvent and receives TransactionEventResponse
    // It maps that back to StartTransactionResponse
    expect(res).toHaveProperty("idTagInfo");
    expect((res as any).idTagInfo).toHaveProperty("status", "Accepted");
    expect(res).toHaveProperty("transactionId");
  });

  it("should translate Downstream SetChargingProfile transparently", async () => {
    // 1. Mock the EVSE side to handle SetChargingProfile
    mockCharger.handle("SetChargingProfile", () => ({
      status: "Accepted",
    }));

    // 2. We need the upstream proxy client that connected to the CSMS
    // To grab it, let's just cheat and find the proxy's client connection
    const proxyClient = Array.from(
      (csmsServer as any).clients.values(),
    )[0] as any;

    // 3. Fire the CALL from CSMS to the Proxy
    const res = await proxyClient.call("SetChargingProfile", {
      evseId: 1,
      chargingProfile: {
        id: 1,
        stackLevel: 0,
        chargingProfilePurpose: "TxDefaultProfile",
        transactionId: "tx-1234",
        chargingSchedule: [],
      },
    });

    expect(res).toHaveProperty("status", "Accepted");
  });
});
