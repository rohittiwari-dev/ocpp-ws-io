import type { TranslationMap } from "../core/types.js";

/**
 * Local Auth List Management profile preset.
 */
export const localAuthPreset: Partial<TranslationMap> = {
  downstream: {
    "ocpp2.1:GetLocalListVersion": () => ({
      action: "GetLocalListVersion",
      payload: {},
    }),
    "ocpp2.1:SendLocalList": (params) => ({
      action: "SendLocalList",
      payload: {
        listVersion: params.versionNumber,
        updateType: params.updateType,
        localAuthorizationList: (params.localAuthorizationList || []).map(
          (entry: any) => ({
            idTag: entry.idToken?.idToken,
            idTagInfo: entry.idTokenInfo
              ? {
                  status: entry.idTokenInfo.status,
                  expiryDate: entry.idTokenInfo.cacheExpiryDateTime,
                }
              : undefined,
          }),
        ),
      },
    }),
  },
};
