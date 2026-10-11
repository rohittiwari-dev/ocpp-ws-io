import WebSocket from "ws";
import type { ClientContext } from "./context.js";

/** Maximum bytes allowed in the ws send buffer before applying backpressure (512KB) */
export const BACKPRESSURE_THRESHOLD = 512 * 1024;

/** Frames held while the socket is over threshold, before dropping oldest. */
const BACKPRESSURE_MAX_QUEUE = 1000;

/** How long a frame may wait for the peer to drain before it is failed. */
const BACKPRESSURE_MAX_WAIT_MS = 10_000;

/**
 * Wraps ws.send() with backpressure protection. When bufferedAmount
 * exceeds the threshold, sends are queued and flushed FIFO by a single
 * shared 50ms drain timer (one per client, not one per send — report M10).
 * Entries older than 10s are sent regardless, preserving the previous
 * timeout semantics. Prevents OOM on slow 2G/3G charger connections.
 */
export function safeSend(
  client: ClientContext,
  ws: WebSocket | null,
  data: string,
  cb?: (err?: Error) => void,
): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    cb?.(new Error("WebSocket is not open"));
    return;
  }

  if (
    ws.bufferedAmount > BACKPRESSURE_THRESHOLD ||
    client.backpressureQueue.length > 0
  ) {
    if (client.backpressureQueue.length === 0) {
      client.logger?.warn?.("Backpressure — pausing send", {
        identity: client.identity,
        bufferedAmount: ws.bufferedAmount,
        threshold: BACKPRESSURE_THRESHOLD,
      });
      // Emit identity + buffered amount for operator alerting
      client.emitter.emit("backpressure", {
        identity: client.identity,
        bufferedAmount: ws.bufferedAmount,
      });
    }
    // Bound the queue. Under sustained backpressure this array grew without
    // limit, holding every frame in memory for a peer that is not reading.
    if (client.backpressureQueue.length >= BACKPRESSURE_MAX_QUEUE) {
      const dropped = client.backpressureQueue.shift();
      dropped?.cb?.(
        new Error("Backpressure queue full — oldest frame dropped"),
      );
      client.logger?.warn?.("Backpressure queue full — dropping oldest", {
        identity: client.identity,
        max: BACKPRESSURE_MAX_QUEUE,
      });
    }
    client.backpressureQueue.push({ data, cb, enqueuedAt: Date.now() });
    startBackpressureDrain(client, ws);
    return;
  }

  ws.send(data, cb);
}

/**
 * Drain the queue every 50 ms while the socket is over the threshold,
 * failing frames that wait too long.
 */
function startBackpressureDrain(client: ClientContext, ws: WebSocket): void {
  if (client.backpressureTimer) return;
  client.backpressureTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      stopBackpressureDrain(client);
      const failed = client.backpressureQueue.splice(0);
      for (const entry of failed) {
        entry.cb?.(new Error("WebSocket closed during backpressure wait"));
      }
      return;
    }
    const now = Date.now();
    while (client.backpressureQueue.length > 0) {
      const head = client.backpressureQueue[0];
      if (!head) break;

      if (now - head.enqueuedAt >= BACKPRESSURE_MAX_WAIT_MS) {
        // Aged out. This used to send anyway, which flushed the whole
        // backlog into a socket that was already over the threshold — the
        // timeout defeated the backpressure it existed to apply. A frame the
        // peer has not been able to accept for ten seconds is stale for OCPP
        // purposes, so the caller is told instead.
        client.backpressureQueue.shift();
        head.cb?.(
          new Error("Backpressure timeout — peer did not drain in time"),
        );
        continue;
      }

      if (ws.bufferedAmount <= BACKPRESSURE_THRESHOLD) {
        client.backpressureQueue.shift();
        ws.send(head.data, head.cb);
      } else {
        break;
      }
    }
    if (client.backpressureQueue.length === 0) {
      stopBackpressureDrain(client);
    }
  }, 50);
}

/** Stop the drain timer. */
export function stopBackpressureDrain(client: ClientContext): void {
  if (client.backpressureTimer) {
    clearInterval(client.backpressureTimer);
    client.backpressureTimer = null;
  }
}
