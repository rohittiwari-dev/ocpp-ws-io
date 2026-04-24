import { SetMetadata } from "@nestjs/common";
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

export const OcppMessageEvent = (
  action: string,
  protocol?: string,
): MethodDecorator =>
  SetMetadata(OCPP_MESSAGE_EVENT_METADATA, {
    action,
    protocol,
  } as OcppMessageEventMetadata);

export const OcppWildcardEvent = (): MethodDecorator =>
  SetMetadata(OCPP_WILDCARD_EVENT_METADATA, true);

export const OcppAuth = (): MethodDecorator =>
  SetMetadata(OCPP_AUTH_METADATA, true);

export const OcppConnectionMiddleware = (): MethodDecorator =>
  SetMetadata(OCPP_CONNECTION_MIDDLEWARE_METADATA, true);
