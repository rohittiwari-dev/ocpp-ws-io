import type { TranslationMap } from "../core/types.js";

/**
 * Reservation profile preset.
 */
export const reservationPreset: Partial<TranslationMap> = {
  downstream: {
    "ocpp2.1:ReserveNow": (params) => ({
      action: "ReserveNow",
      payload: {
        connectorId: params.evseId || 0,
        expiryDate: params.expiryDateTime,
        idTag: params.idToken?.idToken,
        reservationId: params.id,
      },
    }),
    "ocpp2.1:CancelReservation": (params) => ({
      action: "CancelReservation",
      payload: {
        reservationId: params.reservationId,
      },
    }),
  },
};
