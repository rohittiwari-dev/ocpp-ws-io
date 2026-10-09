/** What a charger's upgrade request carried. */
import type { IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import type { SecurityProfile } from "./protocol.js";

// ─── Handshake Info ──────────────────────────────────────────────

/** Whether a charging station identity is known; see `isKnownIdentity`. */
export type IdentityLookup = (
  identity: string,
  handshake: HandshakeInfo,
) => boolean | Promise<boolean>;
/** See `duplicateConnection`. */
export type DuplicateConnectionPolicy = "replace" | "reject";
/**
 * What a charger's WebSocket upgrade request carried, as connection
 * middleware and the auth callback see it (`ctx.handshake`) and as the
 * connection keeps it (`client.handshake`). For `ws://host:9000/ocpp/CP001?token=abc`:
 * `identity` "CP001", `pathname` "/ocpp/CP001", `endpoint` "/ocpp",
 * `query.get("token")` "abc".
 */
export interface HandshakeInfo {
  /**
   * Charging station identity, percent-decoded: the route's `:identity`
   * parameter when the route has one, else the last segment of the path
   * ("CP 001" for `/ocpp/CP%20001`). The auth callback can replace it with
   * `ctx.accept({ identity })`; this then holds the new one.
   */
  identity: string;
  /**
   * The TCP peer's IP address, as the socket reports it: behind a reverse
   * proxy, the proxy's address. A forwarded client address, if you trust the
   * proxy, is in `headers["x-forwarded-for"]`. Empty when the socket has
   * already closed.
   */
  remoteAddress: string;
  /**
   * The request's HTTP headers, as Node.js parses them: names in lower case
   * (`headers.authorization`, `headers["sec-websocket-protocol"]`); a header
   * sent more than once may be an array.
   */
  headers: Record<string, string | string[] | undefined>;
  /**
   * Every subprotocol the charger offered in `Sec-WebSocket-Protocol`, in its
   * order (`ocpp2.0.1`, `ocpp1.6`); empty when it offered none. The one the
   * server picked is `client.protocol`.
   */
  protocols: Set<string>;
  /**
   * The requested path with the identity, percent-encoded as in the URL,
   * without the query: `/ocpp/CP%20001`.
   */
  pathname: string;
  /**
   * Full URL including protocol, host, and query, as requested:
   * `ws://host:9000/ocpp/CP001?token=abc` (`wss:` when this server's socket is
   * TLS; a proxy terminating TLS in front of it is not seen). The host is the
   * request's `Host` header.
   */
  url: string;
  /**
   * Requested endpoint: the pathname without the identity's segment, `/ocpp`
   * for `/ocpp/CP001`, `/api/v16` for a route `/api/:identity/v16`, `/` when
   * the identity is the whole path. It stays the requested one when auth
   * changes the identity.
   */
  endpoint: string;
  /**
   * The matched route's path parameters by name, percent-decoded:
   * `{ tenant: "acme", identity: "CP001" }` for `/:tenant/:identity`. Empty
   * when no route pattern matched (a server with only `server.auth()`).
   */
  params: Record<string, string>;
  /** The URL's query string, parsed: `query.get("token")`. */
  query: URLSearchParams;
  /**
   * The raw HTTP upgrade request (Node.js `IncomingMessage`), for anything
   * the other fields leave out.
   */
  request: IncomingMessage;
  /**
   * The Basic Auth password, as bytes, from an `Authorization: Basic` header
   * whose user-id is the identity (OCPP Security Profiles 1 and 2). Undefined
   * when there is no such header or the user-id is another.
   */
  password?: Buffer;
  /**
   * The charger's TLS client certificate (Security Profile 3, mutual TLS):
   * Node.js `getPeerCertificate()`, an empty object when the charger sent
   * none. Only read when the server's `securityProfile` is `TLS_CLIENT_CERT`.
   */
  clientCertificate?: ReturnType<TLSSocket["getPeerCertificate"]>;
  /**
   * The server's configured `securityProfile` option (the same for every
   * connection; `NONE` by default), not one the charger chose.
   */
  securityProfile: SecurityProfile;
}
