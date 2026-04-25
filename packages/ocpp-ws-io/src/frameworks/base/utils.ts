import type { IncomingMessage } from "node:http";

export interface UpgradeOptions {
  upgradeFilter?: (pathname: string, req: IncomingMessage) => boolean;
  upgradePathPrefix?: string | string[];
}

export function shouldHandleUpgrade(
  req: IncomingMessage,
  options: UpgradeOptions,
): boolean {
  if (req.headers.upgrade?.toLowerCase() !== "websocket") return false;

  const pathname = getPathname(req);
  if (!pathname) return false;

  if (options.upgradeFilter) {
    return options.upgradeFilter(pathname, req);
  }

  const prefixes = normalizePrefixes(options.upgradePathPrefix);
  if (prefixes.length === 0) return true;

  return prefixes.some((prefix) => matchesPrefix(prefix, pathname));
}

export function getPathname(req: IncomingMessage): string | undefined {
  try {
    return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      .pathname;
  } catch {
    return undefined;
  }
}

export function normalizePrefixes(prefix?: string | string[]): string[] {
  if (!prefix) return [];
  return (Array.isArray(prefix) ? prefix : [prefix]).filter(Boolean);
}

export function matchesPrefix(prefix: string, pathname: string): boolean {
  const normalized = prefix.endsWith("/*") ? prefix.slice(0, -2) : prefix;
  if (normalized === "" || normalized === "/") return true;
  return pathname === normalized || pathname.startsWith(`${normalized}/`);
}
