import type WebSocket from "ws";
import type { MiddlewareStack } from "../core/middleware.js";
import type { CloseOptions } from "../types/calls.js";
import type {
  ClientEvents,
  MessageDirection,
  TypedEventEmitter,
} from "../types/events.js";
import type { CallHandler, WildcardHandler } from "../types/handlers.js";
import type { LoggerLike } from "../types/logger.js";
import type { MiddlewareContext } from "../types/middleware.js";
import type { ConnectionState, OCPPMessage } from "../types/protocol.js";
import type { MessageIdRules, SchemaKind } from "./frames.js";

export interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  /** Detaches the abort listener from options.signal (if one was attached). */
  removeAbortListener?: () => void;
  method: string;
  sentAt: number;
}

/**
 * The client state the incoming-message handlers read and write, through
 * getters, and the client methods they call, so a subclass's overrides and
 * the client's own listeners still apply.
 */
export interface InboundContext extends MessageIdRules {
  readonly identity: string;
  readonly state: ConnectionState;
  readonly logger: LoggerLike;
  /** The current socket; null between connections. */
  readonly ws: WebSocket | null;
  readonly respondWithDetailedErrors: boolean;
  readonly badMessageWindowMs: number | undefined;
  readonly maxBadMessages: number;
  readonly handlers: Map<string, CallHandler>;
  readonly wildcardHandler: WildcardHandler | null;
  readonly middleware: MiddlewareStack<MiddlewareContext>;
  /** Calls sent and waiting for their answer, by message ID. */
  readonly pendingCalls: Map<string, PendingCall>;
  /** Incoming calls being handled, by message ID. */
  readonly pendingResponses: Set<string>;
  /** noReply calls whose answer can still arrive, with the timer that forgets each. */
  readonly noReplyCalls: Map<string, ReturnType<typeof setTimeout>>;
  /** Bad messages in a row, and when the current run began. */
  badMessageCount: number;
  badMessageWindowStart: number;
  /** The client itself, whose events these are. */
  readonly emitter: TypedEventEmitter<ClientEvents>;
  recordActivity(): void;
  /** Wait out the startup window for a handler to be registered. */
  awaitHandlerGrace(): Promise<void>;
  validateInbound(method: string, params: unknown, kind: SchemaKind): void;
  validateOutbound(method: string, params: unknown, kind: SchemaKind): void;
  /** The onBeforeSend veto; false keeps the frame from being sent. */
  invokeBeforeSend(message: OCPPMessage): boolean | Promise<boolean>;
  safeSend(ws: WebSocket | null, data: string): void;
  emitMessageEvent(
    message: OCPPMessage,
    direction: MessageDirection,
    ctx: MiddlewareContext,
    latencyMs?: number,
  ): void;
  close(options?: CloseOptions): Promise<{ code: number; reason: string }>;
}
