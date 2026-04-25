import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { OCPPServer } from "../../server.js";
import { createOcppExpressContext } from "./context.js";
import type { AttachOcppExpressOptions, OcppExpressBinding } from "./types.js";

export function attachOcppExpress(
  httpServer: HttpServer,
  server: OCPPServer,
  options: AttachOcppExpressOptions = {},
): OcppExpressBinding {
  const context = createOcppExpressContext(server);
  let disposed = false;

  const upgradeHandler = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    if (!shouldHandleUpgrade(req, options)) return;
    server.handleUpgrade(req, socket, head);
  };

  httpServer.on("upgrade", upgradeHandler);

  const dispose = () => {
    if (disposed) return;
    httpServer.removeListener("upgrade", upgradeHandler);
    disposed = true;
  };

  return {
    server,
    httpServer,
    context,
    dispose,
    async close(closeOptions) {
      dispose();
      await server.close(closeOptions);

      if (options.closeHttpServer && httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
    },
  };
}

function shouldHandleUpgrade(
  req: IncomingMessage,
  options: AttachOcppExpressOptions,
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

function getPathname(req: IncomingMessage): string | undefined {
  try {
    return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      .pathname;
  } catch {
    return undefined;
  }
}

function normalizePrefixes(prefix?: string | string[]): string[] {
  if (!prefix) return [];
  return (Array.isArray(prefix) ? prefix : [prefix]).filter(Boolean);
}

function matchesPrefix(prefix: string, pathname: string): boolean {
  const normalized = prefix.endsWith("/*") ? prefix.slice(0, -2) : prefix;
  if (normalized === "" || normalized === "/") return true;
  return pathname === normalized || pathname.startsWith(`${normalized}/`);
}
