import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { abortHandshake, getClientIp } from "../../core/ws-util.js";
import type { UpgradeContext } from "./context.js";

/**
 * Refuse the connection with 503 when the server is at maxConnections.
 * Returns true when it refused.
 */
export function refuseOverConnectionLimit(
  server: UpgradeContext,
  req: IncomingMessage,
  socket: Duplex,
): boolean {
  // Hard connection cap — reject before any expensive handshake work.
  //
  // `_clients` only gains an entry once auth has completed, so counting it
  // alone let every concurrently-arriving handshake pass the gate while the
  // others were still awaiting an async auth callback: the cap was overshot
  // by however many upgrades were in flight. In-flight handshakes are
  // counted too.
  const maxConnections = server.maxConnections;
  if (
    maxConnections !== undefined &&
    server.clientCount + server.pendingHandshakes >= maxConnections
  ) {
    const secEvt = {
      type: "CONNECTION_LIMIT" as const,
      ip: getClientIp(req as never, server.globalCORS?.trustProxy),
      timestamp: new Date().toISOString(),
      details: {
        activeConnections: server.clientCount,
        maxConnections,
      },
    };
    server.emitSecurityEvent(secEvt);
    abortHandshake(socket, 503, "Connection limit reached");
    return true;
  }
  return false;
}

/**
 * Refuse the connection with 429 when its IP has no connectionRateLimit token
 * left, and take one otherwise. Returns true when it refused.
 */
export function refuseOverConnectionRate(
  server: UpgradeContext,
  req: IncomingMessage,
  socket: Duplex,
): boolean {
  const connRateLimit = server.connectionRateLimit;
  if (connRateLimit) {
    // Rate limiting can trust a proxy without CORS being configured at all,
    // so its own setting wins and the CORS one is the fallback.
    const trustProxy =
      connRateLimit.trustProxy ?? server.globalCORS?.trustProxy;
    const ip = getClientIp(req as never, trustProxy);

    // An X-Forwarded-For we are not trusting means every charger behind the
    // proxy collapses onto one bucket and the per-IP limit is really a
    // fleet-wide cap. Say so once rather than failing silently.
    if (
      trustProxy !== true &&
      !server.warnedUntrustedProxy &&
      req.headers["x-forwarded-for"] !== undefined
    ) {
      server.warnedUntrustedProxy = true;
      server.logger?.warn?.(
        "connectionRateLimit is counting per proxy address, not per client",
        {
          reason:
            "X-Forwarded-For is present but no proxy is trusted, so every client behind it shares one bucket",
          fix: "set connectionRateLimit.trustProxy (or cors({ trustProxy })) if this server is only reachable through a trusted proxy",
          resolvedIp: ip,
        },
      );
    }
    const now = Date.now();
    let bucket = server.connectionBuckets.get(ip);
    if (!bucket) {
      bucket = { tokens: connRateLimit.limit, lastRefill: now };
      server.connectionBuckets.set(ip, bucket);
    } else {
      const elapsed = now - bucket.lastRefill;
      const refillRate = connRateLimit.limit / connRateLimit.windowMs;
      bucket.tokens = Math.min(
        connRateLimit.limit,
        bucket.tokens + elapsed * refillRate,
      );
      bucket.lastRefill = now;
    }
    if (bucket.tokens < 1) {
      server.logger?.warn?.("Connection rate limit exceeded", { ip });
      // Emit security event for connection-level rate limiting
      const secEvt = {
        type: "CONNECTION_RATE_LIMIT" as const,
        ip,
        timestamp: new Date().toISOString(),
        details: { tokensRemaining: bucket.tokens },
      };
      server.emitSecurityEvent(secEvt);
      abortHandshake(socket, 429, "Too Many Requests");
      return true;
    }
    bucket.tokens -= 1;
  }
  return false;
}

/**
 * Evict per-IP connection buckets that have been idle longer than the
 * rate-limit window. Recreating a bucket grants a full token allowance,
 * which is exactly what a full refill after `windowMs` idle would yield —
 * so eviction is behavior-preserving while bounding memory (report H4).
 */
export function sweepConnectionBuckets(
  server: UpgradeContext,
  now: number,
): void {
  const rl = server.connectionRateLimit;
  if (!rl) {
    server.connectionBuckets.clear();
    return;
  }
  for (const [ip, bucket] of server.connectionBuckets) {
    if (now - bucket.lastRefill > rl.windowMs) {
      server.connectionBuckets.delete(ip);
    }
  }
}
