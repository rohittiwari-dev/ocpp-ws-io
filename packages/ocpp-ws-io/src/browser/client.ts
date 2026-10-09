/// <reference lib="dom" />

// Type-only. Through the re-exports in ./types.js the compiler rejects the
// typed send() overload against its implementation once a custom protocol is
// declared (TS2394); the generated types themselves are accepted.
import type {
  OCPPSendRequestType,
  SendMethodNames,
} from "../generated/index.js";
import { type MiddlewareFunction, MiddlewareStack } from "../middleware.js";
import { assertUniqueProtocols, supportsSend } from "../protocol-list.js";
import type {
  CheckedAction,
  CheckedHandler,
  HandleArgs,
  HandlerResult,
  HandlerReturn,
  JsonObject,
  JsonValue,
  MiddlewareContext,
  RequestOf,
  ResponseOf,
  SendRequestOf,
  UncheckedAction,
  UncheckedHandler,
  WireCall,
  WithUniqueProtocols,
} from "../types.js";
import { EventEmitter } from "./emitter.js";
import {
  type RPCError,
  RPCGenericError,
  RPCMessageTypeNotSupportedError,
  TimeoutError,
} from "./errors.js";
/**
 * BrowserOCPPClient — A full-featured browser WebSocket RPC client for OCPP.
 *
 * Feature-complete port of OCPPClient for browser environments:
 * - Typed event emitter (no Node.js EventEmitter dependency)
 * - Auto-reconnection with exponential backoff + jitter
 * - Concurrency-limited call queue
 * - Version-specific & wildcard handlers
 * - Abort signal support
 * - Bad message handling
 * - NOREPLY support
 */
import { initLogger } from "./init-logger.js";
import { Queue } from "./queue.js";
import {
  type AllMethodNames,
  type AnyOCPPProtocol,
  type BrowserClientEvents,
  type BrowserClientOptions,
  type CallHandler,
  type CallOptions,
  type CloseOptions,
  ConnectionState,
  type HandlerContext,
  type KnownProtocol,
  type LoggerLike,
  type LoggerLikeNotOptional,
  MessageType,
  NOREPLY,
  type NoReplyCallOptions,
  type OCPPCall,
  type OCPPCallError,
  type OCPPCallResult,
  type OCPPCallResultError,
  type OCPPMessage,
  type OCPPRequestType,
  type OCPPResponseType,
  type OCPPSend,
  type WildcardHandler,
} from "./types.js";
import { createRPCError, getErrorPlainObject, NOOP_LOGGER } from "./util.js";

const { CONNECTING, OPEN, CLOSING, CLOSED } = ConnectionState;

/** Which error frame answers a bad message, and under which message ID. */
interface BadMessageReply {
  frame: typeof MessageType.CALLERROR | typeof MessageType.CALLRESULTERROR;
  messageId: string;
}

/** A frame whose message ID could not be read is answered under ID "-1". */
const UNREADABLE_ID_REPLY: BadMessageReply = {
  frame: MessageType.CALLERROR,
  messageId: "-1",
};

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  /** Detaches the abort listener from options.signal (if one was attached). */
  removeAbortListener?: () => void;
  method: string;
  sentAt: number;
}

/**
 * BrowserOCPPClient — A typed WebSocket RPC client for OCPP in browser environments.
 *
 * API-compatible with `OCPPClient` from `ocpp-ws-io`, adapted for the browser
 * WebSocket API (no Node.js dependencies).
 *
 * @example
 * ```ts
 * import { BrowserOCPPClient } from "ocpp-ws-io/browser";
 *
 * const client = new BrowserOCPPClient({
 *   identity: "CP001",
 *   endpoint: "wss://central.example.com/ocpp",
 *   protocols: ["ocpp1.6"],
 * });
 *
 * client.on("open", () => console.log("Connected!"));
 * await client.connect();
 * ```
 */
export class BrowserOCPPClient<
  P extends AnyOCPPProtocol = AnyOCPPProtocol,
  // The protocols list as given, so a protocol listed twice is a type error.
  const L extends readonly P[] = readonly P[],
