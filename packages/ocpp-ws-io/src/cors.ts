import type { IncomingMessage } from "node:http";
import { TLSSocket } from "node:tls";
import type { CORSOptions } from "./types.js";
import { isIPAllowed } from "./utils/cidr.js";

/**
 * Validates an incoming WebSocket upgrade request against CORS rules.
 * Runs before routing and authentication.
 */
export function checkCORS(
  request: IncomingMessage,
  options: CORSOptions,
): { allowed: boolean; reason?: string } {
  // 1. IP Check
  if (options.allowedIPs && options.allowedIPs.length > 0) {
    const remoteIP = request.socket.remoteAddress;
    if (!remoteIP || !isIPAllowed(remoteIP, options.allowedIPs)) {
      return { allowed: false, reason: "IP address not allowed" };
    }
  }

  // 2. Scheme Check
  if (options.allowedSchemes && options.allowedSchemes.length > 0) {
    let scheme = request.socket instanceof TLSSocket ? "wss" : "ws";

    // Fallback for reverse proxy deployments (nginx/Caddy)
    const fwdProto = request.headers["x-forwarded-proto"];
    if (typeof fwdProto === "string") {
      scheme = fwdProto === "https" || fwdProto === "wss" ? "wss" : "ws";
    }

    if (!options.allowedSchemes.includes(scheme as "ws" | "wss")) {
      return { allowed: false, reason: "Protocol scheme not allowed" };
    }
  }

  // 3. Origin Check
  // Note: if the Origin header is absent, we pass through.
  // Physical charging stations do not send an Origin header, whereas browsers always do.
  if (options.allowedOrigins && options.allowedOrigins.length > 0) {
    const origin = request.headers.origin;
    if (
      typeof origin === "string" &&
      !options.allowedOrigins.includes(origin)
    ) {
      return { allowed: false, reason: "Origin not allowed" };
    }
  }

  return { allowed: true };
}
