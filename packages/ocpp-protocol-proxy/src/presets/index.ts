import type { TranslationMap } from "../core/types.js";
import { corePreset } from "./core.js";
import { firmwarePreset } from "./firmware.js";
import { localAuthPreset } from "./local-auth.js";
import { reservationPreset } from "./reservation.js";
import { smartChargingPreset } from "./smart-charging.js";

export { corePreset } from "./core.js";
export { firmwarePreset } from "./firmware.js";
export { localAuthPreset } from "./local-auth.js";
export { reservationPreset } from "./reservation.js";
export { smartChargingPreset } from "./smart-charging.js";
export * from "./status-enums.js";

/**
 * Merge multiple partial TranslationMaps into one.
 */
function mergePresets(...maps: Partial<TranslationMap>[]): TranslationMap {
  const merged: TranslationMap = {
    upstream: {},
    downstream: {},
    responses: {},
    errors: {},
  };

  for (const map of maps) {
    if (map.upstream) Object.assign(merged.upstream, map.upstream);
    if (map.downstream) Object.assign(merged.downstream, map.downstream);
    if (map.responses) Object.assign(merged.responses!, map.responses);
    if (map.errors) Object.assign(merged.errors!, map.errors);
  }

  return merged;
}

/**
 * Combined preset dictionary.
 * `presets.ocpp16_to_ocpp21` includes ALL profiles merged.
 *
 * For selective use, import individual presets:
 * ```ts
 * import { corePreset, smartChargingPreset } from "ocpp-protocol-proxy";
 * proxy.translate(corePreset);
 * proxy.translate(smartChargingPreset);
 * ```
 */
export const presets = {
  ocpp16_to_ocpp21: mergePresets(
    corePreset,
    smartChargingPreset,
    firmwarePreset,
    reservationPreset,
    localAuthPreset,
  ),
};
