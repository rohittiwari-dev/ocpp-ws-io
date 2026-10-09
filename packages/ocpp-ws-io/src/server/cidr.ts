import { isIPv4, isIPv6 } from "node:net";

/**
 * Parses an IPv4 string into an unsigned 32-bit integer.
 */
function ip4ToInt(ip: string): number {
  return (
    ip
      .split(".")
      .reduce((int, octet) => (int << 8) + parseInt(octet, 10), 0) >>> 0
  );
}

const V6_MAX = (1n << 128n) - 1n;

/**
 * Parses an IPv6 string into a 128-bit BigInt, expanding `::` compression and
 * any trailing IPv4-mapped suffix (e.g. `::ffff:192.168.0.1`).
 * Returns `null` if the address is malformed.
 */
function ip6ToBigInt(ip: string): bigint | null {
  // Strip an optional zone id (e.g. "fe80::1%eth0")
  ip = ip.split("%")[0]!;

  // Convert a trailing dotted-quad (IPv4-mapped) into two hextets.
  const v4 = ip.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = [v4[2], v4[3], v4[4], v4[5]].map((n) => parseInt(n!, 10));
    if (o.some((n) => n > 255)) return null;
    const hi = ((o[0]! << 8) | o[1]!).toString(16);
    const lo = ((o[2]! << 8) | o[3]!).toString(16);
    ip = `${v4[1]}${hi}:${lo}`;
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  let hextets: string[];
  if (halves.length === 2) {
    const tail = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    hextets = [...head, ...Array<string>(missing).fill("0"), ...tail];
  } else {
    hextets = head;
  }
  if (hextets.length !== 8) return null;

  let result = 0n;
  for (const h of hextets) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
    result = (result << 16n) | BigInt(parseInt(h, 16));
  }
  return result;
}

/**
 * Checks if a given remote IP matches any of the allowed IPs.
 * Allowed entries may be an exact IPv4/IPv6 address, an IPv4 CIDR block
 * (e.g. `"10.0.0.0/8"`), or an IPv6 CIDR block (e.g. `"2001:db8::/32"`).
 */
export function isIPAllowed(remoteIP: string, allowedIPs: string[]): boolean {
  // Normalize IPv4-mapped IPv6 addresses (e.g., ::ffff:192.168.1.1 -> 192.168.1.1)
  let normalizedIP = remoteIP;
  if (normalizedIP.startsWith("::ffff:")) {
    normalizedIP = normalizedIP.substring(7);
  }

  for (const allowed of allowedIPs) {
    if (allowed === normalizedIP) {
      return true; // Exact match for IPv4 or IPv6
    }

    // Handle CIDR notation
    if (allowed.includes("/")) {
      const parts = allowed.split("/");
      const subnet = parts[0];
      const maskStr = parts[1];

      if (!subnet || !maskStr) continue;

      const mask = parseInt(maskStr, 10);

      // IPv4 CIDR
      if (isIPv4(normalizedIP) && isIPv4(subnet)) {
        if (mask < 0 || mask > 32) continue;
        const ipInt = ip4ToInt(normalizedIP);
        const subnetInt = ip4ToInt(subnet);

        // Handle /0 securely
        const maskInt = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;

        if ((ipInt & maskInt) === (subnetInt & maskInt)) {
          return true;
        }
      } else if (isIPv6(normalizedIP) && isIPv6(subnet)) {
        // IPv6 CIDR
        if (mask < 0 || mask > 128) continue;
        const ipInt = ip6ToBigInt(normalizedIP);
        const subnetInt = ip6ToBigInt(subnet);
        if (ipInt === null || subnetInt === null) continue;

        const maskInt = mask === 0 ? 0n : (~0n << BigInt(128 - mask)) & V6_MAX;

        if ((ipInt & maskInt) === (subnetInt & maskInt)) {
          return true;
        }
      }
    }
  }

  return false;
}
