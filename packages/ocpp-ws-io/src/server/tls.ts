import { createServer as createHttpServer, type Server } from "node:http";
import {
  createServer as createHttpsServer,
  type ServerOptions as HttpsServerOptions,
} from "node:https";
import type { SecureContextOptions, Server as TlsServer } from "node:tls";
import { SecurityProfile } from "../types/protocol.js";
import type { ServerOptions } from "../types/server.js";
import type { TLSOptions } from "../types/transport.js";

/** A listening server whose certificate can be replaced in place (HTTPS). */
export function canReloadSecureContext(
  srv: Server,
): srv is Server & Pick<TlsServer, "setSecureContext"> {
  return (
    "setSecureContext" in srv && typeof srv.setSecureContext === "function"
  );
}

/** The certificate and protocol settings of a TLS context, from TLSOptions. */
export function secureContextOptions(
  tlsOpts: TLSOptions,
): SecureContextOptions {
  const options: SecureContextOptions = {};
  if (tlsOpts.cert) options.cert = tlsOpts.cert;
  if (tlsOpts.key) options.key = tlsOpts.key;
  if (tlsOpts.ca) options.ca = tlsOpts.ca;
  if (tlsOpts.passphrase) options.passphrase = tlsOpts.passphrase;
  if (tlsOpts.minVersion) options.minVersion = tlsOpts.minVersion;
  if (tlsOpts.maxVersion) options.maxVersion = tlsOpts.maxVersion;
  if (tlsOpts.ciphers) options.ciphers = tlsOpts.ciphers;
  return options;
}

/**
 * The server listen() creates: HTTPS under the TLS security profiles, asking
 * for a client certificate under profile 3, and HTTP otherwise.
 */
export function createProfileServer(
  options: Pick<ServerOptions, "securityProfile" | "tls">,
): Server {
  // Create server based on security profile
  const profile = options.securityProfile ?? SecurityProfile.NONE;

  if (
    profile === SecurityProfile.TLS_BASIC_AUTH ||
    profile === SecurityProfile.TLS_CLIENT_CERT
  ) {
    const tlsOpts = options.tls ?? {};
    const httpsOptions: HttpsServerOptions = secureContextOptions(tlsOpts);

    // Profile 3: Request client certificate (mTLS)
    if (profile === SecurityProfile.TLS_CLIENT_CERT) {
      httpsOptions.requestCert = true;
      httpsOptions.rejectUnauthorized = tlsOpts.rejectUnauthorized ?? true;
    }

    return createHttpsServer(httpsOptions);
  } else {
    return createHttpServer();
  }
}
