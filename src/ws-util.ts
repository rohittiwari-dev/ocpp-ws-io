/**
 * WebSocket utility functions.
 * Includes subprotocol parsing extracted from the 'ws' module source
 * and handshake abort utility for server-side upgrade rejection.
 */

import type { Duplex } from "node:stream";

/**
 * Abort a WebSocket handshake by writing an HTTP error response
 * directly to the raw socket and destroying it.
 */
export function abortHandshake(
  socket: Duplex,
  code: number,
  message?: string,
  headers?: Record<string, string>,
): void {
  const body = message || `HTTP ${code}`;
  const headerLines: string[] = [
    `HTTP/1.1 ${code} ${body}`,
    "Connection: close",
    "Content-Type: text/plain",
    `Content-Length: ${Buffer.byteLength(body)}`,
  ];

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      headerLines.push(`${key}: ${value}`);
    }
  }

  socket.write(headerLines.join("\r\n") + "\r\n\r\n" + body);
  socket.destroy();
}

/**
 * Parse the `Sec-WebSocket-Protocol` header value into a Set of subprotocol names.
 *
 * Based on the 'ws' module source (MIT licensed).
 * Validates for proper token characters per RFC 6455.
 */
export function parseSubprotocols(header: string): Set<string> {
  const protocols = new Set<string>();
  let start = -1;
  let end = -1;
  let i = 0;

  for (i = 0; i < header.length; i++) {
    const code = header.charCodeAt(i);

    if (end === -1 && isTokenCharCode(code)) {
      if (start === -1) start = i;
    } else if (
      i !== 0 &&
      (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */
    ) {
      if (end === -1 && start !== -1) end = i;
    } else if (code === 0x2c /* ',' */) {
      if (start === -1) {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }

      if (end === -1) end = i;

      const protocol = header.slice(start, end);

      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }

      protocols.add(protocol);
      start = end = -1;
    } else {
      throw new SyntaxError(`Unexpected character at index ${i}`);
    }
  }

  if (start === -1 || end !== -1) {
    throw new SyntaxError("Unexpected end of input");
  }

  const protocol = header.slice(start, i);

  if (protocols.has(protocol)) {
    throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
  }

  protocols.add(protocol);
  return protocols;
}

/**
 * Check if a character code is a valid HTTP token character.
 * Per RFC 7230: token = 1*tchar
 * tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." /
 *          "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA
 */
function isTokenCharCode(code: number): boolean {
  return (
    code >= 0x21 &&
    code <= 0x7e && // Visible ASCII
    code !== 0x22 && // "
    code !== 0x28 && // (
    code !== 0x29 && // )
    code !== 0x2c && // ,
    code !== 0x2f && // /
    code !== 0x3a && // :
    code !== 0x3b && // ;
    code !== 0x3c && // <
    code !== 0x3d && // =
    code !== 0x3e && // >
    code !== 0x3f && // ?
    code !== 0x40 && // @
    code !== 0x5b && // [
    code !== 0x5c && // \
    code !== 0x5d && // ]
    code !== 0x7b && // {
    code !== 0x7d // }
  );
}

/**
 * Check if a WebSocket close code is valid per RFC 6455.
 */
export function isValidStatusCode(code: number): boolean {
  return (
    (code >= 1000 &&
      code <= 1014 &&
      code !== 1004 &&
      code !== 1005 &&
      code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
}
