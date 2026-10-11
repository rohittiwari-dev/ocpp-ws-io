import WebSocket from "ws";
import { TimeoutError } from "../core/errors.js";
import { supportsSend } from "../core/protocol-list.js";
import { createId } from "../core/util.js";
import type {
  OCPPSendRequestType,
  SendMethodNames,
} from "../generated/index.js";
import type { CallOptions, NoReplyCallOptions } from "../types/calls.js";
import type { JsonValue } from "../types/json.js";
import type { MiddlewareContext, WireCall } from "../types/middleware.js";
import {
  type AnyOCPPProtocol,
  ConnectionState,
  type KnownProtocol,
  MessageType,
  type OCPPCall,
  type OCPPSend,
} from "../types/protocol.js";
import type { ClientContext } from "./context.js";

const { CONNECTING, OPEN, CLOSED } = ConnectionState;

/**
 * Cap on frames buffered while CONNECTING. Without one, a client that never
 * finishes connecting accumulates every send until the process runs out of
 * memory. Oldest frames are dropped first, matching the offline queue.
 */
const OUTBOUND_BUFFER_MAX = 1000;

/**
 * call(): the arguments sorted out, then the call queued offline, retried,
 * or sent in its turn under callConcurrency.
 */
export async function queueCall(
  client: ClientContext,
  args: unknown[],
): Promise<unknown> {
  let method: string;
  let params: unknown;
  let options: CallOptions | NoReplyCallOptions;

  // A version-named call has its action, a string, where the other form has
  // params (an object), also when it has no params.
  if (typeof args[0] === "string" && typeof args[1] === "string") {
    // call(version, method, params?, options?) — version-specific
    // version is type-level only, not sent on the wire
    method = args[1] as string;
    params = args[2] ?? {};
    options = (args[3] as CallOptions | NoReplyCallOptions) ?? {};
  } else {
    // call(method, params?, options?)
    method = args[0] as string;
    params = args[1] ?? {};
    options = (args[2] as CallOptions | NoReplyCallOptions) ?? {};
  }

  if (
    "noReply" in options &&
    options.noReply &&
    "retries" in options &&
    options.retries
  ) {
    throw new TypeError(
      "noReply cannot be combined with retries: there is no answer to retry on",
    );
  }

  if (client.state !== OPEN) {
    // ── Offline Queue ──
    if (
      client.options.offlineQueue &&
      (client.state === CLOSED || client.state === CONNECTING)
    ) {
      return new Promise((resolve, reject) => {
        const maxSize = client.options.offlineQueueMaxSize ?? 100;
        if (client.offlineQueue.length >= maxSize) {
          const dropped = client.offlineQueue.shift(); // Drop oldest
          dropped?.reject(
            new Error("Offline queue overflow — oldest queued call dropped"),
          );
          client.logger?.warn?.(
            "Offline queue full — dropping oldest message",
            {
              method,
              queueSize: client.offlineQueue.length,
            },
          );
        }
        client.offlineQueue.push({
          method,
          params,
          options,
          resolve,
          reject,
        });
        client.logger?.debug?.("Call queued offline", {
          method,
          queueSize: client.offlineQueue.length,
        });
      });
    }
    throw new Error(`Cannot call: client is in state ${client.state}`);
  }

  // ── Retry wrapper with Full Jitter ──
  if ("retries" in options) {
    const maxRetries = options.retries ?? 0;
    if (maxRetries > 0) {
      return callWithRetry(client, method, params, options, maxRetries);
    }
  }

  return client.callQueue.push(() => sendCall(client, method, params, options));
}

/**
 * send(): an OCPP 2.1 SEND through the middleware, validated in strict mode,
 * and written once onBeforeSend allows it.
 */
