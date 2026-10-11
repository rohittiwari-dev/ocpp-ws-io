import type { ClientOptions } from "../types/client.js";
import { ConnectionState } from "../types/protocol.js";
import type { ClientContext } from "./context.js";

const { OPEN } = ConnectionState;

/**
 * Ping the peer every pingIntervalMs, with jitter, and terminate a connection
 * whose pong does not come back within pongTimeoutMs.
 */
export function startPing(client: ClientContext): void {
  if (client.options.pingIntervalMs <= 0) return;

  const pongTimeoutMs =
    (client.options as ClientOptions).pongTimeoutMs ??
    client.options.pingIntervalMs + 5000;

  const doPing = () => {
    if (client.state !== OPEN || !client.ws) return;

    if (client.options.deferPingsOnActivity) {
      const elapsed = Date.now() - client.lastActivity;
      if (elapsed < client.options.pingIntervalMs) {
        client.pingTimer = setTimeout(
          doPing,
          client.options.pingIntervalMs - elapsed,
        );
        return;
      }
    }

    client.ws.ping();

    // Start pong timeout — if no pong received, connection is dead
    // Only arm a pong deadline when none is outstanding. Overwriting the
    // handle orphaned the previous timer — it still fired, and terminated
    // whatever socket was current by then, including a healthy reconnect.
    // Keeping the first unanswered ping's deadline also preserves dead-peer
    // detection when pongTimeoutMs exceeds pingIntervalMs.
    if (pongTimeoutMs > 0 && !client.pongTimer) {
      client.pongTimer = setTimeout(() => {
        client.pongTimer = null;
        client.logger?.warn?.("Pong timeout — terminating dead connection", {
          identity: client.identity,
          timeoutMs: pongTimeoutMs,
        });
        // Emit pongTimeout event for plugin observability
        client.emitter.emit("pongTimeout", { identity: client.identity });
        client.ws?.terminate();
      }, pongTimeoutMs);
    }

    // Add ±25% jitter to prevent thundering herds on mass reconnections
    const jitteredInterval =
      client.options.pingIntervalMs * (0.75 + Math.random() * 0.5);
    client.pingTimer = setTimeout(doPing, jitteredInterval);
  };

  // Add ±25% jitter to the very first ping as well
  const initialJitteredInterval =
    client.options.pingIntervalMs * (0.75 + Math.random() * 0.5);
  client.pingTimer = setTimeout(doPing, initialJitteredInterval);
}

/** Stop the ping timer. */
export function stopPing(client: ClientContext): void {
  if (client.pingTimer) {
    clearTimeout(client.pingTimer);
    client.pingTimer = null;
  }
}
