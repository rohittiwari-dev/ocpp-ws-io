import type { TranslationMap } from "./proxy.js";

export const presets = {
  ocpp16_to_ocpp21: {
    upstream: {
      "ocpp1.6:BootNotification": (params) => ({
        action: "BootNotification",
        payload: {
          reason: "PowerUp",
          chargingStation: {
            model: params.chargePointModel,
            vendorName: params.chargePointVendor,
            firmwareVersion: params.firmwareVersion,
            serialNumber: params.chargePointSerialNumber,
          },
        },
      }),
      "ocpp1.6:Heartbeat": () => ({
        action: "Heartbeat",
        payload: {},
      }),
      "ocpp1.6:StatusNotification": (params) => ({
        action: "StatusNotification",
        payload: {
          timestamp: params.timestamp || new Date().toISOString(),
          connectorStatus: params.status,
          evseId: params.connectorId,
          connectorId: params.connectorId, // Usually 1:1 in 1.6
        },
      }),
      "ocpp1.6:Authorize": (params) => ({
        action: "Authorize",
        payload: {
          idToken: {
            idToken: params.idTag,
            type: "ISO14443", // Default guess
          },
        },
      }),
      "ocpp1.6:StartTransaction": (params) => ({
        action: "TransactionEvent",
        payload: {
          eventType: "Started",
          timestamp: params.timestamp,
          triggerReason: "Authorized",
          seqNo: 1,
          transactionInfo: {
            transactionId: `tx-${params.meterStart}-${Date.now()}`, // 2.x uses string UUIDs
          },
          idToken: {
            idToken: params.idTag,
            type: "ISO14443",
          },
          evse: {
            id: params.connectorId,
            connectorId: params.connectorId,
          },
          meterValue: [
            {
              timestamp: params.timestamp,
              sampledValue: [{ value: params.meterStart }],
            },
          ],
        },
      }),
    },
    downstream: {
      "ocpp2.1:SetChargingProfile": (params) => ({
        action: "SetChargingProfile",
        payload: {
          connectorId: params.evseId,
          csChargingProfiles: params.chargingProfile, // Highly simplified, actual mapping is complex
        },
      }),
    },
    responses: {
      "ocpp2.1:BootNotificationResponse": (params: any) => ({
        currentTime: params.currentTime,
        interval: params.interval,
        status: params.status,
      }),
      "ocpp2.1:HeartbeatResponse": (params: any) => ({
        currentTime: params.currentTime,
      }),
      "ocpp2.1:StatusNotificationResponse": () => ({}),
      "ocpp2.1:AuthorizeResponse": (params: any) => ({
        idTagInfo: {
          status: params.idTokenInfo.status,
        },
      }),
      "ocpp2.1:TransactionEventResponse": (params: any) => ({
        // StartTransactionResponse mapping
        idTagInfo: {
          status: params.idTokenInfo?.status || "Accepted",
        },
        transactionId: Number.parseInt(
          params._txId?.replace("tx-", "") || "1",
          10,
        ), // Hacky reverse map for example
      }),
    },
  } as TranslationMap,
};
