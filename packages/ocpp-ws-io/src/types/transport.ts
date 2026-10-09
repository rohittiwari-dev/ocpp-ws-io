/** TLS, `ws` and compression options. */
import type { SecureVersion } from "node:tls";

// ─── TLS Options ─────────────────────────────────────────────────

export interface TLSOptions {
  /**
   * Server/client certificate (PEM). Pass several, such as an RSA and an
   * ECDSA one, to offer the cipher suites of each: a CSMS has to support two
   * ECDSA and two RSA suites, so it needs both (OCPP 2.0.1 Part 2 §A).
   */
  cert?: string | Buffer | Array<string | Buffer>;
  /** Private key (PEM); one per certificate, in the same order. */
  key?: string | Buffer | Array<string | Buffer>;
  /** CA certificate(s) for verification */
  ca?: string | Buffer | Array<string | Buffer>;
  /** Reject unauthorized certs (default: true) */
  rejectUnauthorized?: boolean;
  /** Passphrase for encrypted private key */
  passphrase?: string;
  /**
   * Lowest TLS version allowed (default: Node's, `"TLSv1.2"`). OCPP 2.0.1
   * requires 1.2 or above; the 1.6 security whitepaper lets legacy charge
   * points use `"TLSv1"` / `"TLSv1.1"`.
   */
  minVersion?: SecureVersion;
  /** Highest TLS version allowed (default: Node's, `"TLSv1.3"`). */
  maxVersion?: SecureVersion;
  /** OpenSSL cipher list (default: Node's). */
  ciphers?: string;
}
/**
 * `ws` client options the client sets itself, so `wsOpts` does not offer
 * them: `handshakeTimeout` (use `connectTimeoutMs`), `perMessageDeflate` (use
 * `compression`), `headers` (use `headers`), the TLS settings (use `tls`) and
 * `autoPong`: pings are always answered (RFC 6455 §5.5.2), since a CSMS
 * disconnects a charger that stops answering them.
 */
export type ManagedWsClientOption =
  | "handshakeTimeout"
  | "perMessageDeflate"
  | "headers"
  | "autoPong"
  | keyof TLSOptions;
/** Raw `ws` client options accepted by `ClientOptions.wsOpts`. */
export type WsClientOptions = Omit<
  import("ws").ClientOptions,
  ManagedWsClientOption
> & {
  /**
   * How long a closing connection waits for the peer's close frame before
   * the socket is destroyed, in ms (`ws` default: 30000). Supported by `ws`
   * 8.22 and declared here because its type definitions do not have it yet.
   */
  closeTimeout?: number;
};
/**
 * `ws` server options the server sets itself, so `wssOptions` does not offer
 * them: binding (`noServer`, `server`, `port`, `host`, `backlog`, `path`: use
 * `listen()`, `handleUpgrade` or your own server, and `route()`),
 * `handleProtocols` (use `protocols`), `verifyClient` (use `auth()`,
 * middleware or `isKnownIdentity`), `maxPayload` (use `maxPayloadBytes`),
 * `perMessageDeflate` (use `compression`), `clientTracking` (`stats()` needs
 * it) and `autoPong`: charger pings are always answered (RFC 6455 §5.5.2).
 */
export type ManagedWsServerOption =
  | "noServer"
  | "server"
  | "port"
  | "host"
  | "backlog"
  | "path"
  | "handleProtocols"
  | "verifyClient"
  | "maxPayload"
  | "perMessageDeflate"
  | "clientTracking"
  | "autoPong";
/** Raw `ws` server options accepted by `ServerOptions.wssOptions`. */
export type WsServerOptions = Omit<
  import("ws").ServerOptions,
  ManagedWsServerOption
> & {
  /**
   * How long a closing connection waits for the charger's close frame before
   * the socket is destroyed, in ms (`ws` default: 30000). Supported by `ws`
   * 8.22 and declared here because its type definitions do not have it yet.
   */
  closeTimeout?: number;
};
// ─── Compression Options ─────────────────────────────────────────

export interface CompressionOptions {
  /** Minimum payload size in bytes to compress (default: 1024) */
  threshold?: number;
  /** zlib compression level 1 (fastest) to 9 (smallest) (default: 6) */
  level?: number;
  /** zlib memory level 1–9 (default: 8) */
  memLevel?: number;
  /** Server does not retain deflate context between messages (default: true — saves ~120KB/conn) */
  serverNoContextTakeover?: boolean;
  /** Client does not retain deflate context between messages (default: true) */
  clientNoContextTakeover?: boolean;
}
