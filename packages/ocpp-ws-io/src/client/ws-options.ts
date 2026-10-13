import type WebSocket from "ws";
import { getPackageIdent } from "../core/util.js";
import type { ClientOptions } from "../types/client.js";
import type { LoggerLike } from "../types/logger.js";
import type { AnyOCPPProtocol } from "../types/protocol.js";
import type { ManagedWsClientOption } from "../types/transport.js";

/**
 * Merges header sets left to right. Names are compared without case, as HTTP
 * does, so a later source always replaces an earlier one's header, whatever
 * the case of either name and whatever order the keys were added in.
 */
function mergeHeaders(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> {
  const merged: Record<string, string> = {};
  const nameOf = new Map<string, string>();
  for (const source of sources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      const lower = name.toLowerCase();
      const previous = nameOf.get(lower);
      if (previous !== undefined) delete merged[previous];
      merged[name] = value;
      nameOf.set(lower, name);
    }
  }
  return merged;
}

/**
 * What to use instead of each `ws` option `wsOpts` does not take. Typed
 * against ManagedWsClientOption, so the list cannot drift from the type.
 */
const WS_OPTION_HINT: Record<ManagedWsClientOption, string> = {
  handshakeTimeout: "use connectTimeoutMs",
  perMessageDeflate: "use compression",
  headers: "use headers",
  autoPong: "always on: pings are answered, RFC 6455 §5.5.2",
  ca: "use tls",
  cert: "use tls",
  key: "use tls",
  passphrase: "use tls",
  rejectUnauthorized: "use tls",
  minVersion: "use tls",
  maxVersion: "use tls",
  ciphers: "use tls",
};

const MANAGED_WS_OPTIONS = Object.keys(
  WS_OPTION_HINT,
) as ManagedWsClientOption[];

/**
 * wsOpts does not offer the options the client sets itself; its type leaves
 * them out. Plain JavaScript can still pass them: they are dropped, and this
 * names each with the option to use instead, so the setting does not fail
 * silently.
 */
export function warnIgnoredWsOpts(
  wsOpts: ClientOptions["wsOpts"],
  logger: LoggerLike,
): void {
  const given: WebSocket.ClientOptions = { ...wsOpts };
  const ignored = MANAGED_WS_OPTIONS.filter(
    (key) => given[key] !== undefined,
  ).map((key) => `${key} (${WS_OPTION_HINT[key]})`);

  if (ignored.length > 0) {
    logger.warn?.(
      "wsOpts does not take these options; set them through the client options",
      { ignored },
    );
  }
}

export function buildEndpoint(
  options: Pick<ClientOptions, "endpoint" | "query">,
  identity: string,
): string {
  // Use URL so identities land in the pathname even when the configured
  // endpoint carries a query string (report: low/_buildEndpoint).
  const url = new URL(options.endpoint);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.pathname += encodeURIComponent(identity);

  if (options.query) {
    for (const [k, v] of new URLSearchParams(options.query)) {
      url.searchParams.append(k, v);
    }
  }
  return url.toString();
}

export function buildWsOptions<P extends AnyOCPPProtocol>(
  options: ClientOptions<P>,
  identity: string,
): WebSocket.ClientOptions {
  // wsOpts first. Its type leaves out the options set below; any that still
  // arrive, from JavaScript, are dropped (and were warned about).
  const extra: WebSocket.ClientOptions = { ...options.wsOpts };
  for (const key of MANAGED_WS_OPTIONS) delete extra[key];
  const opts: WebSocket.ClientOptions = {
    ...extra,
    headers: mergeHeaders(options.headers, {
      "User-Agent": getPackageIdent(),
    }),
    // A CSMS disconnects a charger that stops answering its pings; set
    // explicitly rather than relying on the `ws` default.
    autoPong: true,
  };

  // Bound the upgrade. `ws` aborts the handshake and emits an error when this
  // elapses, which is what turns a black-holed peer into a failed attempt the
  // reconnect logic can act on, instead of an indefinite CONNECTING. Set or
  // cleared here either way, so wsOpts cannot change it.
  const connectTimeoutMs =
    (options as ClientOptions).connectTimeoutMs ?? 30_000;
  opts.handshakeTimeout = connectTimeoutMs > 0 ? connectTimeoutMs : undefined;

  // Basic Auth whenever a password is set, the identity as the username.
  // Profiles 1 and 2 require it; on the others it used to be dropped without
  // a word, so a client given a password connected without credentials.
  if (options.password) {
    // Joined as bytes: a Buffer password (1.6's AuthorizationKey is binary)
    // goes out as given. Decoding it as a string replaced every byte that is
    // not valid UTF-8 with EF BF BD. A string password is sent as UTF-8.
    const credentials = Buffer.concat([
      Buffer.from(`${identity}:`),
      typeof options.password === "string"
        ? Buffer.from(options.password)
        : options.password,
    ]).toString("base64");
    // Merged rather than assigned, so it replaces an `authorization` header
    // from `headers` whatever its case.
    opts.headers = mergeHeaders(opts.headers, {
      Authorization: `Basic ${credentials}`,
    });
  }

  // TLS settings on every profile: a wss:// endpoint needs them whatever the
  // OCPP profile (`ca` for a CSMS on a private CA, even on profile 0). They
  // used to apply on profiles 2 and 3 only, and were silently ignored
  // otherwise. On profile 3, `cert` and `key` identify the charger.
  const tls = options.tls;
  if (tls) {
    if (tls.ca) opts.ca = tls.ca;
    if (tls.rejectUnauthorized !== undefined)
      opts.rejectUnauthorized = tls.rejectUnauthorized;
    if (tls.minVersion) opts.minVersion = tls.minVersion;
    if (tls.maxVersion) opts.maxVersion = tls.maxVersion;
    if (tls.ciphers) opts.ciphers = tls.ciphers;
    if (tls.cert) opts.cert = tls.cert;
    if (tls.key) opts.key = tls.key;
    if (tls.passphrase) opts.passphrase = tls.passphrase;
  }

  // Compression: permessage-deflate, only when asked for. `ws` offers it by
  // default, so off has to be set explicitly; leaving it unset meant a
  // client documented as uncompressed (and one set to `false`) negotiated it
  // with any server that supports it.
  const compression = options.compression;
  if (!compression) {
    opts.perMessageDeflate = false;
  } else {
    opts.perMessageDeflate =
      compression === true
        ? {
            zlibDeflateOptions: { level: 6, memLevel: 8 },
            zlibInflateOptions: {},
            clientNoContextTakeover: true,
            serverNoContextTakeover: true,
          }
        : {
            zlibDeflateOptions: {
              level: compression.level ?? 6,
              memLevel: compression.memLevel ?? 8,
            },
            zlibInflateOptions: {},
            clientNoContextTakeover:
              compression.clientNoContextTakeover ?? true,
            serverNoContextTakeover:
              compression.serverNoContextTakeover ?? true,
          };
  }

  return opts;
}
