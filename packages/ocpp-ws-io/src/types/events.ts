/** Typed events of clients and servers. */

import type { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { OCPPServerClient } from "../server/server-client.js";
import type { MiddlewareContext } from "./middleware.js";
import type {
  AnyOCPPProtocol,
  OCPPCall,
  OCPPCallError,
  OCPPCallResult,
  OCPPCallResultError,
  OCPPMessage,
} from "./protocol.js";

// ─── Typed EventEmitter ──────────────────────────────────────────

/**
 * Utility type that overlays typed `.on()`, `.off()`, `.emit()` etc.
 * on top of Node.js EventEmitter. This is the foundation for type-safe
 * event handling throughout the library.
 */
export type TypedEventEmitter<
  TEvents extends Record<keyof TEvents, unknown[]>,
> = Omit<
  EventEmitter,
  | "on"
  | "once"
  | "off"
  | "emit"
  | "removeListener"
  | "addListener"
  | "removeAllListeners"
> & {
  on<K extends keyof TEvents | (string & {})>(
    event: K,
    listener: K extends keyof TEvents
      ? (...args: TEvents[K]) => void
      : (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  once<K extends keyof TEvents | (string & {})>(
    event: K,
    listener: K extends keyof TEvents
      ? (...args: TEvents[K]) => void
      : (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  off<K extends keyof TEvents | (string & {})>(
    event: K,
    listener: K extends keyof TEvents
      ? (...args: TEvents[K]) => void
      : (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  emit<K extends keyof TEvents | (string & {})>(
    event: K,
    ...args: K extends keyof TEvents ? TEvents[K] : unknown[]
  ): boolean;
  addListener<K extends keyof TEvents | (string & {})>(
    event: K,
    listener: K extends keyof TEvents
      ? (...args: TEvents[K]) => void
      : (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  removeListener<K extends keyof TEvents | (string & {})>(
    event: K,
    listener: K extends keyof TEvents
      ? (...args: TEvents[K]) => void
      : (...args: unknown[]) => void,
  ): TypedEventEmitter<TEvents>;
  removeAllListeners<K extends keyof TEvents | (string & {})>(
    event?: K,
  ): TypedEventEmitter<TEvents>;
};
// ─── Message Direction & Payload Types ──────────────────────────

/** Indicates whether a message is incoming (from peer) or outgoing (to peer) */
export type MessageDirection = "IN" | "OUT";
/**
 * Enriched context for message events, combining metadata from middleware
 * and message flow tracking. Uses type intersection since MiddlewareContext is a union.
 */
export type MessageEventContext = MiddlewareContext & {
  /** Message timestamp (ISO 8601) */
  timestamp: string;
  /** Latency in milliseconds (only for responses/results) */
  latencyMs?: number;
};
/**
 * Enriched message event payload with direction and context.
 * Replaces the simple OCPPMessage tuple for better observability.
 */
export interface MessageEventPayload {
  /** The raw OCPP message */
  message: OCPPMessage;
  /** Direction of the message: IN (from peer) or OUT (to peer) */
  direction: MessageDirection;
  /** Enriched context with metadata */
  ctx: MessageEventContext;
}
// ─── Event Types ─────────────────────────────────────────────────

export interface ClientEvents {
  open: [{ response: IncomingMessage }];
  close: [{ code: number; reason: string }];
  /**
   * `close()` has started, before it waits for pending calls: no reconnect
   * follows, and `close` fires once the socket has closed. A close the peer
   * starts gives `disconnect` instead.
   */
  closing: [];
  disconnect: [{ code: number; reason: string }];
  error: [Error];
  connecting: [{ url: string }];
  reconnect: [{ attempt: number; delay: number }];
  message: [MessageEventPayload];
  call: [OCPPCall];
  callResult: [OCPPCallResult];
  callError: [OCPPCallError];
  /** OCPP 2.1: the peer could not process a CALLRESULT this side sent. */
  callResultError: [OCPPCallResultError];
  badMessage: [{ message: string; error: Error }];
  handlerError: [{ method: string; error: Error }];
  pongTimeout: [{ identity: string }];
  backpressure: [{ identity: string; bufferedAmount: number }];
  rateLimitExceeded: [{ rawData: unknown }];
  ping: [];
  pong: [];
  strictValidationFailure: [{ message: unknown; error: Error }];
}
/**
 * I3: Structured security event for SIEM integration.
 * Emitted by the server for audit-relevant actions.
 */
export interface SecurityEvent {
  /**
   * Event type identifier. `AUTH_FAILED` is a rejection the server or your
   * code chose (`ctx.reject()`, missing Basic Auth, unknown identity);
   * `UPGRADE_ERROR` is something thrown during the handshake, answered with
   * 500, with the error in `details.error`.
   */
  type:
    | "AUTH_FAILED"
    | "UPGRADE_ERROR"
    | "RATE_LIMIT_EXCEEDED"
    | "UPGRADE_ABORTED"
    | "CONNECTION_RATE_LIMIT"
    | "CONNECTION_LIMIT"
    | "INVALID_PAYLOAD"
    | "ANOMALY_RAPID_RECONNECT"
    | "ANOMALY_AUTH_BRUTE_FORCE"
    | "ANOMALY_MESSAGE_FUZZING"
    | "ANOMALY_IDENTITY_COLLISION";
  /** Station identity (if known) */
  identity?: string;
  /** Remote IP address */
  ip?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Event-specific details */
  details?: Record<string, unknown>;
}
export interface ServerEvents<P extends AnyOCPPProtocol = AnyOCPPProtocol> {
  client: [OCPPServerClient<P>];
  error: [Error];
  upgradeError: [{ error: Error; socket: Duplex }];
  upgradeAborted: [
    {
      identity: string;
      reason: string;
      socket: Duplex;
      request: IncomingMessage;
    },
  ];
  closing: [];
  close: [];
  /** I3: Structured security event for SIEM/audit pipelines */
  securityEvent: [SecurityEvent];
  /** Enriched message event with direction and context */
  message: [MessageEventPayload];
  // Native WebSocketServer events
  connection: [
    socket: import("ws").WebSocket,
    request: import("node:http").IncomingMessage,
  ];
  listening: [];
  headers: [headers: string[], request: import("node:http").IncomingMessage];
  /** The adaptive rate limiter changed its multiplier. */
  "rateLimit:adapted": [import("../server/adaptive-limiter.js").AdaptedEvent];
}
/**
 * Outcome of a `broadcast` / `broadcastBatch`.
 *
 * Local delivery is observable; delivery to other nodes is not. Broadcast
 * reaches other nodes over pub/sub, which is fire-and-forget — a node that is
 * not subscribed at that instant simply never sees the message, and nothing
 * reports back. `remotePublished` therefore means "handed to the adapter",
 * never "delivered".
 */
export interface BroadcastResult {
  /** Clients on this node whose call completed successfully. */
  localDelivered: number;
  /** Clients on this node whose call failed, with the reason. */
  localFailed: Array<{ identity: string; error: string }>;
  /** True once the message was handed to the adapter. NOT proof of delivery. */
  remotePublished: boolean;
}
