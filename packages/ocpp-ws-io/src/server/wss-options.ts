import type { IncomingMessage } from "node:http";
import { WebSocketServer, type ServerOptions as WsLibServerOptions } from "ws";
import type { LoggerLike } from "../types/logger.js";
import type { ServerOptions } from "../types/server.js";
import type { ManagedWsServerOption } from "../types/transport.js";

// The server's `ws` WebSocketServer: the options it takes from wssOptions,
// those it sets itself, and per-message compression.

/**
 * What to use instead of each `ws` option `wssOptions` does not take. Typed
 * against ManagedWsServerOption, so the list cannot drift from the type.
 */
const WSS_OPTION_HINT: Record<ManagedWsServerOption, string> = {
  port: "use listen(port)",
  host: "use listen(port, host)",
  backlog: "set it on your own HTTP server",
  path: "use route()",
  noServer: "always on: use listen() or handleUpgrade",
  server: "use listen(port, host, { server })",
  verifyClient: "use auth(), middleware or isKnownIdentity",
  handleProtocols: "use protocols",
  maxPayload: "use maxPayloadBytes",
  perMessageDeflate: "use compression",
  clientTracking: "always on: stats() needs it",
  autoPong: "always on: pings are answered, RFC 6455 §5.5.2",
};
const MANAGED_WSS_OPTIONS = Object.keys(
  WSS_OPTION_HINT,
) as ManagedWsServerOption[];

/** Once for the server, not per connection (its clients stay quiet). */
/**
 * wssOptions does not offer the options the server sets itself; its type
 * leaves them out. Plain JavaScript can still pass them: they are dropped,
 * and this names each with what to use instead, so the setting does not
 * fail silently.
 */
export function warnIgnoredWssOptions(
  wssOptions: ServerOptions["wssOptions"],
  logger: LoggerLike | null,
): void {
  const given: WsLibServerOptions = { ...wssOptions };
  const ignored = MANAGED_WSS_OPTIONS.filter(
    (key) => given[key] !== undefined,
  ).map((key) => `${key} (${WSS_OPTION_HINT[key]})`);

  if (ignored.length > 0) {
    logger?.warn?.(
      "wssOptions does not take these options; set them through the server options",
      { ignored },
    );
  }
}

// ─── Internal: WebSocketServer Factory ──────────────────────────

/**
 * Builds a `noServer` WebSocketServer with the configured transport-layer
 * settings (max payload + per-message compression). Centralized so every
 * (re)creation site — constructor, upgrade re-init, and close/restart —
 * stays consistent.
 */
export function createWss(
  options: Pick<
    ServerOptions,
    "wssOptions" | "maxPayloadBytes" | "compression"
  >,
  negotiatedProtocols: WeakMap<IncomingMessage, string | false>,
): WebSocketServer {
  // wssOptions first. Its type leaves out the options set below; any that
  // still arrive, from JavaScript, are dropped (and were warned about).
  const extra: WsLibServerOptions = { ...options.wssOptions };
  for (const key of MANAGED_WSS_OPTIONS) delete extra[key];
  return new WebSocketServer({
    ...extra,
    // stats() reads wss.clients, and chargers disconnect without pongs;
    // set explicitly rather than relying on the `ws` defaults.
    clientTracking: true,
    autoPong: true,
    noServer: true,
    // Without this, ws picks the FIRST protocol the client offered, while
    // _handleUpgrade separately selected the first one the *server* supports.
    // When those differ the client is told it is speaking one version while
    // the server validates another — e.g. a client offering
    // ["ocpp2.0.1","ocpp1.6"] against a server supporting only ocpp1.6 got
    // "ocpp2.0.1" echoed back. Hand ws the selection we actually made.
    handleProtocols: (
      protocols: Set<string>,
      request: IncomingMessage,
    ): string | false => {
      const chosen = negotiatedProtocols.get(request);
      if (chosen !== undefined) return chosen;
      // No server-side protocol list configured: keep ws's default of
      // echoing the client's first offer.
      return protocols.values().next().value ?? false;
    },
    maxPayload: options.maxPayloadBytes ?? 65536,
    perMessageDeflate: buildCompressionConfig(options.compression),
  });
}

// ─── Internal: Compression Config ───────────────────────────────

export function buildCompressionConfig(
  compression: ServerOptions["compression"],
): boolean | object {
  if (!compression) return false;
  if (compression === true) {
    return {
      threshold: 1024,
      zlibDeflateOptions: { level: 6, memLevel: 8 },
      zlibInflateOptions: {},
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
    };
  }
  return {
    threshold: compression.threshold ?? 1024,
    zlibDeflateOptions: {
      level: compression.level ?? 6,
      memLevel: compression.memLevel ?? 8,
    },
    zlibInflateOptions: {},
    serverNoContextTakeover: compression.serverNoContextTakeover ?? true,
    clientNoContextTakeover: compression.clientNoContextTakeover ?? true,
  };
}
