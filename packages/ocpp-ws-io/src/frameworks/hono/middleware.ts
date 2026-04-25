import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { MiddlewareHandler } from "hono";
import type { OCPPServer } from "../../server.js";
import { BaseOcppContext } from "../base/context.js";
import { shouldHandleUpgrade } from "../base/utils.js";
import type { AttachOcppHonoOptions, OcppHonoContext } from "./types.js";

class DefaultOcppHonoContext
  extends BaseOcppContext
  implements OcppHonoContext {}

export function createOcppHonoContext(server: OCPPServer): OcppHonoContext {
  return new DefaultOcppHonoContext(server);
}

/**
 * Hono Middleware that injects `c.get('ocpp')` into the context.
 */
export function ocppMiddleware(server: OCPPServer): MiddlewareHandler {
  const context = createOcppHonoContext(server);

  return async (c, next) => {
    c.set("ocpp", context);
    await next();
  };
}

export interface OcppHonoNodeBinding {
  server: OCPPServer;
  httpServer: HttpServer;
  context: OcppHonoContext;
  dispose: () => void;
  close: (closeOptions?: any) => Promise<void>;
}

/**
 * Wrapper for `@hono/node-server` or raw Node.js `http.Server` to automatically handle upgrade events.
 */
export function attachOcppHonoNode(
  httpServer: HttpServer,
  server: OCPPServer,
  options: Omit<AttachOcppHonoOptions, "ocppServer"> = {},
): OcppHonoNodeBinding {
  const context = createOcppHonoContext(server);
  let disposed = false;

  const upgradeHandler = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    if (!shouldHandleUpgrade(req, options)) return;
    server.handleUpgrade(req, socket, head);
  };

  httpServer.on("upgrade", upgradeHandler);

  const dispose = () => {
    if (disposed) return;
    httpServer.removeListener("upgrade", upgradeHandler);
    disposed = true;
  };

  return {
    server,
    httpServer,
    context,
    dispose,
    async close(closeOptions) {
      dispose();
      await server.close(closeOptions);
    },
  };
}
