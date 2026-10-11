import type { IncomingMessage } from "node:http";
import type WebSocket from "ws";
import type { MiddlewareStack } from "../core/middleware.js";
import type { Queue } from "../core/queue.js";
import type { Validator } from "../core/validation/validator.js";
import type {
  CallOptions,
  CloseOptions,
  NoReplyCallOptions,
} from "../types/calls.js";
import type { ClientOptions } from "../types/client.js";
import type {
  ClientEvents,
  MessageDirection,
  TypedEventEmitter,
} from "../types/events.js";
import type { CallHandler, WildcardHandler } from "../types/handlers.js";
import type { LoggerLike } from "../types/logger.js";
import type { MiddlewareContext } from "../types/middleware.js";
import type {
  AnyOCPPProtocol,
  ConnectionState,
  OCPPMessage,
} from "../types/protocol.js";
import type { MessageIdRules, SchemaKind } from "./frames.js";

export interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  /** Detaches the abort listener from options.signal (if one was attached). */
  removeAbortListener?: (() => void) | undefined;
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
  safeSend(
    ws: WebSocket | null,
    data: string,
    cb?: (err?: Error) => void,
  ): void;
  emitMessageEvent(
    message: OCPPMessage,
    direction: MessageDirection,
    ctx: MiddlewareContext,
    latencyMs?: number,
  ): void;
  close(options?: CloseOptions): Promise<{ code: number; reason: string }>;
}

/** The options the client's constructor gives a default. */
type DefaultedClientOption =
  | "identity"
  | "endpoint"
  | "callTimeoutMs"
  | "pingIntervalMs"
  | "deferPingsOnActivity"
  | "callConcurrency"
  | "maxBadMessages"
  | "respondWithDetailedErrors"
  | "reconnect"
  | "maxReconnects"
  | "backoffMin"
  | "backoffMax";

/**
 * The client's options, with the defaults its constructor fills in: each of
 * those is set, as an option given as undefined keeps its default.
 */
export type ResolvedClientOptions<P extends AnyOCPPProtocol = AnyOCPPProtocol> =
  {
    [K in DefaultedClientOption]-?: Exclude<ClientOptions<P>[K], undefined>;
  } & ClientOptions<P>;

/** A call made while offline, sent once the client connects. */
export interface OfflineCall {
  method: string;
  params: unknown;
  options: CallOptions | NoReplyCallOptions;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** A frame waiting for the socket's send buffer to drain. */
export interface BackpressuredFrame {
  data: string;
  cb?: ((err?: Error) => void) | undefined;
  enqueuedAt: number;
}

/**
 * Everything the modules in client/ use: the client's fields through getters
 * and setters, and the methods that stay on the client, called through it so
 * a subclass's overrides, a test's replacements and the client's listeners
 * still apply.
 */
export interface ClientContext extends InboundContext {
  /** The client's options; reconfigure() changes them in place. */
  readonly options: ResolvedClientOptions;
  state: ConnectionState;
  ws: WebSocket | null;
  protocol: string | undefined;
  /** Frames sent while connecting, written out once the socket opens. */
  outboundBuffer: string[];
  /** Calls made while offline, sent once connected. */
  readonly offlineQueue: OfflineCall[];
  /** Holds calls back to callConcurrency at a time. */
  readonly callQueue: Queue;
  /** Frames waiting for the socket to drain. */
  readonly backpressureQueue: BackpressuredFrame[];
  backpressureTimer: ReturnType<typeof setInterval> | null;
  pingTimer: ReturnType<typeof setTimeout> | null;
  /** The deadline for the pong to the last ping. */
  pongTimer: ReturnType<typeof setTimeout> | null;
  /** When anything last arrived from the peer. */
  readonly lastActivity: number;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Set by close(), so a reconnect attempt already in flight stops. */
  closeRequested: boolean;
  closePromise: Promise<{ code: number; reason: string }> | null;
  /** When the current socket opened; anchors the handler grace window. */
  openedAt: number;
  /** Validators from the options; null resolves one per protocol. */
  readonly validators: readonly Validator[] | null;
  bufferOutbound(message: string): void;
  startPing(): void;
  stopPing(): void;
  connectInternal(): Promise<{ response: IncomingMessage }>;
  attachWebsocket(ws: WebSocket): void;
  onMessage(data: WebSocket.RawData): void;
  onClose(code: number, reason: Buffer): void;
  buildEndpoint(): string;
  buildWsOptions(): WebSocket.ClientOptions;
}
