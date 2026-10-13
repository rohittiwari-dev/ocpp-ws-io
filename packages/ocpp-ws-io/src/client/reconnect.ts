import { abortHandlers } from "../core/handler-run.js";
import { ConnectionState } from "../types/protocol.js";
import type { ClientContext } from "./context.js";
import { drainOfflineQueue, rejectPendingCalls } from "./outbound.js";

const { CONNECTING, CLOSING, CLOSED } = ConnectionState;

/** Errors that should stop reconnection immediately */
export const INTOLERABLE_ERRORS = new Set([
  "Maximum redirects exceeded",
  "Server sent no subprotocol",
  "Server sent an invalid subprotocol",
  "Server sent a subprotocol but none was requested",
  "Invalid Sec-WebSocket-Accept header",
]);

/**
 * The socket closed: settle the pending calls, then reconnect, or close for
 * good when close() asked for it or no attempts are left.
 */
export function handleClose(
  client: ClientContext,
  code: number,
  reason: Buffer,
): void {
  client.stopPing();
  // A pending pong timer must not fire a spurious pongTimeout for a
  // connection that already closed (review fix).
  if (client.pongTimer) {
    clearTimeout(client.pongTimer);
    client.pongTimer = null;
  }
  const reasonStr = reason.toString();
  rejectPendingCalls(client, `Connection closed (${code}: ${reasonStr})`);
  // Nothing a running handler returns can reach the peer now.
  abortHandlers(
    client.runningHandlers,
    new Error(`Connection closed (${code}: ${reasonStr})`),
  );

  if (client.state !== CLOSING) {
    // Unexpected close — emit disconnect (transient, reconnect may follow)
    client.logger?.info?.("Disconnected", { code, reason: reasonStr });
    client.emitter.emit("disconnect", { code, reason: reasonStr });

    if (
      client.options.reconnect &&
      client.reconnectAttempt < client.options.maxReconnects
    ) {
      scheduleReconnect(client);
    } else {
      // No reconnect — this is a permanent close
      client.state = CLOSED;
      // Nothing will ever flush the offline queue now, so settle it rather
      // than leaving those callers pending forever.
      drainOfflineQueue(
        client,
        `Connection closed permanently (${code}: ${reasonStr})`,
      );
      client.outboundBuffer.length = 0;
      client.emitter.emit("close", { code, reason: reasonStr });
    }
  } else {
    client.state = CLOSED;
    // close() handles the emit
  }
}

/**
 * Wait out the next backoff delay (OCPP-J 2.0.1 / 2.1 §5.3), then reconnect;
 * stop on an error that retrying cannot fix.
 */
export function scheduleReconnect(client: ClientContext): void {
  // close() may have landed between the socket dropping and this call.
  if (client.closeRequested) return;
  client.reconnectAttempt++;
  client.state = CONNECTING;

  // OCPP-J 2.0.1 / 2.1 §5.3: start from the minimum, double after every
  // failed attempt, and add a new random part to every wait. The random part
  // only ever adds (up to 25%), so no wait drops below backoffMin, and
  // chargers that reached backoffMax still spread out instead of
  // reconnecting in step after a CSMS restart.
  // Floor the base delay. `backoffMin: 0` collapsed the exponential term to
  // zero, so a client that could not reach the CSMS reconnected in a tight
  // loop, saturating a CPU and hammering the server it was waiting on.
  const base = Math.max(50, client.options.backoffMin);
  const max = Math.max(base, client.options.backoffMax);
  const delayMs =
    Math.min(max, base * 2 ** (client.reconnectAttempt - 1)) *
    (1 + Math.random() * 0.25);

  client.logger?.warn?.("Reconnecting", {
    attempt: client.reconnectAttempt,
    delayMs: Math.round(delayMs),
  });
  client.emitter.emit("reconnect", {
    attempt: client.reconnectAttempt,
    delay: delayMs,
  });

  client.reconnectTimer = setTimeout(async () => {
    client.reconnectTimer = null;
    // close() clears a *pending* timer, but once this callback has fired
    // there is nothing left to clear — so the attempt has to check for
    // itself, both before connecting and after, or a closed client comes
    // back to life and sits in CONNECTING forever.
    if (client.closeRequested) {
      client.state = CLOSED;
      return;
    }
    try {
      await client.connectInternal();
      if (client.closeRequested) {
        // The caller closed us while this attempt was in flight. Tear the
        // socket we just opened straight back down.
        client.logger?.debug?.("Closed during reconnect — dropping new socket");
        client.ws?.terminate();
        client.state = CLOSED;
      }
    } catch (err) {
      if (client.closeRequested) {
        client.state = CLOSED;
        return;
      }
      // Intolerable errors — do not retry
      const msg = err instanceof Error ? err.message : "";
      if (INTOLERABLE_ERRORS.has(msg)) {
        client.logger?.error?.("Intolerable error — stopping reconnection", {
          error: msg,
        });
        client.state = CLOSED;
        client.emitter.emit("close", { code: 1001, reason: msg });
        return;
      }

      if (
        client.reconnectAttempt < client.options.maxReconnects &&
        client.options.reconnect
      ) {
        scheduleReconnect(client);
      } else {
        // Max reconnects exhausted
        client.state = CLOSED;
        client.emitter.emit("close", {
          code: 1001,
          reason: "Max reconnection attempts exhausted",
        });
      }
    }
  }, delayMs);
}
