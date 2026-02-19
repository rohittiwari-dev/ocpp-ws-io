// Auto-generated index — DO NOT EDIT
/* eslint-disable */

import type { OCPP16Methods } from "./ocpp16.js";
import type { OCPP21Methods } from "./ocpp21.js";
import type { OCPP201Methods } from "./ocpp201.js";

/**
 * Maps OCPP protocol strings to their method type maps.
 * Used by OCPPClient<P> and OCPPServer to provide auto-typed
 * handle(), call(), and event listener signatures.
 */
export interface OCPPMethodMap {
  "ocpp1.6": OCPP16Methods;
  "ocpp2.0.1": OCPP201Methods;
  "ocpp2.1": OCPP21Methods;
}

/** All valid OCPP protocol strings (auto-generated, extensible via module augmentation). */
export type OCPPProtocolKey = keyof OCPPMethodMap;

/** All valid method names for a given protocol. */
export type OCPPMethodNames<P extends keyof OCPPMethodMap> = string &
  keyof OCPPMethodMap[P];

/** Distributes over union protocols to get all method names. */
export type AllMethodNames<P extends keyof OCPPMethodMap> =
  P extends keyof OCPPMethodMap ? keyof OCPPMethodMap[P] & string : never;

/** Request type for a given protocol + method. */
export type OCPPRequestType<
  P extends keyof OCPPMethodMap,
  M extends string,
> = P extends keyof OCPPMethodMap
  ? M extends keyof OCPPMethodMap[P]
    ? OCPPMethodMap[P][M] extends { request: infer R }
      ? R
      : never
    : never
  : never;

/** Response type for a given protocol + method. */
export type OCPPResponseType<
  P extends keyof OCPPMethodMap,
  M extends string,
> = P extends keyof OCPPMethodMap
  ? M extends keyof OCPPMethodMap[P]
    ? OCPPMethodMap[P][M] extends { response: infer R }
      ? R
      : never
    : never
  : never;
