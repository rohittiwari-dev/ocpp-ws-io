import WebSocket from "ws";
import { UnexpectedHttpResponse } from "../core/errors.js";
import { isValidStatusCode } from "../core/ws-util.js";
import type { CloseOptions } from "../types/calls.js";
import type { ClientOptions } from "../types/client.js";
import { type AnyOCPPProtocol, ConnectionState } from "../types/protocol.js";
import { stopBackpressureDrain } from "./backpressure.js";
import type { ClientContext } from "./context.js";
import { drainOfflineQueue, flushOfflineQueue } from "./outbound.js";
import { INTOLERABLE_ERRORS, scheduleReconnect } from "./reconnect.js";

const { CONNECTING, OPEN, CLOSING, CLOSED } = ConnectionState;

/**
 * connect(): open the socket, and when that fails keep retrying in the
 * background if retryInitialConnect asks for it.
 */
export async function connectClient(client: ClientContext): Promise<{
  response: import("node:http").IncomingMessage;
}> {
  if (client.state !== CLOSED) {
    throw new Error(`Cannot connect: client is in state ${client.state}`);
  }

  client.state = CONNECTING;
  client.reconnectAttempt = 0;
  client.closeRequested = false;

  try {
    return await client.connectInternal();
  } catch (err) {
    // `reconnect: true` has to mean "keep trying", including from the very
    // first attempt. Reconnection previously started only once an
    // *established* connection dropped, so a charge point that booted while
    // the CSMS was down threw once and never retried — the exact outage the
    // option exists for. connect() still rejects, so the caller learns about
    // the failure; the retry runs in the background and close() cancels it.
    const msg = err instanceof Error ? err.message : "";
    if (
      (client.options as ClientOptions).retryInitialConnect === true &&
      client.options.reconnect &&
      client.options.maxReconnects > 0 &&
      !client.closeRequested &&
      !INTOLERABLE_ERRORS.has(msg)
    ) {
      scheduleReconnect(client);
    }
    throw err;
  }
}

/**
 * Open a socket and resolve with the upgrade response once it is open. On
 * open, keep the negotiated protocol, start pinging, and send what was queued.
 */
export async function openConnection(client: ClientContext): Promise<{
  response: import("node:http").IncomingMessage;
}> {
  return new Promise((resolve, reject) => {
    const endpoint = client.buildEndpoint();
    const wsOptions = client.buildWsOptions();

    client.logger?.debug?.("Connecting", { url: endpoint });
    client.emitter.emit("connecting", { url: endpoint });

    const ws = new WebSocket(
      endpoint,
      // ws takes a mutable list.
      [...(client.options.protocols ?? [])],
      wsOptions,
    );
    client.ws = ws;

    // The handshake response, from ws's own event: ws clears its request
    // (and so the response with it) before "open".
    let upgradeResponse: import("node:http").IncomingMessage | undefined;
    const onUpgrade = (res: import("node:http").IncomingMessage) => {
      upgradeResponse = res;
    };

    const onOpen = () => {
      cleanup();
      client.state = OPEN;
      // ws reports no subprotocol as ""; the client has none (undefined).
      client.protocol = ws.protocol || undefined;
      client.badMessageCount = 0;
      client.badMessageWindowStart = 0;

      // Narrow protocols to negotiated protocol for future reconnects (prevents flip-flopping)
      if (ws.protocol && client.reconnectAttempt === 0) {
        // ws only accepts a protocol this client offered.
        client.options.protocols = [ws.protocol as AnyOCPPProtocol];
      }

      // Reset the reconnect counter on a successful (re)connection so that
      // `maxReconnects` and backoff are per-disconnection-incident, not a
      // cumulative lifetime budget (OCPP 2.0.1 §J.1 backoff resets on connect).
      client.reconnectAttempt = 0;

      client.openedAt = Date.now();
      client.attachWebsocket(ws);
      client.startPing();

      // Flush offline queue (atomic drain to prevent re-entry)
      flushOfflineQueue(client);

      // Flush outbound buffer (messages queued during CONNECTING)
      if (client.outboundBuffer.length > 0) {
        const buffer = client.outboundBuffer;
        client.outboundBuffer = [];
        for (const msg of buffer) client.ws?.send(msg);
      }

      client.logger?.info?.("Connected", { protocol: ws.protocol });

      // ws emits "upgrade" before "open", so the response is set here.
      const result = { response: upgradeResponse! };
      client.emitter.emit("open", result);
      resolve(result);
    };

    const onError = (err: Error) => {
      cleanup();
      client.state = CLOSED;
      client.logger?.error?.("Connection error", {
        error: err.message,
      });
      // The connect() rejection is the primary failure signal — only emit
      // "error" when someone listens, otherwise EventEmitter throws and
      // the rejection below never runs.
      if (client.emitter.listenerCount("error") > 0)
        client.emitter.emit("error", err);
      reject(err);
    };

    const onUnexpectedResponse = (
      _req: import("node:http").ClientRequest,
      res: import("node:http").IncomingMessage,
    ) => {
      cleanup();
      client.state = CLOSED;
      const err = new UnexpectedHttpResponse(
        `Unexpected HTTP response: ${res.statusCode}`,
        res.statusCode ?? 0,
        res.headers as Record<string, string>,
      );
      client.logger?.error?.("Unexpected HTTP response", {
        statusCode: res.statusCode,
      });
      if (client.emitter.listenerCount("error") > 0)
        client.emitter.emit("error", err);
      reject(err);
    };

    const cleanup = () => {
      ws.removeListener("upgrade", onUpgrade);
      ws.removeListener("open", onOpen);
      ws.removeListener("error", onError);
      ws.removeListener("unexpected-response", onUnexpectedResponse);
    };

    ws.on("upgrade", onUpgrade);
    ws.on("open", onOpen);
    ws.on("error", onError);
    ws.on("unexpected-response", onUnexpectedResponse);
  });
}

