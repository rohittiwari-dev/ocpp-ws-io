import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { OCPPServer } from "../../server/server.js";
import type { OCPPServerClient } from "../../server/server-client.js";
import type { CloseOptions, OCPPServerStats } from "../../types.js";

export interface OcppExpressContext {
  readonly server: OCPPServer;
  readonly clients: ReadonlySet<OCPPServerClient>;

  stats(): OCPPServerStats;

  getClient(identity: string): OCPPServerClient | undefined;
  getLocalClient(identity: string): OCPPServerClient | undefined;
  hasLocalClient(identity: string): boolean;
  hasClient(identity: string): Promise<boolean>;

  /**
   * As the server's `sendToClient()`: known actions of every declared
   * protocol with exact params, or `unchecked()`.
   */
  sendToClient: OCPPServer["sendToClient"];
  /** As the server's `safeSendToClient()`. */
  safeSendToClient: OCPPServer["safeSendToClient"];

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
