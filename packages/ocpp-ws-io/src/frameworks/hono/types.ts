import type { IncomingMessage } from "node:http";
import type { OCPPServer } from "../../server.js";
import type { BaseOcppContext } from "../base/context.js";

export interface OcppHonoContext extends BaseOcppContext {}

export interface AttachOcppHonoOptions {
  ocppServer: OCPPServer;
  /**
   * Only requests with a URL starting with this prefix will be upgraded.
   * E.g., "/ocpp" or ["/v1/ocpp", "/v2/ocpp"]
   */
  upgradePathPrefix?: string | string[];
  /**
   * Advanced filter for upgrade requests. If provided, this overrides `upgradePathPrefix`.
   * Return true to allow the upgrade.
   */
  upgradeFilter?: (pathname: string, req: IncomingMessage) => boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    ocpp: OcppHonoContext;
  }
}
