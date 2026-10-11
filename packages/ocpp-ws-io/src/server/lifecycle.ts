import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { LoggerLike } from "../types/logger.js";
import type { AnyOCPPProtocol } from "../types/protocol.js";
import type { OCPPServerClient } from "./server-client.js";

/** The listeners the server attached to an HTTP server, removed on close(). */
export interface HttpServerListeners {
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  request?: (req: IncomingMessage, res: ServerResponse) => void;
}

/**
 * Wait for each client's send buffer to empty, at most 5 s per client, so
 * messages in flight are not lost when the server closes.
 */
export async function drainClients<P extends AnyOCPPProtocol>(
  clients: Iterable<OCPPServerClient<P>>,
  logger: LoggerLike | null,
): Promise<void> {
  const drainTimeout = 5000;
  const drainPromises = Array.from(clients).map(async (client) => {
    if (client.bufferedAmount > 0) {
      logger?.debug?.("Waiting for client buffer to drain", {
        identity: client.identity,
        bufferedAmount: client.bufferedAmount,
      });
      await new Promise<void>((resolve) => {
        let elapsed = 0;
        const check = setInterval(() => {
          elapsed += 50;
          if (client.bufferedAmount === 0 || elapsed >= drainTimeout) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
    }
  });
  await Promise.allSettled(drainPromises);
}

/**
 * Remove the server's listeners from every HTTP server it is attached to,
 * close the ones it created, and forget them all.
 */
export async function closeHttpServers(
  httpServers: Set<Server>,
  ownedHttpServers: Set<Server>,
  attachedHandlers: Map<Server, HttpServerListeners>,
): Promise<void> {
  const serverClosePromises: Promise<void>[] = [];
  for (const srv of httpServers) {
    const handlers = attachedHandlers.get(srv);
    if (handlers) {
      srv.removeListener("upgrade", handlers.upgrade);
      if (handlers.request) srv.removeListener("request", handlers.request);
    }
    if (ownedHttpServers.has(srv)) {
      serverClosePromises.push(
        new Promise<void>((resolve) => {
          srv.close(() => resolve());
        }),
      );
    }
  }
  await Promise.allSettled(serverClosePromises);
  httpServers.clear();
  ownedHttpServers.clear();
  attachedHandlers.clear();
}
