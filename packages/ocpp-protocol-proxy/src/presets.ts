import { randomUUID } from "node:crypto";
import type { TranslationMap } from "./core/types.js";

/**
 * Auto-incrementing transaction ID counter.
 * In production, this should come from a persistent store (e.g. Redis INCR).
 */
let txIdCounter = 1;

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
          connectorId: params.connectorId,
        },
      }),
      "ocpp1.6:Authorize": (params) => ({
        action: "Authorize",
        payload: {
          idToken: {
            idToken: params.idTag,
            type: "ISO14443",
          },
        },
      }),
      "ocpp1.6:StartTransaction": async (params, ctx) => {
        const proxyGeneratedTxId = randomUUID();
        await ctx.session.set(ctx.identity, "pendingStartTx", {
          uuid: proxyGeneratedTxId,
          connectorId: params.connectorId,
        });

        return {
          action: "TransactionEvent",
          payload: {
            eventType: "Started",
            timestamp: params.timestamp || new Date().toISOString(),
            triggerReason: "Authorized",
            seqNo: 0,
            transactionInfo: {
              transactionId: proxyGeneratedTxId,
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
                timestamp: params.timestamp || new Date().toISOString(),
                sampledValue: [
                  {
                    value: params.meterStart,
                    measurand: "Energy.Active.Import.Register",
                  },
                ],
              },
            ],
          },
        };
      },
      "ocpp1.6:StopTransaction": async (params, ctx) => {
        const numericId = params.transactionId;
        const uuid = await ctx.session.get<string>(
          ctx.identity,
          `txId_int2uuid_${numericId}`,
        );

        return {
          action: "TransactionEvent",
          payload: {
            eventType: "Ended",
            timestamp: params.timestamp || new Date().toISOString(),
            triggerReason: params.reason || "Local",
            seqNo: 1,
            transactionInfo: {
              transactionId: uuid || randomUUID(),
              stoppedReason: params.reason || "Local",
            },
            idToken: params.idTag
              ? {
                  idToken: params.idTag,
                  type: "ISO14443",
                }
              : undefined,
            meterValue: [
              {
                timestamp: params.timestamp || new Date().toISOString(),
                sampledValue: [
                  {
                    value: params.meterStop,
                    measurand: "Energy.Active.Import.Register",
                  },
                ],
              },
            ],
          },
        };
      },
      "ocpp1.6:MeterValues": async (params, ctx) => {
        const numericId = params.transactionId;
        const uuid = numericId
          ? await ctx.session.get<string>(
              ctx.identity,
              `txId_int2uuid_${numericId}`,
            )
          : undefined;

        return {
          action: "TransactionEvent",
          payload: {
            eventType: "Updated",
            timestamp: new Date().toISOString(),
            triggerReason: "MeterValuePeriodic",
            seqNo: 0,
            transactionInfo: uuid
              ? {
                  transactionId: uuid,
                }
              : undefined,
            evse: {
              id: params.connectorId,
              connectorId: params.connectorId,
            },
            meterValue: (params.meterValue || []).map((mv: any) => ({
              timestamp: mv.timestamp,
              sampledValue: (mv.sampledValue || []).map((sv: any) => ({
                value: sv.value,
                measurand: sv.measurand || "Energy.Active.Import.Register",
                unit: sv.unit,
                context: sv.context,
                location: sv.location,
              })),
            })),
          },
        };
      },
    },
    downstream: {
      "ocpp2.1:SetChargingProfile": (params) => ({
        action: "SetChargingProfile",
        payload: {
          connectorId: params.evseId,
          csChargingProfiles: params.chargingProfile,
        },
      }),
      "ocpp2.1:RemoteStartTransaction": (params) => ({
        action: "RemoteStartTransaction",
        payload: {
          connectorId: params.evseId || 1,
          idTag: params.idToken?.idToken,
        },
      }),
      "ocpp2.1:RemoteStopTransaction": async (params, ctx) => {
        // CSMS sends a string UUID transactionId in 2.1
        // We need to find the integer ID we gave to the 1.6 EVSE
        const uuid = params.transactionId;
        const numericId = uuid
          ? await ctx.session.get<number>(ctx.identity, `txId_uuid2int_${uuid}`)
          : undefined;

        return {
          action: "RemoteStopTransaction",
          payload: {
            transactionId: numericId ?? 0,
          },
        };
      },
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
          status: params.idTokenInfo?.status || "Accepted",
        },
      }),
      "ocpp2.1:TransactionEventResponse": async (params: any, ctx: any) => {
        const pending = await ctx.session.get(ctx.identity, "pendingStartTx");
        const numericTxId = txIdCounter++;

        if (pending) {
          await ctx.session.set(
            ctx.identity,
            `txId_int2uuid_${numericTxId}`,
            pending.uuid,
          );
          await ctx.session.set(
            ctx.identity,
            `txId_uuid2int_${pending.uuid}`,
            numericTxId,
          );
          await ctx.session.delete(ctx.identity, "pendingStartTx");
        }

        return {
          idTagInfo: {
            status: params.idTokenInfo?.status || "Accepted",
          },
          transactionId: numericTxId,
        };
      },
    },
    errors: {
      "ocpp2.1:Error": (
        errorCode: string,
        errorDescription: string,
        _errorDetails: any,
      ) => {
        const errorMap: Record<string, string> = {
          SecurityError: "InternalError",
          FormatViolation: "FormationViolation",
          MessageTypeNotSupported: "NotSupported",
          PropertyConstraintViolation: "PropertyConstraintViolation",
          OccurrenceConstraintViolation: "OccurenceConstraintViolation",
          TypeConstraintViolation: "TypeConstraintViolation",
          GenericError: "GenericError",
        };
        return {
          errorCode: errorMap[errorCode] || "InternalError",
          errorDescription,
          errorDetails: _errorDetails,
        };
      },
    },
  } as TranslationMap,
};
