/**
 * WebSocket utility functions for OCPP handshake handling.
 *
 * Subprotocol parsing follows RFC 6455 Section 4.1 and
 * HTTP token rules from RFC 7230 Section 3.2.6.
 * Close code validation per RFC 6455 Section 7.4.
 */

import http from "node:http";
import type { Duplex } from "node:stream";

// ─── Subprotocol Parsing ────────────────────────────────────────

/**
 * Determine if a character code is a valid HTTP token character.
 * RFC 7230 Section 3.2.6: tchar = "!" / "#" / "$" / "%" / "&" / "'" /
 * "*" / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA
 */
function isTChar(c: number): boolean {
  // ALPHA (A-Z, a-z)
  if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return true;
  // DIGIT (0-9)
  if (c >= 0x30 && c <= 0x39) return true;
  // Special tchar symbols
  switch (c) {
    case 0x21: // !
    case 0x23: // #
    case 0x24: // $
    case 0x25: // %
    case 0x26: // &
    case 0x27: // '
    case 0x2a: // *
    case 0x2b: // +
    case 0x2d: // -
    case 0x2e: // .
    case 0x5e: // ^
    case 0x5f: // _
    case 0x60: // `
    case 0x7c: // |
    case 0x7e: // ~
      return true;
  }
  return false;
}

/**
 * Parse the `Sec-WebSocket-Protocol` header into a Set of protocol names.
 *
 * Implements RFC 6455 Section 4.2.1 grammar for the header value:
 *   protocol-list = 1#token
 *   (see RFC 7230 Section 7 for the #rule list extension)
 *
 * Whitespace (SP/HTAB) is allowed around commas as per HTTP list rules.
 * Duplicate protocol names and invalid token characters cause a SyntaxError.
 */
export function parseSubprotocols(header: string): Set<string> {
  if (header.length === 0) {
    throw new SyntaxError("Unexpected end of input");
  }

  const protocols = new Set<string>();
  let cursor = 0;

  while (cursor < header.length) {
    // Skip leading whitespace before token
    while (
      cursor < header.length &&
      (header.charCodeAt(cursor) === 0x20 || header.charCodeAt(cursor) === 0x09)
    ) {
      cursor++;
    }

    // Expect at least one token character
    const tokenStart = cursor;
    while (cursor < header.length && isTChar(header.charCodeAt(cursor))) {
      cursor++;
    }

    if (cursor === tokenStart) {
      throw new SyntaxError(`Unexpected character at index ${cursor}`);
    }

    const token = header.substring(tokenStart, cursor);

    if (protocols.has(token)) {
      throw new SyntaxError(`The "${token}" subprotocol is duplicated`);
    }
    protocols.add(token);

    // Skip trailing whitespace after token
    while (
      cursor < header.length &&
      (header.charCodeAt(cursor) === 0x20 || header.charCodeAt(cursor) === 0x09)
    ) {
      cursor++;
    }

    // Expect end of string or comma separator
    if (cursor >= header.length) break;

    if (header.charCodeAt(cursor) !== 0x2c /* , */) {
      throw new SyntaxError(`Unexpected character at index ${cursor}`);
    }
    cursor++; // consume comma

    // After a comma, there must be another token — trailing comma is invalid
    // (We'll check at the start of the next iteration)
    // Peek ahead: if only whitespace remains, it's a trailing comma
    let peek = cursor;
    while (
      peek < header.length &&
      (header.charCodeAt(peek) === 0x20 || header.charCodeAt(peek) === 0x09)
    ) {
      peek++;
    }
    if (peek >= header.length || !isTChar(header.charCodeAt(peek))) {
      throw new SyntaxError("Unexpected end of input");
    }
  }

  // Ensure we actually got at least one protocol
  if (protocols.size === 0) {
    throw new SyntaxError("Unexpected end of input");
  }

  return protocols;
}

// ─── Close Code Validation ──────────────────────────────────────

/**
 * Reserved close codes that MUST NOT be set in a Close frame.
 * Per RFC 6455 Section 7.4.1.
 */
const RESERVED_CLOSE_CODES = new Set([1004, 1005, 1006]);

/**
 * Check if a WebSocket close status code is valid for use in a Close frame.
 *
 * Per RFC 6455 Section 7.4:
 * - 1000–1014 are valid (except 1004, 1005, 1006 which are reserved)
 * - 3000–4999 are available for application/library/framework use
 */
export function isValidStatusCode(code: number): boolean {
  if (code >= 1000 && code <= 1014 && !RESERVED_CLOSE_CODES.has(code)) {
    return true;
  }
  if (code >= 3000 && code <= 4999) {
    return true;
  }
  return false;
}

// ─── Basic Auth Parsing ─────────────────────────────────────────

/**
 * Strict base64 pattern for the Authorization header value.
 * Matches: `Basic <base64-encoded-credentials>`
 * Case-insensitive match on "Basic" per RFC 7617.
 */
const BASIC_AUTH_RE = /^ *[Bb][Aa][Ss][Ii][Cc] +([A-Za-z0-9._~+/-]+=*) *$/;

/**
 * Parse a Basic Authorization header, extracting the password as a raw Buffer.
 *
 * This is a **non-standard** parser designed for OCPP:
 * - Supports colons in the username (which RFC 7617 normally disallows).
 *   OCPP guarantees the username equals the Charge Point identity, so we
 *   use `identity` as a prefix to locate the `:` separator.
 * - Returns the password as a `Buffer` to support binary keys, as
 *   recommended by the OCPP security whitepaper.
 *
 * @param authHeader - The raw `Authorization` header value (e.g. `"Basic dXNlcjpwYXNz"`)
 * @param identity   - The expected username (Charge Point identity from the URL path)
 * @returns The password as a `Buffer`, or `undefined` if parsing fails or identity doesn't match
 */
export function parseBasicAuth(
  authHeader: string,
  identity: string,
): Buffer | undefined {
  if (!authHeader) return undefined;

  const match = BASIC_AUTH_RE.exec(authHeader);
  if (!match?.[1]) return undefined;

  try {
    const decoded = Buffer.from(match[1], "base64");
    const prefix = Buffer.from(`${identity}:`);

    // Identity-prefix matching: the decoded buffer must start with `identity:`
    if (
      decoded.length > prefix.length &&
      decoded.subarray(0, prefix.length).equals(prefix)
    ) {
      return decoded.subarray(prefix.length);
    }

    // Fallback: standard first-colon split (for non-OCPP or mismatched identity)
    const colonIdx = decoded.indexOf(0x3a); // ':'
    if (colonIdx !== -1) {
      const user = decoded.subarray(0, colonIdx).toString("utf8");
      if (user === identity) {
        return decoded.subarray(colonIdx + 1);
      }
    }
  } catch {
    // Malformed base64 — treat as no password
  }

  return undefined;
}

// ─── Handshake Abort ────────────────────────────────────────────

/**
 * Reject a WebSocket upgrade by sending an HTTP error response
 * to the raw socket and closing the connection.
 */
export function abortHandshake(
  socket: Duplex,
  statusCode: number,
  reason?: string,
  extraHeaders?: Record<string, string>,
): void {
  if (!socket.writable) return;

  const statusText = http.STATUS_CODES[statusCode] ?? "Unknown";
  const body = reason ?? statusText;
  const bodyBytes = Buffer.byteLength(body, "utf8");

  const allHeaders: Record<string, string | number> = {
    Connection: "close",
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": bodyBytes,
    ...extraHeaders,
  };

  const headerBlock = Object.entries(allHeaders)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");

  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n${headerBlock}\r\n\r\n${body}`,
  );
}
