import { isIPv4 } from "node:net";

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

/**
 * Checks if a given remote IP matches any of the allowed IPs.
 * Allowed IPs can be exact IPv4, exact IPv6, or IPv4 CIDR blocks (e.g., "10.0.0.0/8").
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

      // We currently only support IPv4 CIDR blocks
      if (isIPv4(normalizedIP) && isIPv4(subnet)) {
        const ipInt = ip4ToInt(normalizedIP);
        const subnetInt = ip4ToInt(subnet);

        // Handle /0 securely
        const maskInt = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;

        if ((ipInt & maskInt) === (subnetInt & maskInt)) {
          return true;
        }
      }
    }
  }

  return false;
}