/**
 * close(): stop reconnecting and close the socket, once however often it is
 * called. A client already closed only settles its offline queue.
 */
export async function closeClient(
  client: ClientContext,
  options: CloseOptions,
): Promise<{ code: number; reason: string }> {
  const {
    code = 1000,
    reason = "",
    awaitPending = true,
    force = false,
  } = options;

  if (client.closePromise) return client.closePromise;

  // Recorded before any await so an in-flight reconnect attempt can see it.
  client.closeRequested = true;

  if (client.state === CLOSED) {
    // Already closed, so there is no socket to shut down — but a client that
    // never connected (or that gave up reconnecting) can still be holding
    // offline-queued calls whose callers are waiting on a promise. Nothing
    // will ever flush them, so settle them here instead of returning early
    // and stranding them forever.
    drainOfflineQueue(client, "Client closed");
    client.outboundBuffer.length = 0;
    return { code: 1000, reason: "" };
  }

  // Cancel reconnection
  if (client.reconnectTimer) {
    clearTimeout(client.reconnectTimer);
    client.reconnectTimer = null;
  }

  client.closePromise = closeConnection(
    client,
    code,
    reason,
    awaitPending,
    force,
  );
  return client.closePromise;
}

/**
 * Close the socket: reject the calls not yet sent, wait for the ones sent
 * unless forced, then close or terminate it and clean up.
 */
async function closeConnection(
  client: ClientContext,
  code: number,
  reason: string,
  awaitPending: boolean,
  force: boolean,
): Promise<{ code: number; reason: string }> {
  client.state = CLOSING;
  client.stopPing();
  client.emitter.emit("closing");

  // Calls still waiting behind the concurrency limit have not been sent, so
  // there is nothing to await — but nothing settled them either, and once the
  // socket is gone they can never run. Reject them before draining the
  // in-flight ones. (force skips this only in the sense that everything is
  // rejected below anyway.)
  const droppedFromQueue = client.callQueue.clear(
    new Error("Client closed before the call was sent"),
  );
  if (droppedFromQueue > 0) {
    client.logger?.debug?.("Rejected queued calls on close", {
      count: droppedFromQueue,
    });
  }

  if (!force && awaitPending) {
    // Wait for pending calls to resolve
    const pendingPromises = Array.from(client.pendingCalls.values()).map(
      (p) =>
        new Promise<void>((resolve) => {
          const origResolve = p.resolve;
          const origReject = p.reject;
          p.resolve = (v: unknown) => {
            origResolve(v);
            resolve();
          };
          p.reject = (r: unknown) => {
            origReject(r);
            resolve();
          };
        }),
    );
    if (pendingPromises.length > 0) {
      await Promise.allSettled(pendingPromises);
    }
  }

  return new Promise<{ code: number; reason: string }>((resolve) => {
    if (!client.ws || client.ws.readyState === WebSocket.CLOSED) {
      client.state = CLOSED;
      cleanup(client);
      const result = { code, reason };
      client.emitter.emit("close", result);
      resolve(result);
      return;
    }

    const onClose = (closeCode: number, closeReason: Buffer) => {
      client.ws?.removeListener("close", onClose);
      client.state = CLOSED;
      cleanup(client);
      const result = {
        code: closeCode,
        reason: closeReason.toString(),
      };
      client.emitter.emit("close", result);
      resolve(result);
    };

    client.ws.on("close", onClose);

    if (force) {
      client.ws.terminate();
    } else {
      client.ws.close(isValidStatusCode(code) ? code : 1000, reason);
    }
  });
}

/** Release what a closed connection held: timers, queued frames, the socket. */
function cleanup(client: ClientContext): void {
  client.stopPing();
  drainOfflineQueue(client, "Client closed");
  // Buffered frames belong to the connection that is going away. Keeping them
  // replayed stale messages onto the next connect() — and, since nothing
  // bounded this array, grew without limit across a long disconnect.
  client.outboundBuffer.length = 0;
  if (client.pongTimer) {
    clearTimeout(client.pongTimer);
    client.pongTimer = null;
  }
  if (client.reconnectTimer) {
    clearTimeout(client.reconnectTimer);
    client.reconnectTimer = null;
  }
  stopBackpressureDrain(client);
  const queued = client.backpressureQueue.splice(0);
  for (const entry of queued) {
    entry.cb?.(new Error("Connection closed"));
  }
  client.closePromise = null;
  client.ws = null;
}

/** Route an open socket's events to the client. */
export function attachWebsocket(client: ClientContext, ws: WebSocket): void {
  ws.on("message", (data: WebSocket.RawData) => client.onMessage(data));
  ws.on("close", (code: number, reason: Buffer) =>
    client.onClose(code, reason),
  );
  ws.on("error", (err: Error) => {
    // Node throws when 'error' is emitted with no listener attached. The
    // connect-phase handlers already guard this; the post-open handler did
    // not, so any socket error after the connection opened crashed a process
    // that had not registered an error listener.
    if (client.emitter.listenerCount("error") > 0) {
      client.emitter.emit("error", err);
    } else {
      client.logger?.error?.("Socket error (no error listener attached)", {
        identity: client.identity,
        error: err.message,
      });
    }
  });
  ws.on("ping", () => {
    client.recordActivity();
    client.emitter.emit("ping");
  });
  ws.on("pong", () => {
    // Clear pong timeout — connection is alive
    if (client.pongTimer) {
      clearTimeout(client.pongTimer);
      client.pongTimer = null;
    }
    client.recordActivity();
    client.emitter.emit("pong");
  });
}
