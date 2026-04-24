import type { DynamicModule, ForwardReference, Type } from "@nestjs/common";
import type { OCPPServerClient } from "../../server-client.js";
import type { RouterConfig, ServerOptions } from "../../types.js";

export interface OcppGatewayOptions extends RouterConfig {
  path?: string;
}

export type OcppModuleOptions = ServerOptions & {
  // Can be extended with Nest-specific global options if needed
};

export interface OcppModuleAsyncOptions {
  imports?: Array<
    Type<any> | DynamicModule | Promise<DynamicModule> | ForwardReference
  >;
  inject?: any[];
  useFactory?: (
    ...args: any[]
  ) => Promise<OcppModuleOptions> | OcppModuleOptions;
  useClass?: Type<any>;
  useExisting?: Type<any>;
}

export interface OnOcppClientConnected {
  onOcppClientConnected(client: OCPPServerClient): void | Promise<void>;
}

export interface OnOcppClientDisconnected {
  onOcppClientDisconnected(
    client: OCPPServerClient,
    code: number,
    reason: string,
  ): void | Promise<void>;
}

export interface OnOcppClientError {
  onOcppClientError(
    client: OCPPServerClient,
    error: Error,
  ): void | Promise<void>;
}

export enum OcppParamType {
  CLIENT = 0,
  MESSAGE = 1,
  PARAMS = 2,
  CONTEXT = 3,
  IDENTITY = 4,
  PATH = 5,
  SESSION = 6,
}
