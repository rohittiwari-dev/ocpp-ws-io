import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type {
  HealthEndpointAuth,
  HealthEndpointOptions,
} from "../types/server.js";

// Credentials of the /health and /metrics endpoints: checked when the server
// is configured, and on each request.

/**
 * Reject health-endpoint credentials that are missing or empty. A token read
 * from an unset environment variable arrives as `undefined`; left to the
 * request handler, it threw there on the first `/health` request and the
 * unhandled rejection took the process down.
 */
export function assertHealthEndpointAuth(
  option: boolean | HealthEndpointOptions | undefined,
): void {
  const auth = typeof option === "object" ? option.auth : undefined;
  if (!auth) return;
  if ("bearer" in auth) {
    if (typeof auth.bearer !== "string" || auth.bearer === "") {
      throw new Error(
        "healthEndpoint.auth.bearer must be a non-empty string — check that the token's environment variable is set",
      );
    }
    return;
  }
  if (
    typeof auth.username !== "string" ||
    auth.username === "" ||
    typeof auth.password !== "string" ||
    auth.password === ""
  ) {
    throw new Error(
      "healthEndpoint.auth needs a non-empty username and password",
    );
  }
}

/** Constant-time string comparison that does not reveal either length. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}

export function checkHealthAuth(
  req: IncomingMessage,
  auth: HealthEndpointAuth,
): boolean {
  const header = req.headers.authorization ?? "";
  const space = header.indexOf(" ");
  if (space === -1) return false;
  // RFC 7235: the scheme name is case-insensitive.
  const scheme = header.slice(0, space).toLowerCase();
  const credentials = header.slice(space + 1).trim();

  if ("bearer" in auth) {
    return scheme === "bearer" && safeEqual(credentials, auth.bearer);
  }

  if (scheme !== "basic") return false;
  const decoded = Buffer.from(credentials, "base64").toString();
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return false;
  // Both halves are always compared, so timing does not reveal which failed.
  const userMatch = safeEqual(decoded.slice(0, colonIdx), auth.username);
  const passMatch = safeEqual(decoded.slice(colonIdx + 1), auth.password);
  return userMatch && passMatch;
}
