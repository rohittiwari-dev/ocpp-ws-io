import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { OCPPServer } from "../../server.js";
import type { OCPPServerClient } from "../../server-client.js";
import type {
  AllMethodNames,
  CallOptions,
  CloseOptions,
  OCPPProtocol,
  OCPPRequestType,
  OCPPResponseType,
  OCPPServerStats,
} from "../../types.js";

export interface OcppExpressContext {
  readonly server: OCPPServer;
  readonly clients: ReadonlySet<OCPPServerClient>;

  stats(): OCPPServerStats;

  getClient(identity: string): OCPPServerClient | undefined;
  getLocalClient(identity: string): OCPPServerClient | undefined;
  hasLocalClient(identity: string): boolean;
  hasClient(identity: string): Promise<boolean>;

  sendToClient<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    identity: string,
    version: V,
    method: M,
    params: OCPPRequestType<V, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M> | undefined>;
  sendToClient<M extends AllMethodNames<any>>(
    identity: string,
    method: M,
    params: OCPPRequestType<any, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<any, M> | undefined>;
  sendToClient<TResult = any>(
    identity: string,
    method: string,
    params: Record<string, any>,
    options?: CallOptions,
  ): Promise<TResult | undefined>;

  safeSendToClient<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    identity: string,
    version: V,
    method: M,
    params: OCPPRequestType<V, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M> | undefined>;
  safeSendToClient<M extends AllMethodNames<any>>(
    identity: string,
    method: M,
    params: OCPPRequestType<any, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<any, M> | undefined>;
  safeSendToClient<TResult = any>(
    identity: string,
    method: string,
    params: Record<string, any>,
    options?: CallOptions,
  ): Promise<TResult | undefined>;

  close(options?: CloseOptions): Promise<void>;
}

export interface OcppExpressRequest {
  ocpp?: OcppExpressContext;
}

export type OcppExpressNextFunction = (error?: unknown) => void;

export type OcppExpressMiddleware = (
  req: OcppExpressRequest,
  res: unknown,
  next: OcppExpressNextFunction,
) => void;

export interface AttachOcppExpressOptions {
  /**
   * Only pass matching upgrade requests to OCPP.
   * Example: "/ocpp" handles "/ocpp/CP-001"; "/ocpp/*" does the same.
   */
  upgradePathPrefix?: string | string[];
  /**
   * Advanced upgrade filter. Return true to let OCPP handle the request.
   */
  upgradeFilter?: (pathname: string, req: IncomingMessage) => boolean;
  /**
   * Also close the owning HTTP server when binding.close() is called.
   * Defaults to false because Express usually owns the HTTP server lifecycle.
   */
  closeHttpServer?: boolean;
}

export interface OcppExpressBinding {
  readonly server: OCPPServer;
  readonly httpServer: HttpServer;
  readonly context: OcppExpressContext;

  dispose(): void;
  close(options?: CloseOptions): Promise<void>;
}

declare global {
  namespace Express {
    interface Request {
      ocpp: OcppExpressContext;
    }
  }
}