export async function sendMessage<P extends AnyOCPPProtocol>(
  client: ClientContext,
  method: string,
  params:
    | OCPPSendRequestType<KnownProtocol<P>, SendMethodNames<KnownProtocol<P>>>
    | object,
): Promise<void> {
  if (!supportsSend(client.protocol)) {
    throw new Error(
      `SEND messages exist only in OCPP 2.1 and custom protocols; this connection uses ${client.protocol ?? "no subprotocol"}`,
    );
  }
  if (client.state !== OPEN || !client.ws) {
    throw new Error(`Cannot send: client is in state ${client.state}`);
  }

  const messageId = newMessageId(client);
  const ctx: MiddlewareContext = {
    type: "outgoing_call",
    messageId,
    method,
    params,
    options: {},
    unconfirmed: true,
  };

  await client.middleware.execute(ctx, async (c) => {
    const ctxvals = c as Extract<MiddlewareContext, { type: "outgoing_call" }>;
    if (client.options.strictMode && client.protocol) {
      client.validateOutbound(ctxvals.method, ctxvals.params, "send");
    }

    const wrapped = wrapOutgoing(ctxvals);
    const wire = wrapped instanceof Promise ? await wrapped : wrapped;
    const frame: OCPPSend = [
      MessageType.SEND,
      messageId,
      wire.method,
      wire.params,
    ];
    const allowSend = client.invokeBeforeSend(frame);
    const allowed = allowSend instanceof Promise ? await allowSend : allowSend;
    if (allowed === false) return;

    await new Promise<void>((resolve, reject) => {
      client.safeSend(client.ws, JSON.stringify(frame), (err) =>
        err ? reject(err) : resolve(),
      );
    });
    client.emitMessageEvent(frame, "OUT", ctxvals);
  });
}

/**
 * The call as it goes on the wire: what the middleware left, or what its
 * `wrap` (an envelope such as a signature) makes of that. Called after
 * strict-mode validation, which checks the call itself, not the envelope.
 */
function wrapOutgoing(
  ctx: Extract<MiddlewareContext, { type: "outgoing_call" }>,
): WireCall | Promise<WireCall> {
  // Sent as JSON, so it is JSON whatever the middleware typed it as.
  const call: WireCall = {
    method: ctx.method,
    params: ctx.params as JsonValue,
  };
  // Without a wrap, nothing is awaited, so the send is not delayed.
  return ctx.wrap ? ctx.wrap(call) : call;
}

/**
 * Send a CALL through the middleware and wait for its answer, or for a
 * noReply call only until the frame is written. A frame sent while
 * connecting is buffered.
 */
