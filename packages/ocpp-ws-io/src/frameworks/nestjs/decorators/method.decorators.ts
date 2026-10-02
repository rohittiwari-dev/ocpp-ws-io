import { SetMetadata } from "@nestjs/common";
import type {
  AllMethodNames,
  SendMethodNames,
} from "../../../generated/index.js";
import type {
  AnyOCPPProtocol,
  OCPPProtocol,
  UncheckedAction,
} from "../../../types.js";
import {
  OCPP_AUTH_METADATA,
  OCPP_CONNECTION_MIDDLEWARE_METADATA,
  OCPP_MESSAGE_EVENT_METADATA,
  OCPP_WILDCARD_EVENT_METADATA,
} from "../constants.js";

export interface OcppMessageEventMetadata {
  action: string;
  protocol?: string;
}

/**
 * Handles an OCPP action: \`@OcppMessageEvent("BootNotification")\`, or for one
 * protocol, \`@OcppMessageEvent("BootNotification", "ocpp1.6")\`. The action must
 * exist (in that protocol, when one is given); a misspelt name used to
 * register a handler nothing called. For an action the types do not know:
 * \`@OcppMessageEvent(unchecked("VendorPing"))\`.
 */
export function OcppMessageEvent(
  action: AllMethodNames<OCPPProtocol> | SendMethodNames<OCPPProtocol>,
): MethodDecorator;
export function OcppMessageEvent<V extends OCPPProtocol>(
  action: AllMethodNames<V> | SendMethodNames<V>,
  protocol: V,
): MethodDecorator;
export function OcppMessageEvent(
  action: UncheckedAction,
  protocol?: AnyOCPPProtocol,
): MethodDecorator;
export function OcppMessageEvent(
  action: string,
  protocol?: string,
): MethodDecorator {
  return SetMetadata(OCPP_MESSAGE_EVENT_METADATA, {
    action,
    protocol,
  } as OcppMessageEventMetadata);
}

export const OcppWildcardEvent = (): MethodDecorator =>
  SetMetadata(OCPP_WILDCARD_EVENT_METADATA, true);

export const OcppAuth = (): MethodDecorator =>
  SetMetadata(OCPP_AUTH_METADATA, true);

export const OcppConnectionMiddleware = (): MethodDecorator =>
  SetMetadata(OCPP_CONNECTION_MIDDLEWARE_METADATA, true);
