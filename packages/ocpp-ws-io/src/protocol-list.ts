/**
 * Throws when a protocol is listed more than once. A duplicate changes nothing
 * on the server's side of the negotiation, but it is a configuration mistake,
 * and `ws` and browsers already refuse a client's duplicated subprotocol.
 */
export function assertUniqueProtocols(
  protocols: readonly string[] | undefined,
): void {
  if (!protocols) return;
  const seen = new Set<string>();
  for (const protocol of protocols) {
    if (seen.has(protocol)) {
      throw new TypeError(`protocols lists "${protocol}" more than once`);
    }
    seen.add(protocol);
  }
}
