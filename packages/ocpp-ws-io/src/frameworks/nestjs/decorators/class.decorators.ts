import { SetMetadata } from "@nestjs/common";
import type { MiddlewareFunction } from "../../../middleware.js";
import type { CORSOptions } from "../../../types.js";
import {
  OCPP_CORS_METADATA,
  OCPP_GATEWAY_METADATA,
  OCPP_RPC_MIDDLEWARE_METADATA,
} from "../constants.js";
import type { OcppGatewayOptions } from "../interfaces.js";

export const OcppGateway = (
  pathOrOptions?: string | OcppGatewayOptions,
): ClassDecorator => {
  const options =
    typeof pathOrOptions === "string"
      ? { path: pathOrOptions }
      : pathOrOptions || {};
  return SetMetadata(OCPP_GATEWAY_METADATA, options);
};

export const OcppCors = (options: CORSOptions): ClassDecorator =>
  SetMetadata(OCPP_CORS_METADATA, options);

export const UseOcppRpcMiddleware = (
  ...middlewares: MiddlewareFunction<any>[]
): ClassDecorator => SetMetadata(OCPP_RPC_MIDDLEWARE_METADATA, middlewares);
