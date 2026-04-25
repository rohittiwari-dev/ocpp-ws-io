import type { OCPPServer } from "../../server.js";
import { BaseOcppContext } from "../base/context.js";
import type { OcppExpressContext } from "./types.js";

class DefaultOcppExpressContext
  extends BaseOcppContext
  implements OcppExpressContext {
  // Inherits all required methods from BaseOcppContext
}

export function createOcppExpressContext(
  server: OCPPServer,
): OcppExpressContext {
  return new DefaultOcppExpressContext(server);
}