export async function sendCall(
  client: ClientContext,
  method: string,
  params: unknown,
  options: CallOptions | NoReplyCallOptions,
): Promise<unknown> {
  const msgId = options.idempotencyKey ?? newMessageId(client);
  const timeoutMs = options.timeoutMs ?? client.options.callTimeoutMs;

  const ctx: MiddlewareContext = {
    type: "outgoing_call",
    messageId: msgId,
    method,
    params,
    options,
  };

  let callResult: unknown;

  await client.middleware.execute(ctx, async (c) => {
    // Cast ctx back to access specific fields safely if needed,
    // but strictly we should use 'c' which is TContext.
    // Since TContext is a union, we know it is outgoing_call here.
    const ctxvals = c as Extract<MiddlewareContext, { type: "outgoing_call" }>;

    // Strict mode: validate outbound call
    if (client.options.strictMode && client.protocol) {
      client.validateOutbound(ctxvals.method, ctxvals.params, "req");
    }

    const wrapped = wrapOutgoing(ctxvals);
    const wire = wrapped instanceof Promise ? await wrapped : wrapped;
    const message: OCPPCall = [
      MessageType.CALL,
      msgId,
      wire.method,
      wire.params,
    ];

    const allowSend = client.invokeBeforeSend(message);
    if (allowSend instanceof Promise) {
      if ((await allowSend) === false) return;
    } else if (allowSend === false) {
      return;
    }

    const messageStr = JSON.stringify(message);

    callResult = await new Promise<unknown>((resolve, reject) => {
      // A second pending call under one ID would take the first one's
      // response. Checked here, in the same tick that registers the ID, so
      // two concurrent calls cannot both get past it.
      if (client.pendingCalls.has(msgId) || client.noReplyCalls.has(msgId)) {
        reject(
          new Error(
            `Message ID "${msgId}" is already in use by a pending call`,
          ),
        );
        return;
      }

      // noReply: the peer still answers (OCPP-J requires it), but nobody
      // waits. The ID is remembered while the answer can arrive, so it is
      // dropped quietly rather than logged as unknown, and the call resolves
      // once the frame is handed over, which frees the concurrency queue.
      if ("noReply" in options && options.noReply) {
        if (options.signal?.aborted) {
          reject(options.signal.reason ?? new Error("Aborted"));
          return;
        }
        const forget = setTimeout(() => {
          client.noReplyCalls.delete(msgId);
        }, timeoutMs);
        client.noReplyCalls.set(msgId, forget);
        const fail = (err: Error) => {
          clearTimeout(forget);
          client.noReplyCalls.delete(msgId);
          reject(err);
        };
        if (client.ws?.readyState === WebSocket.OPEN) {
          client.safeSend(client.ws, messageStr, (err) => {
            if (err) {
              fail(err);
              return;
            }
            client.emitMessageEvent(message, "OUT", {
              type: "outgoing_call",
              messageId: msgId,
              method: ctxvals.method,
              params: ctxvals.params,
              options,
            });
            resolve(undefined);
          });
        } else if (client.state === CONNECTING) {
          client.bufferOutbound(messageStr);
          resolve(undefined);
        } else {
          fail(new Error(`WebSocket is not open (state: ${client.state})`));
        }
        return;
      }

      let removeAbortListener: (() => void) | undefined;

      const timeoutHandle = setTimeout(() => {
        removeAbortListener?.();
        client.pendingCalls.delete(msgId);
        reject(
          new TimeoutError(
            `Call to "${ctxvals.method}" timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      // The signal may already have aborted while this call waited its turn
      // in the concurrency queue or the offline queue. addEventListener does
      // not fire for an already-aborted signal, so without this check the
      // frame went on the wire for a call the caller had abandoned — and
      // nothing rejected it either, leaving the timeout as the only exit.
      if (options.signal?.aborted) {
        clearTimeout(timeoutHandle);
        client.pendingCalls.delete(msgId);
        reject(options.signal.reason ?? new Error("Aborted"));
        return;
      }

      const abortHandler = () => {
        clearTimeout(timeoutHandle);
        client.pendingCalls.delete(msgId);
        reject(options.signal?.reason ?? new Error("Aborted"));
      };

      if (options.signal) {
        options.signal.addEventListener("abort", abortHandler, {
          once: true,
        });
        removeAbortListener = () =>
          options.signal?.removeEventListener("abort", abortHandler);
      }

      client.pendingCalls.set(msgId, {
        resolve,
        reject,
        timeoutHandle,
        removeAbortListener,
        method: ctxvals.method,
        sentAt: Date.now(),
      });

      if (client.ws?.readyState === WebSocket.OPEN) {
        client.safeSend(client.ws, messageStr, (err) => {
          if (err) {
            // Failed to send
            clearTimeout(timeoutHandle);
            removeAbortListener?.();
            client.pendingCalls.delete(msgId);
            reject(err);
          } else {
            // Emit outbound CALL message event for observability
            client.emitMessageEvent(message, "OUT", {
              type: "outgoing_call",
              messageId: msgId,
              method: ctxvals.method,
              params: ctxvals.params,
              options: options,
            });
          }
        });
      } else if (client.state === CONNECTING) {
        // Buffer it
        client.logger?.debug?.("Buffering call", {
          method: ctxvals.method,
        });
        client.bufferOutbound(messageStr);
        // The promise remains pending until connected & flushed -> then response comes
      } else {
        clearTimeout(timeoutHandle);
        removeAbortListener?.();
        client.pendingCalls.delete(msgId);
        reject(new Error(`WebSocket is not open (state: ${client.state})`));
      }
    });

    return callResult;
  });

  return callResult;
}

/** Buffer a frame for flush on open, dropping the oldest past the cap. */
export function bufferOutbound(client: ClientContext, message: string): void {
  if (client.outboundBuffer.length >= OUTBOUND_BUFFER_MAX) {
    client.outboundBuffer.shift();
    client.logger?.warn?.("Outbound buffer full — dropped oldest frame", {
      identity: client.identity,
      max: OUTBOUND_BUFFER_MAX,
    });
  }
  client.outboundBuffer.push(message);
}

/** The ID of an outgoing CALL or SEND: idGenerator when set, else a UUID. */
function newMessageId(client: ClientContext): string {
  const generate = client.options.idGenerator;
  if (!generate) return createId();
  const id = generate();
  if (typeof id !== "string" || id === "") {
    throw new TypeError("idGenerator must return a non-empty string");
  }
  return id;
}

/**
 * Atomically drains the offline queue and sends each message via _sendCall.
 * Uses splice(0) to prevent re-entry bugs (double billing) if the connection
 * drops again mid-flush — the queue is empty before any sends begin.
 */
export function flushOfflineQueue(client: ClientContext): void {
  if (client.offlineQueue.length === 0) return;

  // Atomic snapshot — clears queue before sending to prevent re-entry
  const snapshot = client.offlineQueue.splice(0, client.offlineQueue.length);
  client.logger?.info?.("Flushing offline queue", {
    count: snapshot.length,
  });

  for (const entry of snapshot) {
    client.callQueue
      .push(() => sendCall(client, entry.method, entry.params, entry.options))
      .then(entry.resolve)
      .catch(entry.reject);
  }
}

/**
 * Retry wrapper using Full Jitter exponential backoff.
 * delay = random(0, min(retryMaxDelayMs, retryDelayMs * 2^attempt))
 * Only retries on TimeoutError — all other errors propagate immediately.
 */
async function callWithRetry(
  client: ClientContext,
  method: string,
  params: unknown,
  options: CallOptions,
  maxRetries: number,
): Promise<unknown> {
  const baseDelay = options.retryDelayMs ?? 1000;
  const maxDelay = options.retryMaxDelayMs ?? 30000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.callQueue.push(() =>
        sendCall(client, method, params, options),
      );
    } catch (err) {
      if (attempt === maxRetries || !(err instanceof TimeoutError)) {
        throw err;
      }
      // Full Jitter: random(0, min(maxDelay, baseDelay * 2^attempt))
      const expDelay = Math.min(maxDelay, baseDelay * 2 ** attempt);
      const jitteredDelay = Math.random() * expDelay;
      client.logger?.warn?.("Call retry", {
        method,
        attempt: attempt + 1,
        maxRetries,
        delayMs: Math.round(jitteredDelay),
      });
      await new Promise((r) => setTimeout(r, jitteredDelay));
    }
  }
  // Should be unreachable, but satisfy TypeScript
  throw new Error("Retry exhausted");
}

/**
 * Reject everything still waiting in the offline queue.
 *
 * These entries hold the caller's resolve/reject, so leaving them in place on
 * a terminal close stranded those promises forever — the call never resolved,
 * never rejected, and never timed out, because the timeout is only armed once
 * a call is actually sent.
 */
export function drainOfflineQueue(client: ClientContext, reason: string): void {
  if (client.offlineQueue.length === 0) return;
  const queued = client.offlineQueue.splice(0);
  client.logger?.debug?.("Rejecting offline-queued calls", {
    count: queued.length,
    reason,
  });
  for (const entry of queued) {
    entry.reject(new Error(reason));
  }
}

/**
 * Reject all in-flight calls and clear pending state.
 */
export function rejectPendingCalls(
  client: ClientContext,
  reason: string,
): void {
  for (const [, pending] of client.pendingCalls) {
    clearTimeout(pending.timeoutHandle);
    pending.removeAbortListener?.();
    pending.reject(new Error(reason));
  }
  client.pendingCalls.clear();
  client.pendingResponses.clear();
  // No answer can arrive on a closed socket.
  for (const forget of client.noReplyCalls.values()) clearTimeout(forget);
  client.noReplyCalls.clear();
}
