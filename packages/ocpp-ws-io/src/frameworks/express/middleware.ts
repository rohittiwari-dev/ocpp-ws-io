import type { OCPPServer } from "../../server.js";
import { createOcppExpressContext } from "./context.js";
import type {
  OcppExpressContext,
  OcppExpressMiddleware,
  OcppExpressNextFunction,
  OcppExpressRequest,
} from "./types.js";

export function ocppMiddleware(
  context: OcppExpressContext,
): OcppExpressMiddleware;
export function ocppMiddleware(server: OCPPServer): OcppExpressMiddleware;
export function ocppMiddleware(
  contextOrServer: OcppExpressContext | OCPPServer,
): OcppExpressMiddleware {
  const context =
    "server" in contextOrServer
      ? contextOrServer
      : createOcppExpressContext(contextOrServer);

  return (
    req: OcppExpressRequest,
    _res: unknown,
    next: OcppExpressNextFunction,
  ): void => {
    req.ocpp = context;
    next();
  };
}