> extends EventEmitter<BrowserClientEvents> {
  // Static connection states
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  private _options: Required<
    Pick<
      BrowserClientOptions<P>,
      | "identity"
      | "endpoint"
      | "callTimeoutMs"
      | "callConcurrency"
      | "maxBadMessages"
      | "respondWithDetailedErrors"
      | "reconnect"
      | "maxReconnects"
      | "backoffMin"
      | "backoffMax"
    >
  > &
    BrowserClientOptions<P>;

  private _state: (typeof ConnectionState)[keyof typeof ConnectionState] =
    CLOSED;
  private _ws: WebSocket | null = null;
  private _protocol: string | undefined;
  private _identity: string;

  private _handlers = new Map<string, CallHandler>();
  private _wildcardHandler: WildcardHandler | null = null;
  private _pendingCalls = new Map<string, PendingCall>();
  /**
   * IDs of noReply calls whose answer can still arrive, each with the timer
   * that forgets it. The answer is then dropped quietly.
   */
  private _noReplyCalls = new Map<string, ReturnType<typeof setTimeout>>();
  private _pendingResponses = new Set<string>();
  private _callQueue: Queue;
  private _closePromise: Promise<{ code: number; reason: string }> | null =
    null;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _badMessageCount = 0;
  private _badMessageWindowStart = 0;
  private _outboundBuffer: string[] = [];
  private _logger: LoggerLike;
  private _middleware: MiddlewareStack<MiddlewareContext>;

  constructor(options: WithUniqueProtocols<BrowserClientOptions<P>, P, L>) {
    super();

    if (!options.identity) {
      throw new Error("identity is required");
    }
    assertUniqueProtocols(options.protocols);

    this._identity = options.identity;

    this._options = {
      reconnect: true,
      maxReconnects: Infinity,
      backoffMin: 1000,
      backoffMax: 30000,
      callTimeoutMs: 30000,
      callConcurrency: 1,
      maxBadMessages: 50,
      respondWithDetailedErrors: false,
      ...options,
    };

    this._callQueue = new Queue(this._options.callConcurrency);
    this._middleware = new MiddlewareStack<MiddlewareContext>();

    // Initialize logger
    const loggerInstance = initLogger(this._options.logging, {
      component: "BrowserOCPPClient",
      identity: this._identity,
    });
    this._logger = loggerInstance || NOOP_LOGGER;

    if (this._options.respondWithDetailedErrors) this._warnDetailedErrors();
  }

  // ─── Getters ─────────────────────────────────────────────────

  get log(): LoggerLikeNotOptional {
    return this._logger as LoggerLikeNotOptional;
  }
  get identity(): string {
    return this._identity;
  }
  get protocol(): P | undefined {
    // Negotiated from this client's own protocols.
    return this._protocol as P | undefined;
  }

  /**
   * This client typed for one of its protocols, or undefined while it speaks
   * another (or is not connected). A client configured for several versions
   * is typed for all of them until narrowed this way.
   */
  forProtocol<V extends P>(version: V): BrowserOCPPClient<V> | undefined;
  // The same object; only its type narrows.
  forProtocol(version: AnyOCPPProtocol): object | undefined {
    return this._protocol === version ? this : undefined;
  }
  get state(): (typeof ConnectionState)[keyof typeof ConnectionState] {
    return this._state;
  }

  // ─── Connect ─────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this._state !== CLOSED) {
      throw new Error(`Cannot connect: client is in state ${this._state}`);
    }

    this._state = CONNECTING;
    this._reconnectAttempt = 0;

    return this._connectInternal();
  }

  private async _connectInternal(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const endpoint = this._buildEndpoint();

      this._logger.debug?.("Connecting", { url: endpoint });
      this.emit("connecting", { url: endpoint });

      let ws: WebSocket;
      try {
        ws = this._options.protocols?.length
          ? new WebSocket(endpoint, [...this._options.protocols])
          : new WebSocket(endpoint);
      } catch (err) {
        this._state = CLOSED;
        reject(err);
        return;
      }
      this._ws = ws;

      const onOpen = (event: Event) => {
        cleanup();
        this._state = OPEN;
        this._protocol = ws.protocol || undefined;
        this._badMessageCount = 0;
        this._badMessageWindowStart = 0;

        // Narrow protocols to negotiated protocol for future reconnects
        if (ws.protocol && this._reconnectAttempt === 0) {
          // The browser only accepts a protocol this client offered.
          this._options.protocols = [ws.protocol as P];
        }

        // Reset the reconnect counter on a successful (re)connection so that
        // `maxReconnects` and backoff are per-disconnection-incident, not a
        // cumulative lifetime budget (OCPP 2.0.1 §J.1 backoff resets on connect).
        this._reconnectAttempt = 0;

        this._attachWebsocket(ws);

        // Flush outbound buffer (messages queued during CONNECTING)
        if (this._outboundBuffer.length > 0) {
          const buffer = this._outboundBuffer;
          this._outboundBuffer = [];
          for (const msg of buffer) this._ws?.send(msg);
        }

        this._logger.info?.("Connected", {
          protocol: ws.protocol || undefined,
        });
        this.emit("open", event);
        resolve();
      };

      const onError = (event: Event) => {
        cleanup();
        this._state = CLOSED;
        this._logger.error?.("Connection error");
        this.emit("error", event);
        reject(event);
      };

      const onClose = () => {
        cleanup();
        if (this._state === CONNECTING) {
          this._state = CLOSED;
          reject(new Error("WebSocket closed during connection"));
        }
      };

      const cleanup = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        ws.removeEventListener("close", onClose);
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
    });
  }

  // ─── Close ───────────────────────────────────────────────────

  async close(
    options: CloseOptions = {},
  ): Promise<{ code: number; reason: string }> {
    const {
      code = 1000,
      reason = "",
      awaitPending = true,
      force = false,
    } = options;

    if (this._closePromise) return this._closePromise;

    if (this._state === CLOSED) {
      return { code: 1000, reason: "" };
    }

    // Cancel reconnection
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._closePromise = this._closeInternal(code, reason, awaitPending, force);
    return this._closePromise;
  }

  private async _closeInternal(
    code: number,
    reason: string,
    awaitPending: boolean,
    force: boolean,
  ): Promise<{ code: number; reason: string }> {
    this._state = CLOSING;
    this.emit("closing");

    if (!force && awaitPending) {
      const pendingPromises = Array.from(this._pendingCalls.values()).map(
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
      if (!this._ws || this._ws.readyState === WebSocket.CLOSED) {
        this._state = CLOSED;
        this._cleanup();
        const result = { code, reason };
        this.emit("close", result);
        resolve(result);
        return;
      }

      const onClose = (event: CloseEvent) => {
        this._ws?.removeEventListener("close", onClose);
        this._state = CLOSED;
        this._cleanup();
        const result = { code: event.code, reason: event.reason };
        this.emit("close", result);
        resolve(result);
      };

      this._ws.addEventListener("close", onClose);

      if (force) {
        // Browser WebSocket has no terminate(), close immediately
        this._ws.close();
      } else {
        // Validate close code (RFC 6455 §7.4)
        const validCode =
          code >= 1000 && code <= 4999 && ![1004, 1005, 1006].includes(code);
        this._ws.close(validCode ? code : 1000, reason);
      }
    });
  }

  // ─── Handlers ────────────────────────────────────────────────

  // As on the Node client: the payload is checked for keys the schema does
  // not define on the action name, and method-only overloads come first so
  // editors suggest the right fields while a handler is being written.

  /**
   * Register a handler for the client's default protocol — `handle("BootNotification", handler)`.
   * A response with a key the schema does not define is an error.
   */
  handle<
    M extends AllMethodNames<KnownProtocol<P>>,
    R extends HandlerResult<ResponseOf<KnownProtocol<P>, M>>,
  >(
    method: CheckedHandler<M, ResponseOf<KnownProtocol<P>, M>, R>,
    handler: (
      context: HandlerContext<OCPPRequestType<KnownProtocol<P>, M>>,
    ) => HandlerReturn<R, ResponseOf<KnownProtocol<P>, M>>,
  ): void;

  /**
   * Register a handler for an OCPP 2.1 SEND message on the default protocol.
   * Nothing is sent back: `ctx.unconfirmed` is true and the return value is ignored.
   */
  handle<M extends SendMethodNames<KnownProtocol<P>>>(
    method: M,
    handler: (
      context: HandlerContext<OCPPSendRequestType<KnownProtocol<P>, M>>,
    ) => void | Promise<void>,
  ): void;

  /**
   * Register a version-specific handler — `handle("ocpp1.6", "BootNotification", handler)`.
   * This handler is only invoked when the active protocol matches the given version.
   */
  handle<
    V extends KnownProtocol<P>,
    M extends AllMethodNames<V>,
    R extends HandlerResult<ResponseOf<V, M>>,
  >(
    version: V,
    method: CheckedHandler<M, ResponseOf<V, M>, R>,
    handler: (
      context: HandlerContext<OCPPRequestType<V, M>>,
    ) => HandlerReturn<R, ResponseOf<V, M>>,
  ): void;

  /**
   * Register a version-specific handler for an OCPP 2.1 SEND message. Nothing
   * is sent back: `ctx.unconfirmed` is true and the return value is ignored.
   */
  handle<V extends KnownProtocol<P>, M extends SendMethodNames<V>>(
    version: V,
    method: M,
    handler: (
      context: HandlerContext<OCPPSendRequestType<V, M>>,
    ) => void | Promise<void>,
  ): void;

  /**
   * Register a handler for an action the types do not check, such as an
   * undeclared vendor action — `handle(unchecked("VendorPing"), handler)`.
   */
  handle(method: UncheckedAction, handler: UncheckedHandler): void;

  /**
   * Register a version-specific handler for an action the types do not check.
   * The version must be one of the client's protocols.
   */
  handle(version: P, method: UncheckedAction, handler: UncheckedHandler): void;

  /** Register a wildcard handler for all unhandled methods. */
  handle(handler: WildcardHandler): void;

  handle(...args: HandleArgs): void {
    if (args.length === 1 && typeof args[0] === "function") {
      this._wildcardHandler = args[0];
    } else if (
      args.length === 2 &&
      typeof args[0] === "string" &&
      typeof args[1] === "function"
    ) {
      this._handlers.set(args[0], args[1] as CallHandler);
    } else if (
      args.length === 3 &&
      typeof args[0] === "string" &&
      typeof args[1] === "string" &&
      typeof args[2] === "function"
    ) {
      this._handlers.set(`${args[0]}:${args[1]}`, args[2] as CallHandler);
    } else {
      throw new Error(
        "Invalid arguments: provide (version, method, handler), (method, handler), or (wildcardHandler)",
      );
    }
  }

  /** Remove the handler of an action on the default protocol, or the wildcard handler. */
  removeHandler(
    method?:
      | AllMethodNames<KnownProtocol<P>>
      | SendMethodNames<KnownProtocol<P>>
      | UncheckedAction,
  ): void;
  /** Remove a version-specific handler. */
  removeHandler<V extends KnownProtocol<P>>(
    version: V,
    method: AllMethodNames<V> | SendMethodNames<V> | UncheckedAction,
  ): void;
  /** Remove a version-specific handler of an action the types do not check. */
  removeHandler(version: P, method: UncheckedAction): void;
  removeHandler(versionOrMethod?: string, method?: string): void {
    if (versionOrMethod && method) {
      this._handlers.delete(`${versionOrMethod}:${method}`);
    } else if (versionOrMethod) {
      this._handlers.delete(versionOrMethod);
    } else {
      this._wildcardHandler = null;
    }
  }

  removeAllHandlers(): void {
    this._handlers.clear();
    this._wildcardHandler = null;
  }

  // ─── Middleware ──────────────────────────────────────────────

  /**
   * Register a middleware function to intercept calls and results.
   * Middleware executes in the order registered.
   */
  use(middleware: MiddlewareFunction<MiddlewareContext>): void {
    this._middleware.use(middleware);
  }

  // ─── Call ────────────────────────────────────────────────────

  // Same order and checks as the Node client's call(); see there.

  /** Call a known typed method using the client's default protocol. */
  async call<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
  ): Promise<OCPPResponseType<KnownProtocol<P>, M>>;

  /** A version-specific CALL without waiting for its answer — `{ noReply: true }`. */
  async call<
    V extends KnownProtocol<P>,
    M extends AllMethodNames<V>,
    T extends RequestOf<V, M>,
  >(
    version: V,
    method: CheckedAction<M, RequestOf<V, M>, T>,
    params: T,
    options: NoReplyCallOptions,
  ): Promise<void>;

  /**
   * Call a version-specific typed method — `call("ocpp1.6", "BootNotification", {...})`.
   * Provides full type inference for params and response based on the OCPP version.
   */
  async call<
    V extends KnownProtocol<P>,
    M extends AllMethodNames<V>,
    T extends RequestOf<V, M>,
  >(
    version: V,
    method: CheckedAction<M, RequestOf<V, M>, T>,
    params: T,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M>>;

  /**
   * Send a CALL without waiting for its answer — `{ noReply: true }`. Resolves
   * with `undefined` once the frame is handed to the socket; see
   * {@link NoReplyCallOptions}.
   */
  async call<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
    options: NoReplyCallOptions,
  ): Promise<void>;

  /** Call a known typed method using the client's default protocol, with options. */
  async call<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
    options: CallOptions | undefined,
  ): Promise<OCPPResponseType<KnownProtocol<P>, M>>;

  /** Call an action the types do not check without waiting for its answer. */
  async call(
    method: UncheckedAction,
    params: object,
    options: NoReplyCallOptions,
  ): Promise<void>;

  /**
   * Call an action the types do not check — `call(unchecked("VendorPing"), params)`.
   * The response is a JSON object unless a type is given.
   */
  async call<TResult = JsonObject>(
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult>;

  /** A version-specific CALL of an action the types do not check, without waiting for its answer. */
  async call(
    version: P,
    method: UncheckedAction,
    params: object,
    options: NoReplyCallOptions,
  ): Promise<void>;

  /** Call an action the types do not check on one of the client's protocols. */
  async call<TResult = JsonObject>(
    version: P,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult>;

  async call(...args: unknown[]): Promise<unknown> {
    let method: string;
    let params: unknown;
    let options: CallOptions | NoReplyCallOptions;

    // A version-named call has its action, a string, where the other form has
    // params (an object), also when it has no params.
    if (typeof args[0] === "string" && typeof args[1] === "string") {
      // call(version, method, params?, options?)
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

    if (this._state !== OPEN) {
      throw new Error(`Cannot call: client is in state ${this._state}`);
    }

    return this._callQueue.push(() => this._sendCall(method, params, options));
  }

  private async _sendCall(
    method: string,
    params: unknown,
    options: CallOptions | NoReplyCallOptions,
  ): Promise<unknown> {
    const msgId = options.idempotencyKey ?? this._generateMessageId();
    const timeoutMs = options.timeoutMs ?? this._options.callTimeoutMs;

    const ctx: MiddlewareContext = {
      type: "outgoing_call",
      messageId: msgId,
      method,
      params,
      options,
    };

    let callResult: unknown;

    await this._middleware.execute(ctx, async (c) => {
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "outgoing_call" }
      >;

      const wrapped = this._wrapOutgoing(ctxvals);
      const wire = wrapped instanceof Promise ? await wrapped : wrapped;
      const message: OCPPCall = [
        MessageType.CALL,
        msgId,
        wire.method,
        wire.params,
      ];
      const messageStr = JSON.stringify(message);

      callResult = await new Promise<unknown>((resolve, reject) => {
        // A second pending call under one ID would take the first one's
        // response. Checked here, in the same tick that registers the ID, so
        // two concurrent calls cannot both get past it.
        if (this._pendingCalls.has(msgId) || this._noReplyCalls.has(msgId)) {
          reject(
            new Error(
              `Message ID "${msgId}" is already in use by a pending call`,
            ),
          );
          return;
        }

        // noReply: the peer still answers (OCPP-J requires it), but nobody
        // waits. The ID is remembered while the answer can arrive, so it is
        // dropped quietly rather than logged as unknown.
        if ("noReply" in options && options.noReply) {
          if (options.signal?.aborted) {
            reject(options.signal.reason ?? new Error("Aborted"));
            return;
          }
          const forget = setTimeout(() => {
            this._noReplyCalls.delete(msgId);
          }, timeoutMs);
          this._noReplyCalls.set(msgId, forget);
          this._ws?.send(messageStr);
          this.emit("message", message);
          this.emit("call", message);
          resolve(undefined);
          return;
        }

        const timeoutHandle = setTimeout(() => {
          this._pendingCalls.get(msgId)?.removeAbortListener?.();
          this._pendingCalls.delete(msgId);
          this._logger.warn?.("Call timed out", {
            messageId: msgId,
            method: ctxvals.method,
            timeoutMs,
          });
          reject(
            new TimeoutError(
              `Call to "${ctxvals.method}" timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);

        const pending: PendingCall = {
          resolve: resolve as (v: unknown) => void,
          reject,
          timeoutHandle,
          method: ctxvals.method,
          sentAt: Date.now(),
        };

        // Abort signal support
        if (options.signal) {
          if (options.signal.aborted) {
            clearTimeout(timeoutHandle);
            reject(options.signal.reason ?? new Error("Aborted"));
            return;
          }
          const abortHandler = () => {
            clearTimeout(timeoutHandle);
            this._pendingCalls.delete(msgId);
            reject(options.signal?.reason ?? new Error("Aborted"));
          };
          options.signal.addEventListener("abort", abortHandler, {
            once: true,
          });
          pending.removeAbortListener = () =>
            options.signal?.removeEventListener("abort", abortHandler);
        }

        this._pendingCalls.set(msgId, pending);
        this._ws?.send(messageStr);
        this.emit("message", message);
        this.emit("call", message);
      });
    });

    return callResult;
  }

  /**
   * Send a raw string message over the WebSocket (use with caution).
   * Messages sent while CONNECTING are buffered and flushed on open.
   */
  sendRaw(message: string): void {
    if (this._state === OPEN && this._ws) {
      this._ws.send(message);
    } else if (this._state === CONNECTING) {
      this._outboundBuffer.push(message);
    } else {
      throw new Error("Cannot send: client is not connected");
    }
  }

  /**
   * Send an OCPP 2.1 unconfirmed message (RPC type SEND), such as
   * `send("NotifyPeriodicEventStream", {...})`. Nothing is answered, so this
   * resolves once the frame is handed to the socket. It does not wait behind
   * an outstanding CALL and throws on any protocol other than OCPP 2.1.
   */
  async send<
    M extends SendMethodNames<KnownProtocol<P>>,
    T extends SendRequestOf<KnownProtocol<P>, M>,
  >(
    method: CheckedAction<M, SendRequestOf<KnownProtocol<P>, M>, T>,
    params: T,
  ): Promise<void>;

  /** Send a SEND message the types do not check — `send(unchecked("VendorEvent"), params)`. */
  async send(method: UncheckedAction, params?: object): Promise<void>;

  async send(
    method: string,
    params:
      | OCPPSendRequestType<KnownProtocol<P>, SendMethodNames<KnownProtocol<P>>>
      | object = {},
  ): Promise<void> {
    if (!supportsSend(this._protocol)) {
      throw new Error(
        `SEND messages exist only in OCPP 2.1 and custom protocols; this connection uses ${this._protocol ?? "no subprotocol"}`,
      );
    }
    if (this._state !== OPEN || !this._ws) {
      throw new Error(`Cannot send: client is in state ${this._state}`);
    }

    const messageId = this._generateMessageId();
    const ctx: MiddlewareContext = {
      type: "outgoing_call",
      messageId,
      method,
      params,
      options: {},
      unconfirmed: true,
    };
    await this._middleware.execute(ctx, async (c) => {
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "outgoing_call" }
      >;
      const wrapped = this._wrapOutgoing(ctxvals);
      const wire = wrapped instanceof Promise ? await wrapped : wrapped;
      const frame: OCPPSend = [
        MessageType.SEND,
        messageId,
        wire.method,
        wire.params,
      ];
      this._ws?.send(JSON.stringify(frame));
    });
  }

  /**
   * The call as it goes on the wire: what the middleware left, or what its
   * `wrap` (an envelope such as a signature) makes of that.
   */
  private _wrapOutgoing(
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

  // ─── Reconfigure ─────────────────────────────────────────────

  reconfigure(options: Partial<BrowserClientOptions<P>>): void {
    assertUniqueProtocols(options.protocols ?? this._options.protocols);
    const detailedBefore = this._options.respondWithDetailedErrors;
    Object.assign(this._options, options);

    if (options.respondWithDetailedErrors && !detailedBefore) {
      this._warnDetailedErrors();
    }

    if (options.callConcurrency !== undefined) {
      this._callQueue.setConcurrency(options.callConcurrency);
    }
  }

  /** respondWithDetailedErrors sends a handler error's properties to the peer. */
  private _warnDetailedErrors(): void {
    this._logger.warn?.(
      "respondWithDetailedErrors is on: a handler error's properties are sent to the CSMS in CALLERROR details. Keep it off in production.",
    );
  }

  // ─── Internal: WebSocket attachment ──────────────────────────

  private _attachWebsocket(ws: WebSocket): void {
    ws.addEventListener("message", (event: MessageEvent) =>
      this._onMessage(event.data),
    );
    ws.addEventListener("close", (event: CloseEvent) =>
      this._onClose(event.code, event.reason),
    );
    ws.addEventListener("error", (event: Event) => this.emit("error", event));
  }

  // ─── Internal: Message handling ──────────────────────────────

  private _onMessage(data: unknown): void {
    const raw = typeof data === "string" ? data : String(data);

    // Some charge points send empty frames. They carry nothing to answer, and
    // counting them as bad messages would close an otherwise working link.
    if (raw.length === 0) return;

    // Until the message ID has been read, a bad frame is answered under ID
    // "-1" (2.0.1 / 2.1 §4.2.3: "When also the MessageId cannot be read").
    let message: OCPPMessage;
    try {
      message = JSON.parse(raw) as OCPPMessage;
    } catch {
      this._onBadMessage(
        raw,
        createRPCError("RpcFrameworkError", "Message must be a JSON structure"),
        UNREADABLE_ID_REPLY,
      );
      return;
    }
    if (!Array.isArray(message)) {
      this._onBadMessage(
        raw,
        createRPCError("RpcFrameworkError", "Message must be an array"),
        UNREADABLE_ID_REPLY,
      );
      return;
    }

    // Typed as parsed JSON: the frame is untrusted until checked below.
    const messageType: JsonValue = message[0];
    const messageId: JsonValue = message[1];

    if (typeof messageType !== "number") {
      this._onBadMessage(
        raw,
        createRPCError("RpcFrameworkError", "Message type must be a number"),
        UNREADABLE_ID_REPLY,
      );
      return;
    }

    // A type number this protocol does not define is a bad message, answered
    // with MessageTypeNotSupported (2.0.1 §4.4) under ID "-1": the frame's own
    // ID is not read for a type the protocol does not define.
    if (!this._isKnownMessageType(messageType)) {
      this._onBadMessage(
        raw,
        new RPCMessageTypeNotSupportedError(
          `Unknown message type: ${messageType}`,
        ),
        UNREADABLE_ID_REPLY,
      );
      return;
    }

    if (typeof messageId !== "string") {
      this._onBadMessage(
        raw,
        createRPCError("RpcFrameworkError", "Message ID must be a string"),
        UNREADABLE_ID_REPLY,
      );
      return;
    }

    // A rejected request ID is answered like an unreadable one, under "-1";
    // a SEND is never answered (2.1 Part 2 FR.07).
    if (messageType === MessageType.CALL || messageType === MessageType.SEND) {
      const idError = this._messageIdError(messageId);
      if (idError) {
        this._onBadMessage(
          raw,
          idError,
          messageType === MessageType.CALL ? UNREADABLE_ID_REPLY : undefined,
        );
        return;
      }
    }

    // Every OCPP-J version allows an absent payload to be sent as null
    // (1.6J §4.2.1, 2.0.1/2.1 §4.1.5); it means the same as {}.
    if (
      (messageType === MessageType.CALL || messageType === MessageType.SEND) &&
      message[3] === null
    ) {
      (message as OCPPCall)[3] = {};
    } else if (messageType === MessageType.CALLRESULT && message[2] === null) {
      (message as OCPPCallResult)[2] = {};
    }

    this._resetBadMessageCount();

    switch (messageType) {
      case MessageType.CALL:
        this._handleIncomingCall(message as OCPPCall);
        break;
      case MessageType.SEND:
        this._handleIncomingSend(message as OCPPSend);
        break;
      case MessageType.CALLRESULTERROR:
        this._handleCallResultError(message as OCPPCallResultError);
        break;
      case MessageType.CALLRESULT:
        this._handleCallResult(message as OCPPCallResult);
        break;
      case MessageType.CALLERROR:
        this._handleCallError(message as OCPPCallError);
        break;
    }
  }

  /**
   * CALLRESULTERROR exists only in OCPP 2.1; SEND in OCPP 2.1 and custom
   * protocols ({@link supportsSend}).
   */
  private _isKnownMessageType(type: number): boolean {
    if (
      type === MessageType.CALL ||
      type === MessageType.CALLRESULT ||
      type === MessageType.CALLERROR
    ) {
      return true;
    }
    if (type === MessageType.SEND) return supportsSend(this._protocol);
    return this._protocol === "ocpp2.1" && type === MessageType.CALLRESULTERROR;
  }

  private _findHandler(method: string): CallHandler | undefined {
    return (
      (this._protocol
        ? this._handlers.get(`${this._protocol}:${method}`)
        : undefined) ?? this._handlers.get(method)
    );
  }

  /**
   * OCPP 2.1 SEND: routed to the action's handler like a CALL, but nothing is
   * ever sent back, neither a result nor an error (Part 4 §4.2.4).
   */
  private async _handleIncomingSend(message: OCPPSend): Promise<void> {
    const [, msgId, method, params] = message;
    const ctx: MiddlewareContext = {
      type: "incoming_call",
      messageId: msgId,
      method,
      params,
      protocol: this._protocol,
      unconfirmed: true,
    };

    try {
      await this._middleware.execute(ctx, async (c) => {
        const ctxvals = c as Extract<
          MiddlewareContext,
          { type: "incoming_call" }
        >;
        if (this._state !== OPEN) return;

        const handler = this._findHandler(ctxvals.method);
        if (!handler && !this._wildcardHandler) {
          this._logger?.debug?.("No handler for SEND message", {
            method: ctxvals.method,
          });
          return;
        }

        const context: HandlerContext = {
          messageId: ctxvals.messageId,
          method: ctxvals.method,
          protocol: this._protocol,
          params: ctxvals.params,
          signal: new AbortController().signal,
          unconfirmed: true,
        };
        try {
          if (handler) {
            await handler(context);
          } else {
            await this._wildcardHandler?.(context);
          }
        } catch (err) {
          this._logger?.warn?.("Handler failed for SEND message", {
            method: ctxvals.method,
            error: (err as Error)?.message ?? String(err),
          });
        }
      });
    } catch (err) {
      this._logger?.error?.("Middleware failed on SEND message", {
        method,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }

  /** OCPP 2.1: the peer could not process a CALLRESULT we sent. Never answered. */
  private _handleCallResultError(message: OCPPCallResultError): void {
    const [, msgId, errorCode, errorDescription] = message;
    this._logger?.warn?.("Peer could not process a CALLRESULT", {
      messageId: msgId,
      errorCode,
      errorDescription,
    });
    this.emit("callResultError", message);
  }

  private async _handleIncomingCall(message: OCPPCall): Promise<void> {
    const [, msgId, method, params] = message;

    const ctx: MiddlewareContext = {
      type: "incoming_call",
      messageId: msgId,
      method,
      params,
      protocol: this._protocol,
    };

    // Whether the chain reached the handler step, which answers the CALL
    // itself, with a CALLRESULT or a CALLERROR.
    let reachedHandler = false;
    const chain = this._middleware.execute(ctx, async (c) => {
      reachedHandler = true;
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "incoming_call" }
      >;

      const modifiedMessage: OCPPCall = [
        MessageType.CALL,
        ctxvals.messageId,
        ctxvals.method,
        ctxvals.params,
      ];
      this.emit("call", modifiedMessage);

      if (this._state !== OPEN) {
        return;
      }

      try {
        if (this._pendingResponses.has(ctxvals.messageId)) {
          // 1.6J Table 7 has no RpcFrameworkError; GenericError covers
          // "any other error not covered by the previous ones".
          throw createRPCError(
            this._protocol === "ocpp1.6" ? "GenericError" : "RpcFrameworkError",
            `Already processing call with ID: ${ctxvals.messageId}`,
          );
        }

        const specificHandler = this._findHandler(ctxvals.method);

        if (!specificHandler && !this._wildcardHandler) {
          throw createRPCError(
            "NotImplemented",
            `No handler for method: ${ctxvals.method}`,
          );
        }

        this._pendingResponses.add(ctxvals.messageId);

        const ac = new AbortController();
        const context: HandlerContext = {
          messageId: ctxvals.messageId,
          method: ctxvals.method,
          protocol: this._protocol,
          params: ctxvals.params,
          signal: ac.signal,
        };

        let result: unknown;
        if (specificHandler) {
          result = await specificHandler(context);
        } else if (this._wildcardHandler) {
          result = await this._wildcardHandler(context);
        }

        this._pendingResponses.delete(ctxvals.messageId);

        if (result === NOREPLY) return;

        const response: OCPPCallResult = [
          MessageType.CALLRESULT,
          ctxvals.messageId,
          result,
        ];
        this._ws?.send(JSON.stringify(response));
        this.emit("callResult", response);
      } catch (err) {
        this._pendingResponses.delete(ctxvals.messageId);
        this._logger.error?.("Handler error", {
          messageId: ctxvals.messageId,
          method: ctxvals.method,
          error: (err as Error).message,
        });

        const rpcErr =
          err instanceof RPCGenericError || (err as RPCError).rpcErrorCode
            ? (err as RPCError)
            : createRPCError("InternalError", (err as Error).message);

        // Never ship stack traces to remote peers (report M13)
        const details = this._options.respondWithDetailedErrors
          ? getErrorPlainObject(err as Error, false)
          : {};

        const errorResponse: OCPPCallError = [
          MessageType.CALLERROR,
          ctxvals.messageId,
          rpcErr.rpcErrorCode,
          this._fitErrorDescription(
            rpcErr.rpcErrorMessage || (err as Error).message || "",
          ),
          details,
        ];
        this._ws?.send(JSON.stringify(errorResponse));
        this.emit("callError", errorResponse);
      }
    });

    try {
      await chain;
    } catch (err) {
      // Nothing awaits this method (_onMessage calls it and moves on), so an
      // error leaving it would be an unhandled rejection.
      this._logger.error?.("Middleware failed on incoming call", {
        messageId: msgId,
        method,
        error: (err as Error)?.message ?? String(err),
      });
      // Past the handler step, the CALL was already answered.
      if (reachedHandler || this._state !== OPEN) return;

      // A middleware threw before the handler step (rejecting the call, or
      // failing). Nothing answered the CALL, and OCPP-J requires an answer:
      // without one the peer only learns of it from its own timeout.
      const rpcErr =
        err instanceof RPCGenericError || (err as RPCError).rpcErrorCode
          ? (err as RPCError)
          : createRPCError("InternalError", (err as Error).message);
      const errorResponse: OCPPCallError = [
        MessageType.CALLERROR,
        msgId,
        rpcErr.rpcErrorCode,
        this._fitErrorDescription(
          rpcErr.rpcErrorMessage || (err as Error).message || "",
        ),
        this._options.respondWithDetailedErrors
          ? getErrorPlainObject(err as Error, false)
          : {},
      ];
      this._ws?.send(JSON.stringify(errorResponse));
      this.emit("callError", errorResponse);
    }
  }

  /**
   * A middleware rejected a reply (CALLRESULT or CALLERROR), or failed on it.
   * The caller is waiting on this call, and without this it only saw its
   * timeout. Once the call is settled, the error is only logged.
   */
  private _failPendingCall(msgId: string, err: Error): void {
    const pending = this._pendingCalls.get(msgId);
    if (!pending) {
      this._logger.error?.("Middleware failed on a reply", {
        messageId: msgId,
        error: err?.message ?? String(err),
      });
      return;
    }
    clearTimeout(pending.timeoutHandle);
    pending.removeAbortListener?.();
    this._pendingCalls.delete(msgId);
    pending.reject(err);
  }

  private async _handleCallResult(message: OCPPCallResult): Promise<void> {
    const [, msgId, result] = message;

    if (!this._pendingCalls.has(msgId)) {
      if (this._takeNoReplyAnswer(msgId)) return;
      this._logger.warn?.("Received CallResult for unknown messageId", {
        messageId: msgId,
      });
      return;
    }

    const pending = this._pendingCalls.get(msgId)!;

    const ctx: MiddlewareContext = {
      type: "incoming_result",
      messageId: msgId,
      method: pending.method,
      payload: result,
    };

    const chain = this._middleware.execute(ctx, async (c) => {
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "incoming_result" }
      >;

      const modifiedMessage: OCPPCallResult = [
        MessageType.CALLRESULT,
        msgId,
        ctxvals.payload,
      ];
      this.emit("callResult", modifiedMessage);

      clearTimeout(pending.timeoutHandle);
      pending.removeAbortListener?.();
      this._pendingCalls.delete(msgId);
      pending.resolve(ctxvals.payload);
    });
    try {
      await chain;
    } catch (err) {
      this._failPendingCall(msgId, err as Error);
    }
  }

  private async _handleCallError(message: OCPPCallError): Promise<void> {
    const [, msgId] = message;

    if (!this._pendingCalls.has(msgId)) {
      if (this._takeNoReplyAnswer(msgId)) return;
      this._logger.warn?.("Received CallError for unknown messageId", {
        messageId: msgId,
      });
      return;
    }

    const pending = this._pendingCalls.get(msgId)!;

    // The frame, as the Node client gives it: middleware sees and may change
    // the CALLERROR, and the call fails with what it leaves.
    const ctx: MiddlewareContext = {
      type: "incoming_error",
      messageId: msgId,
      method: pending.method,
      error: message,
    };

    const chain = this._middleware.execute(ctx, async (c) => {
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "incoming_error" }
      >;
      this.emit("callError", ctxvals.error);

      const [, , code, errorMessage, details] = ctxvals.error;

      clearTimeout(pending.timeoutHandle);
      pending.removeAbortListener?.();
      this._pendingCalls.delete(msgId);
      pending.reject(createRPCError(code, errorMessage, details));
    });
    try {
      await chain;
    } catch (err) {
      this._failPendingCall(msgId, err as Error);
    }
  }

  // ─── Internal: Bad message handling ──────────────────────────

  /** maxBadMessages counts bad messages in a row, so a valid frame ends the run. */
  private _resetBadMessageCount(): void {
    this._badMessageCount = 0;
    this._badMessageWindowStart = 0;
  }

  /**
   * Why an incoming request's message ID is rejected, if it is. Only
   * idValidator decides: the browser client has no strict mode. 1.6 has no
   * RpcFrameworkError (Table 7), so GenericError answers there.
   */
  private _messageIdError(messageId: string): RPCError | undefined {
    const validate = this._options.idValidator;
    if (!validate) return undefined;
    const code =
      this._protocol === "ocpp1.6" ? "GenericError" : "RpcFrameworkError";
    let valid: boolean;
    try {
      valid = validate(messageId);
    } catch (err) {
      return createRPCError(
        code,
        `idValidator failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return valid ? undefined : createRPCError(code, "Message ID rejected");
  }

  /** ErrorDescription is string[255] on 2.0.1 and 2.1 (Table 7); 1.6 sets no limit. */
  private _fitErrorDescription(description: string): string {
    if (this._protocol !== "ocpp2.0.1" && this._protocol !== "ocpp2.1") {
      return description;
    }
    const chars = Array.from(description);
    return chars.length > 255 ? chars.slice(0, 255).join("") : description;
  }

  private _onBadMessage(
    rawMessage: string,
    error: Error,
    reply?: BadMessageReply,
  ): void {
    const now = Date.now();
    const windowMs = this._options.badMessageWindowMs;

    if (windowMs && windowMs > 0 && this._badMessageWindowStart > 0) {
      if (now - this._badMessageWindowStart >= windowMs) {
        this._badMessageCount = 0;
        this._badMessageWindowStart = 0;
      }
    }

    this._badMessageCount++;
    if (this._badMessageWindowStart === 0) {
      this._badMessageWindowStart = now;
    }

    this._logger?.warn?.("Bad message", {
      error: error.message,
      count: this._badMessageCount,
    });
    this.emit("badMessage", { message: rawMessage, error });

    // The caller decides whether and how the frame is answered. A CALLERROR is
    // never answered, so two peers cannot loop on each other's errors.
    if (reply && this._ws) {
      const rpcCode = (error as { rpcErrorCode?: string }).rpcErrorCode;
      // OCPP 1.6J spells this error "FormationViolation" (report M7)
      const formatCode =
        this._protocol === "ocpp1.6" ? "FormationViolation" : "FormatViolation";
      // GenericError exists in every version and passes through.
      const code =
        !rpcCode || rpcCode === "FormatViolation" ? formatCode : rpcCode;
      const frame: OCPPCallError | OCPPCallResultError = [
        reply.frame,
        reply.messageId,
        code,
        this._fitErrorDescription(error.message || "Invalid message format"),
        {},
      ];
      this._ws.send(JSON.stringify(frame));
      if (frame[0] === MessageType.CALLERROR) this.emit("callError", frame);
    }

    if (this._badMessageCount >= this._options.maxBadMessages) {
      this.close({ code: 1002, reason: "Too many bad messages" }).catch(
        () => {},
      );
    }
  }

  // ─── Internal: Close handling ────────────────────────────────

  /**
   * Reject all in-flight calls and clear pending state.
   */
  private _rejectPendingCalls(reason: string): void {
    for (const [, pending] of this._pendingCalls) {
      clearTimeout(pending.timeoutHandle);
      pending.removeAbortListener?.();
      pending.reject(new Error(reason));
    }
    this._pendingCalls.clear();
    this._pendingResponses.clear();
    // No answer can arrive on a closed socket.
    for (const forget of this._noReplyCalls.values()) clearTimeout(forget);
    this._noReplyCalls.clear();
  }

  /** The answer to a noReply call: dropped quietly. False if it was not one. */
  private _takeNoReplyAnswer(msgId: string): boolean {
    const forget = this._noReplyCalls.get(msgId);
    if (forget === undefined) return false;
    clearTimeout(forget);
    this._noReplyCalls.delete(msgId);
    this._logger.debug?.("Dropped the answer to a noReply call", {
      messageId: msgId,
    });
    return true;
  }

  private _onClose(code: number, reason: string): void {
    this._rejectPendingCalls(`Connection closed (${code}: ${reason})`);

    if (this._state !== CLOSING) {
      // Unexpected close — emit disconnect (transient, reconnect may follow)
      this._logger?.info?.("Disconnected", { code, reason });
      this.emit("disconnect", { code, reason });

      if (
        this._options.reconnect &&
        this._reconnectAttempt < this._options.maxReconnects
      ) {
        this._scheduleReconnect();
      } else {
        // No reconnect — permanent close
        this._state = CLOSED;
        this.emit("close", { code, reason });
      }
    } else {
      this._state = CLOSED;
      // close() handles the emit
    }
  }

  // ─── Internal: Reconnection ──────────────────────────────────

  /** Errors that should stop reconnection immediately */
  private static readonly _INTOLERABLE_ERRORS = new Set([
    "Maximum redirects exceeded",
    "Server sent no subprotocol",
    "Server sent an invalid subprotocol",
    "Server sent a subprotocol but none was requested",
    "Invalid Sec-WebSocket-Accept header",
  ]);

  private _scheduleReconnect(): void {
    this._reconnectAttempt++;
    this._state = CONNECTING;

    // OCPP-J 2.0.1 / 2.1 §5.3: start from the minimum, double after every
    // failed attempt, and add a new random part to every wait. The random part
    // only ever adds (up to 25%), so no wait drops below backoffMin, and
    // chargers that reached backoffMax still spread out instead of
    // reconnecting in step after a CSMS restart.
    // The 50 ms floor keeps `backoffMin: 0` from reconnecting in a tight loop.
    const base = Math.max(50, this._options.backoffMin);
    const max = Math.max(base, this._options.backoffMax);
    const delayMs =
      Math.min(max, base * 2 ** (this._reconnectAttempt - 1)) *
      (1 + Math.random() * 0.25);

    this._logger?.warn?.("Reconnecting", {
      attempt: this._reconnectAttempt,
      delayMs: Math.round(delayMs),
    });
    this.emit("reconnect", {
      attempt: this._reconnectAttempt,
      delay: delayMs,
    });

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this._connectInternal();
      } catch (err) {
        // Intolerable errors — do not retry
        const msg = err instanceof Error ? err.message : "";
        if (BrowserOCPPClient._INTOLERABLE_ERRORS.has(msg)) {
          this._logger?.error?.("Intolerable error — stopping reconnection", {
            error: msg,
          });
          this._state = CLOSED;
          this.emit("close", { code: 1001, reason: msg });
          return;
        }

        if (
          this._reconnectAttempt < this._options.maxReconnects &&
          this._options.reconnect
        ) {
          this._scheduleReconnect();
        } else {
          // Max reconnects exhausted
          this._state = CLOSED;
          this.emit("close", {
            code: 1001,
            reason: "Max reconnection attempts exhausted",
          });
        }
      }
    }, delayMs);
  }

  // ─── Internal: Endpoint building ─────────────────────────────

  private _buildEndpoint(): string {
    // Use URL so identities land in the pathname even when the configured
    // endpoint carries a query string (report: low/_buildEndpoint).
    const url = new URL(this._options.endpoint);
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    url.pathname += encodeURIComponent(this._identity);

    if (this._options.query) {
      for (const [k, v] of new URLSearchParams(this._options.query)) {
        url.searchParams.append(k, v);
      }
    }
    return url.toString();
  }

  // ─── Internal: Cleanup ───────────────────────────────────────

  private _cleanup(): void {
    this._closePromise = null;
    this._ws = null;
  }

  // ─── Internal: ID Generation ─────────────────────────────────

  private _generateMessageId(): string {
    // 0. The application's own generator wins.
    const generate = this._options.idGenerator;
    if (generate) {
      const id = generate();
      if (typeof id !== "string" || id === "") {
        throw new TypeError("idGenerator must return a non-empty string");
      }
      return id;
    }

    // 1. Try native crypto.randomUUID (Fastest, secure, requires HTTPS/localhost)
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }

    // 2. Fallback to Math.random() for older browsers or insecure HTTP contexts
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

/** The members of BrowserOCPPClient whose types follow its protocols. */
type ProtocolTypedMember =
  | "call"
  | "safeCall"
  | "handle"
  | "send"
  | "forProtocol";

/** A listener of one of the browser client's events. */
type ClientEventListener<K extends keyof BrowserClientEvents> = (
  ...args: BrowserClientEvents[K]
) => void;
/** Emitter methods that return `this`, the client of one protocol set. */
type ChainingMember =
  | "on"
  | "once"
  | "off"
  | "addListener"
  | "removeListener"
  | "removeAllListeners";

/**
 * Any BrowserOCPPClient, whatever protocols it is configured for: every
 * member except the calls typed by protocol. A client typed for its protocols does not fit
 * a variable of another protocol set, so code holding differently configured
 * clients, such as a list to close, uses this type.
 */
export interface AnyBrowserOCPPClient
  extends Omit<BrowserOCPPClient, ProtocolTypedMember | ChainingMember> {
  on<K extends keyof BrowserClientEvents>(
    event: K,
    listener: ClientEventListener<K>,
  ): AnyBrowserOCPPClient;
  once<K extends keyof BrowserClientEvents>(
    event: K,
    listener: ClientEventListener<K>,
  ): AnyBrowserOCPPClient;
  off<K extends keyof BrowserClientEvents>(
    event: K,
    listener: ClientEventListener<K>,
  ): AnyBrowserOCPPClient;
  addListener<K extends keyof BrowserClientEvents>(
    event: K,
    listener: ClientEventListener<K>,
  ): AnyBrowserOCPPClient;
  removeListener<K extends keyof BrowserClientEvents>(
    event: K,
    listener: ClientEventListener<K>,
  ): AnyBrowserOCPPClient;
  removeAllListeners(event?: keyof BrowserClientEvents): AnyBrowserOCPPClient;
}
