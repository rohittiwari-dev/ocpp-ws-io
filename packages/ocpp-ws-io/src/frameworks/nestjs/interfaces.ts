import type { IncomingMessage } from "node:http";
import type { DynamicModule, ForwardReference, Type } from "@nestjs/common";
import type { OCPPServerClient } from "../../server-client.js";
import type { RouterConfig, ServerOptions } from "../../types.js";

export interface OcppGatewayOptions extends RouterConfig {
  path?: string;
}

export interface OcppNestOptions {
  /**
   * Automatically attach the OCPP upgrade handler to Nest's HTTP server.
   * Defaults to true.
   */
  autoAttach?: boolean;
  /**
   * Only pass matching upgrade requests to OCPP. This is useful when the same
   * Nest app also owns Socket.IO or other WebSocket gateways.
   */
  upgradePathPrefix?: string | string[];
  /**
   * Advanced upgrade filter. Return true to let OCPP handle the request.
   */
  upgradeFilter?: (pathname: string, req: IncomingMessage) => boolean;
}

export type OcppModuleOptions = ServerOptions & OcppNestOptions;

export interface OcppOptionsFactory {
  createOcppOptions(): Promise<OcppModuleOptions> | OcppModuleOptions;
}

export interface OcppModuleAsyncOptions {
  imports?: Array<
    Type<any> | DynamicModule | Promise<DynamicModule> | ForwardReference
  >;
  inject?: any[];
  useFactory?: (
    ...args: any[]
  ) => Promise<OcppModuleOptions> | OcppModuleOptions;
  useClass?: Type<OcppOptionsFactory>;
  useExisting?: Type<OcppOptionsFactory>;
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
  PATH_PARAMS = 7,
  PROTOCOL = 8,
  MESSAGE_ID = 9,
  HANDSHAKE = 10,
}

export interface OcppParamMetadata {
  type: OcppParamType;
  data?: string;
}
