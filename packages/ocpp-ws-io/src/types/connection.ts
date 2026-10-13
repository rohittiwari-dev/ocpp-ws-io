/**
 * The connection type of a server or route. Apart from `protocol.ts` because
 * it names the server's classes, and through them Node's types, which the
 * browser entry's declarations must not reach.
 */
import type { AnyOCPPProtocol } from "./protocol.js";

/**
 * The connection type of a server or route, for storing its connections:
 * `new Map<string, ConnectionOf<typeof server>>()`.
 */
export type ConnectionOf<S> =
  S extends import("../server/server.js").OCPPServer<
    infer P extends AnyOCPPProtocol
  >
    ? import("../server/server-client.js").OCPPServerClient<P>
    : S extends import("../server/router.js").OCPPRouter<
          infer P extends AnyOCPPProtocol
        >
      ? import("../server/server-client.js").OCPPServerClient<P>
      : never;
