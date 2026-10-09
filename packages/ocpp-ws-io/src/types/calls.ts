/** Options of calls and of closing a connection. */

// ─── Call Options ────────────────────────────────────────────────

export interface CallOptions {
  /** Timeout in milliseconds for this specific call */
  timeoutMs?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /**
   * Max retry attempts on TimeoutError (default: 0 = no retry).
   * Uses Full Jitter exponential backoff between retries.
   */
  retries?: number;
  /** Base delay in ms for exponential backoff between retries (default: 1000) */
  retryDelayMs?: number;
  /** Max delay cap in ms to prevent unbounded backoff (default: 30000) */
  retryMaxDelayMs?: number;
  /**
   * Idempotency key for deduplication. If provided, this value is used
   * as the OCPP messageId instead of generating a new random one.
   * Consumers can use the same key to guarantee exactly-once semantics
   * when retrying calls across reconnections.
   */
  idempotencyKey?: string;
}
/**
 * Options for `call()` with `noReply: true`: the CALL is
 * sent and the call resolves with `undefined` once the frame is written,
 * without waiting for the answer. The peer still answers, as OCPP-J requires;
 * that answer is dropped quietly while it can still arrive (`timeoutMs`,
 * default `callTimeoutMs`). The call waits its turn in the `callConcurrency`
 * queue and then frees it at once, so the next CALL can go out before this
 * one is answered, which OCPP-J §4.1.1 does not allow: use it only with peers
 * known to cope. No retries: there is no answer to retry on. For an OCPP 2.1
 * message defined as unconfirmed, use `send()` instead.
 */
export interface NoReplyCallOptions
  extends Omit<CallOptions, "retries" | "retryDelayMs" | "retryMaxDelayMs"> {
  noReply: true;
}
// ─── Close Options ───────────────────────────────────────────────

export interface CloseOptions {
  /** WebSocket close code (default: 1000) */
  code?: number;
  /** Close reason string */
  reason?: string;
  /** Wait for pending calls to complete before closing */
  awaitPending?: boolean;
  /** Force-close without waiting */
  force?: boolean;
}
