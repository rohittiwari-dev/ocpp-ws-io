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

/**
 * OCPP versions before 2.1: their RPC framework has message types 2 to 4
 * only (OCPP-J 1.6 §4.1.3, OCPP 2.0.1 Part 4 §4.1.3).
 */
const BEFORE_OCPP_21 = /^ocpp(1\.\d|2\.0(\.\d)?)$/;

/**
 * Whether a connection may send and receive SEND (6) messages: on OCPP 2.1,
 * which defines them, and on a custom protocol, whose two ends are both its
 * user's. OCPP versions before 2.1 answer one with MessageTypeNotSupported.
 */
export function supportsSend(protocol: string | undefined): boolean {
  return protocol !== undefined && !BEFORE_OCPP_21.test(protocol);
}
