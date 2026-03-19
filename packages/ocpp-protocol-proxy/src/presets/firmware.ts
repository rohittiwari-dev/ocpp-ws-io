import type { TranslationMap } from "../core/types.js";

/**
 * Firmware Management profile preset.
 * Note: OCPP 2.1 renames GetDiagnostics→GetLog and
 * DiagnosticsStatusNotification→LogStatusNotification.
 */
export const firmwarePreset: Partial<TranslationMap> = {
  upstream: {
    "ocpp1.6:FirmwareStatusNotification": (params) => ({
      action: "FirmwareStatusNotification",
      payload: {
        status: params.status,
      },
    }),
    "ocpp1.6:DiagnosticsStatusNotification": (params) => ({
      action: "LogStatusNotification",
      payload: {
        status: params.status === "Uploaded" ? "Uploaded" : params.status,
        requestId: 0,
      },
    }),
  },
  downstream: {
    "ocpp2.1:UpdateFirmware": (params) => ({
      action: "UpdateFirmware",
      payload: {
        location: params.firmware?.location || params.location,
        retrieveDate: params.firmware?.retrieveDateTime || params.retrieveDate,
        retries: params.retries,
        retryInterval: params.retryInterval,
      },
    }),
    "ocpp2.1:GetLog": (params) => ({
      action: "GetDiagnostics",
      payload: {
        location: params.log?.remoteLocation || "",
        startTime: params.log?.oldestTimestamp,
        stopTime: params.log?.latestTimestamp,
        retries: params.retries,
        retryInterval: params.retryInterval,
      },
    }),
  },
};
