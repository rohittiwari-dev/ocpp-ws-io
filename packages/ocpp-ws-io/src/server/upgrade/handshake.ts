import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import { endpointOf } from "../../core/util.js";
import { parseBasicAuth } from "../../core/ws-util.js";
import type { HandshakeInfo } from "../../types/handshake.js";
import { SecurityProfile } from "../../types/protocol.js";

/** An upgrade request once its route has matched and its identity is known. */
export interface UpgradeRequest {
  readonly req: IncomingMessage;
  readonly socket: Duplex;
  /** The request URL, resolved against its Host header. */
  readonly url: URL;
  readonly identity: string;
  readonly params: Record<string, string>;
  /** The subprotocols the charger offered. */
  readonly protocols: Set<string>;
  readonly securityProfile: SecurityProfile;
}

/**
 * The handshake as middleware, auth callbacks and plugins see it, with the
 * Basic Auth password and, under security profile 3, the client certificate.
 */
export function buildHandshakeInfo({
  req,
  socket,
  url,
  identity,
  params,
  protocols,
  securityProfile: profile,
}: UpgradeRequest): HandshakeInfo {
  const pathname = url.pathname;

  // Parse Basic Auth (modular)
  const password = parseBasicAuth(req.headers.authorization ?? "", identity);

  // Client certificate (Profile 3 — mTLS)
  let clientCertificate:
    | ReturnType<TLSSocket["getPeerCertificate"]>
    | undefined;
  if (
    profile === SecurityProfile.TLS_CLIENT_CERT &&
    "getPeerCertificate" in socket
  ) {
    clientCertificate = (socket as TLSSocket).getPeerCertificate();
  }

  // The URL as the charger asked for it: ws, or wss when this socket is
  // TLS (a proxy terminating TLS in front of the server is not seen).
  const requestedUrl = new URL(url.href);
  requestedUrl.protocol =
    "encrypted" in req.socket && req.socket.encrypted === true ? "wss:" : "ws:";

  // Build HandshakeInfo
  const handshake: HandshakeInfo = {
    identity,
    remoteAddress: req.socket.remoteAddress ?? "",
    headers: req.headers as Record<string, string | string[] | undefined>,
    protocols,
    pathname,
    url: requestedUrl.href,
    endpoint: endpointOf(pathname, identity),
    params,
    query: url.searchParams,
    request: req,
    password,
    clientCertificate,
    securityProfile: profile,
  };

  return handshake;
}
