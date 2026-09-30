import { EventEmitter } from "node:events";
import WebSocket from "ws";
import {
  type RPCError,
  RPCFormatViolationError,
  RPCGenericError,
  RPCMessageTypeNotSupportedError,
  RPCNotImplementedError,
  TimeoutError,
  UnexpectedHttpResponse,
} from "./errors.js";
import type {
  AllMethodNames,
  OCPPRequestType,
  OCPPResponseType,
} from "./generated/index.js";
import { createLoggingMiddleware } from "./helpers/index.js";
import { initLogger } from "./init-logger.js";
import { type MiddlewareFunction, MiddlewareStack } from "./middleware";
import { Queue } from "./queue.js";
import { getStandardValidator } from "./standard-validators.js";
import {
  type CallHandler,
  type CallOptions,
  type ClientEvents,
  type ClientOptions,
  type CloseOptions,
  ConnectionState,
  type HandlerContext,
  type JsonValue,
  type LoggerLike,
  type LoggerLikeNotOptional,
  type MessageDirection,
  type MessageEventContext,
  type MessageEventPayload,
  MessageType,
  type MiddlewareContext,
  NOREPLY,
  type OCPPCall,
  type OCPPCallError,
  type OCPPCallResult,
  type OCPPCallResultError,
  type OCPPMessage,
  type OCPPProtocol,
  type OCPPSend,
  type OCPPSendRequestType,
  SecurityProfile,
  type SendMethodNames,
  type TypedEventEmitter,
  type WildcardHandler,
} from "./types.js";
import {
  createId,
  createRPCError,
  getErrorPlainObject,
  getPackageIdent,
  NOOP_LOGGER,
} from "./util.js";
import type { Validator } from "./validator.js";
import { isEmptyFrame, isValidStatusCode } from "./ws-util.js";

const { CONNECTING, OPEN, CLOSING, CLOSED } = ConnectionState;

/** Fewest elements a frame of each message type can have (Part 4 §4.2). */
const MIN_FRAME_LENGTH: Readonly<Record<number, number>> = {
  [MessageType.CALL]: 4,
  [MessageType.CALLRESULT]: 3,
  [MessageType.CALLERROR]: 5,
  [MessageType.CALLRESULTERROR]: 5,
  [MessageType.SEND]: 4,
};

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

/** Which schema of a message is being validated. */
type SchemaKind = "req" | "conf" | "send";

/**
 * Schema id for a message. A SEND has a single schema with no request/response
 * suffix (`urn:NotifyPeriodicEventStream`).
 */
function schemaIdFor(method: string, kind: SchemaKind): string {
  return kind === "send" ? `urn:${method}` : `urn:${method}.${kind}`;
}

/** Position of the payload (or error details) object per message type. */
const PAYLOAD_INDEX: Readonly<Record<number, number>> = {
  [MessageType.CALL]: 3,
  [MessageType.CALLRESULT]: 2,
  [MessageType.CALLERROR]: 4,
  [MessageType.CALLRESULTERROR]: 4,
  [MessageType.SEND]: 3,
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
 * OCPPClient — A typed WebSocket RPC client for OCPP communication.
 *
 * Supports all 3 OCPP Security Profiles:
 * - Profile 1: Basic Auth over unsecured WS
 * - Profile 2: TLS + Basic Auth
 * - Profile 3: Mutual TLS (client certificates)
 */
export class OCPPClient<
  P extends OCPPProtocol = OCPPProtocol,
> extends (EventEmitter as new () => TypedEventEmitter<ClientEvents>) {
  // Static connection states
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  protected _options: Required<
    Pick<
      ClientOptions,
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
      | "backoffMax"
    >
  > &
    ClientOptions;

  protected _state: ConnectionState = CLOSED;
  protected _ws: WebSocket | null = null;
  protected _protocol: string | undefined;
  protected _identity: string;

  private _handlers = new Map<string, CallHandler>();
  private _wildcardHandler: WildcardHandler | null = null;
  private _pendingCalls = new Map<string, PendingCall>();
  private _pendingResponses = new Set<string>();
  private _callQueue: Queue;
  private _pingTimer: ReturnType<typeof setTimeout> | null = null;
  protected _pongTimer: ReturnType<typeof setTimeout> | null = null;
  private _closePromise: Promise<{ code: number; reason: string }> | null =
    null;
  private _reconnectAttempt = 0;
  /**
   * Set by close(), cleared by connect(). A reconnect timer that has already
   * fired cannot be cancelled by clearTimeout, so the attempt itself has to
   * check whether the caller closed the client while it was in flight.
   */
  private _closeRequested = false;

  /** When the current socket opened; anchors the startup handler grace window. */
  private _openedAt = 0;
  /** Callers parked waiting for a handler to appear during that window. */
  private _handlerWaiters = new Set<() => void>();
  /** Cap on parked messages, so an unknown-action flood cannot pile up. */
  private static readonly _MAX_HANDLER_WAITERS = 100;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _badMessageCount = 0;
  private _badMessageWindowStart = 0;
  private _lastActivity = 0;
  private _outboundBuffer: string[] = [];
  /**
   * Cap on frames buffered while CONNECTING. Without one, a client that never
   * finishes connecting accumulates every send until the process runs out of
   * memory. Oldest frames are dropped first, matching the offline queue.
   */
  private static readonly _OUTBOUND_BUFFER_MAX = 1000;
  private _offlineQueue: Array<{
    method: string;
    params: unknown;
    options: CallOptions;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];
  private _middleware: MiddlewareStack<MiddlewareContext>;
  /** Explicit validators from options; null means resolve per protocol. */
  private _validators: Validator[] | null = null;
  private _strictProtocols: string[] | null = null;
  protected _handshake: unknown = null;
  protected _logger: LoggerLike = NOOP_LOGGER;
  protected _exchangeLog = false;
  protected _prettify = false;

  constructor(options: ClientOptions) {
    super();
    this.setMaxListeners(0);

    if (!options.identity) {
      throw new Error("identity is required");
    }

    this._identity = options.identity;

    this._options = {
      reconnect: true,
      maxReconnects: Infinity,
      backoffMin: 1000,
      backoffMax: 30000,
      callTimeoutMs: 30000,
      pingIntervalMs: 30000,
      deferPingsOnActivity: false,
      callConcurrency: 1,
      maxBadMessages: 50,
      respondWithDetailedErrors: false,
      securityProfile: SecurityProfile.NONE,
      ...options,
    };

    this._callQueue = new Queue(this._options.callConcurrency);
    this._middleware = new MiddlewareStack<MiddlewareContext>();

    // Initialize logger
    const loggingCfg = this._options.logging;
    const loggerInstance = initLogger(loggingCfg, {
      component: "OCPPClient",
      identity: this._identity,
    });
    // Ensure logger is always defined (use NOOP if disabled)
    this._logger = loggerInstance || NOOP_LOGGER;

    if (loggingCfg && typeof loggingCfg === "object") {
      this._exchangeLog = loggingCfg.exchangeLog ?? false;
      this._prettify = loggingCfg.prettify ?? false;
    }

    if (this._options.logging) {
      // Since logging is enabled, initLogger ensures _logger is set.
      this.use(
        createLoggingMiddleware(
          this._logger,
          this._identity,
          this._options.logging,
        ),
      );
    }

    // Set up strict mode validators
    if (this._options.strictMode) {
      this._setupValidators();
    }
  }

  // ─── Exchange Log Helper ──────────────────────────────────────

  /**
   * Log an OCPP message exchange.
   * - Default: "CALL → { method }" at debug level
   * - exchangeLog: adds `direction` to meta
   * - prettify + exchangeLog: renders styled line like "⚡ CP-101  →  BootNotification  [OUT]"
   */
  protected _logExchange(
    direction: "IN" | "OUT",
    type: "CALL" | "CALLRESULT" | "CALLERROR",
    method: string | undefined,
    meta: Record<string, unknown>,
  ): void {
    if (!this._logger) return;

    const arrow = direction === "OUT" ? "→" : "←";
    const level =
      type === "CALLERROR" ? "warn" : this._exchangeLog ? "info" : "debug";

    if (this._exchangeLog && this._prettify) {
      // Styled exchange line
      const icon =
        type === "CALLERROR" ? "🚨" : type === "CALLRESULT" ? "✅" : "⚡";
      const label = method ?? type;
      const msg = `${icon} ${this._identity}  ${arrow}  ${label}  [${direction}]`;
      this._logger?.[level]?.(msg, { ...meta, direction });
    } else if (this._exchangeLog) {
      // JSON with direction meta
      this._logger?.[level]?.(`${type} ${arrow}`, { ...meta, direction });
    } else {
      // Default plain
      this._logger?.[level]?.(`${type} ${arrow}`, meta);
    }
  }

  // ─── Getters ─────────────────────────────────────────────────
  /**
   * Returns the underlying logger instance wrapper.
   */
  get log() {
    return (this._logger || NOOP_LOGGER) as LoggerLikeNotOptional;
  }

  /**
   * The unique client identity (Charge Point ID or Central System ID).
   */
  public get identity(): string {
    return this._options.identity;
  }

  /**
   * The connection endpoint URL.
   */
  public get endpoint(): string {
    return this._options.endpoint;
  }

  /**
   * Bytes currently queued in the underlying WebSocket send buffer
   * (0 when disconnected). Useful for backpressure monitoring and drain checks.
   */
  get bufferedAmount(): number {
    return this._ws?.bufferedAmount ?? 0;
  }

  /**
   * The current configuration options for this client.
   */
  public get options(): Readonly<ClientOptions> {
    return this._options;
  }

  /**
   * The negotiated OCPP protocol version, available after connection.
   */
  get protocol(): string | undefined {
    return this._protocol;
  }

  /**
   * The current WebSocket connection state.
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * The configured security profile.
   */
  get securityProfile(): SecurityProfile {
    return this._options.securityProfile ?? SecurityProfile.NONE;
  }

  // ─── Connect ─────────────────────────────────────────────────

  /**
   * Connect to the OCPP endpoint via WebSocket.
   * Throws an error if the connection attempt fails, or if already connected/connecting.
   *
   * @returns A promise that resolves to an object containing the HTTP response from the upgrade request.
   */
  async connect(): Promise<{
    response: import("node:http").IncomingMessage;
  }> {
    if (this._state !== CLOSED) {
      throw new Error(`Cannot connect: client is in state ${this._state}`);
    }

    this._state = CONNECTING;
    this._reconnectAttempt = 0;
    this._closeRequested = false;

    try {
      return await this._connectInternal();
    } catch (err) {
      // `reconnect: true` has to mean "keep trying", including from the very
      // first attempt. Reconnection previously started only once an
      // *established* connection dropped, so a charge point that booted while
      // the CSMS was down threw once and never retried — the exact outage the
      // option exists for. connect() still rejects, so the caller learns about
      // the failure; the retry runs in the background and close() cancels it.
      const msg = err instanceof Error ? err.message : "";
      if (
        (this._options as ClientOptions).retryInitialConnect === true &&
        this._options.reconnect &&
        this._options.maxReconnects > 0 &&
        !this._closeRequested &&
        !OCPPClient._INTOLERABLE_ERRORS.has(msg)
      ) {
        this._scheduleReconnect();
      }
      throw err;
    }
  }

  private async _connectInternal(): Promise<{
    response: import("node:http").IncomingMessage;
  }> {
    return new Promise((resolve, reject) => {
      const endpoint = this._buildEndpoint();
      const wsOptions = this._buildWsOptions();

      this._logger?.debug?.("Connecting", { url: endpoint });
      this.emit("connecting", { url: endpoint });

      const ws = new WebSocket(
        endpoint,
        this._options.protocols ?? [],
        wsOptions,
      );
      this._ws = ws;

      const onOpen = () => {
        cleanup();
        this._state = OPEN;
        this._protocol = ws.protocol;
        this._badMessageCount = 0;
        this._badMessageWindowStart = 0;

        // Narrow protocols to negotiated protocol for future reconnects (prevents flip-flopping)
        if (ws.protocol && this._reconnectAttempt === 0) {
          this._options.protocols = [ws.protocol];
        }

        // Reset the reconnect counter on a successful (re)connection so that
        // `maxReconnects` and backoff are per-disconnection-incident, not a
        // cumulative lifetime budget (OCPP 2.0.1 §J.1 backoff resets on connect).
        this._reconnectAttempt = 0;

        this._openedAt = Date.now();
        this._attachWebsocket(ws);
        this._startPing();

        // Flush offline queue (atomic drain to prevent re-entry)
        this._flushOfflineQueue();

        // Flush outbound buffer (messages queued during CONNECTING)
        if (this._outboundBuffer.length > 0) {
          const buffer = this._outboundBuffer;
          this._outboundBuffer = [];
          for (const msg of buffer) this._ws?.send(msg);
        }

        this._logger?.info?.("Connected", { protocol: ws.protocol });

        // Create a minimal response object
        const response = (
          ws as unknown as {
            _req?: { res?: import("node:http").IncomingMessage };
          }
        )._req?.res;
        const result = {
          response: response as import("node:http").IncomingMessage,
        };
        this.emit("open", result);
        resolve(result);
      };

      const onError = (err: Error) => {
        cleanup();
        this._state = CLOSED;
        this._logger?.error?.("Connection error", {
          error: err.message,
        });
        // The connect() rejection is the primary failure signal — only emit
        // "error" when someone listens, otherwise EventEmitter throws and
        // the rejection below never runs.
        if (this.listenerCount("error") > 0) this.emit("error", err);
        reject(err);
      };

      const onUnexpectedResponse = (
        _req: import("node:http").ClientRequest,
        res: import("node:http").IncomingMessage,
      ) => {
        cleanup();
        this._state = CLOSED;
        const err = new UnexpectedHttpResponse(
          `Unexpected HTTP response: ${res.statusCode}`,
          res.statusCode ?? 0,
          res.headers as Record<string, string>,
        );
        this._logger?.error?.("Unexpected HTTP response", {
          statusCode: res.statusCode,
        });
        if (this.listenerCount("error") > 0) this.emit("error", err);
        reject(err);
      };

      const cleanup = () => {
        ws.removeListener("open", onOpen);
        ws.removeListener("error", onError);
        ws.removeListener("unexpected-response", onUnexpectedResponse);
      };

      ws.on("open", onOpen);
      ws.on("error", onError);
      ws.on("unexpected-response", onUnexpectedResponse);
    });
  }

  // ─── Close ───────────────────────────────────────────────────

  /**
   * Close the WebSocket connection.
   * By default, it awaits any pending calls to finish before closing.
   *
   * @param options Configuration for closing the connection (code, reason, awaiting pending calls, force close).
   * @returns A promise that resolves when the connection is fully closed.
   */
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

    // Recorded before any await so an in-flight reconnect attempt can see it.
    this._closeRequested = true;

    if (this._state === CLOSED) {
      // Already closed, so there is no socket to shut down — but a client that
      // never connected (or that gave up reconnecting) can still be holding
      // offline-queued calls whose callers are waiting on a promise. Nothing
      // will ever flush them, so settle them here instead of returning early
      // and stranding them forever.
      this._drainOfflineQueue("Client closed");
      this._outboundBuffer.length = 0;
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
    this._stopPing();

    // Calls still waiting behind the concurrency limit have not been sent, so
    // there is nothing to await — but nothing settled them either, and once the
    // socket is gone they can never run. Reject them before draining the
    // in-flight ones. (force skips this only in the sense that everything is
    // rejected below anyway.)
    const droppedFromQueue = this._callQueue.clear(
      new Error("Client closed before the call was sent"),
    );
    if (droppedFromQueue > 0) {
      this._logger?.debug?.("Rejected queued calls on close", {
        count: droppedFromQueue,
      });
    }

    if (!force && awaitPending) {
      // Wait for pending calls to resolve
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

      const onClose = (closeCode: number, closeReason: Buffer) => {
        this._ws?.removeListener("close", onClose);
        this._state = CLOSED;
        this._cleanup();
        const result = {
          code: closeCode,
          reason: closeReason.toString(),
        };
        this.emit("close", result);
        resolve(result);
      };

      this._ws.on("close", onClose);

      if (force) {
        this._ws.terminate();
      } else {
        this._ws.close(isValidStatusCode(code) ? code : 1000, reason);
      }
    });
  }

  /**
   * Register a version-specific handler — `handle("ocpp1.6", "BootNotification", handler)`.
   * This handler is only invoked when the active protocol matches the given version.
   *
   * @throws {Error} If a handler for this version and method is already registered on this client instance.
   */
  handle<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    version: V,
    method: M,
    handler: (
      context: HandlerContext<OCPPRequestType<V, M>>,
    ) =>
      | OCPPResponseType<V, M>
      | Promise<OCPPResponseType<V, M>>
      | typeof NOREPLY,
  ): void;

  /**
   * Register a version-specific handler for an OCPP 2.1 SEND message —
   * `handle("ocpp2.1", "NotifyPeriodicEventStream", handler)`. Nothing is sent
   * back for a SEND: `ctx.unconfirmed` is true and the return value is ignored.
   */
  handle<V extends OCPPProtocol, M extends SendMethodNames<V>>(
    version: V,
    method: M,
    handler: (
      context: HandlerContext<OCPPSendRequestType<V, M>>,
    ) => void | Promise<void>,
  ): void;

  /**
   * Register a handler for a custom/extension protocol/method not in the typed OCPP method maps.
   * `handle("my-protocol", "my-method", handler)`
   *
   * Note: This overload matches only if the protocol is NOT a known strict protocol of standard OCPP versions.
   *
   * @throws {Error} If a handler for this protocol and method is already registered on this client instance.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle<S extends string>(
    version: S extends OCPPProtocol ? never : S,
    method: string,
    handler: (context: HandlerContext<Record<string, any>>) => any,
  ): void;

  /**
   * Register a handler for the client's default protocol — `handle("BootNotification", handler)`.
   * Uses the default protocol type parameter `P`.
   *
   * @throws {Error} If a handler for this method is already registered on this client instance.
   */
  handle<M extends AllMethodNames<P>>(
    method: M,
    handler: (
      context: HandlerContext<OCPPRequestType<P, M>>,
    ) =>
      | OCPPResponseType<P, M>
      | Promise<OCPPResponseType<P, M>>
      | typeof NOREPLY,
  ): void;

  /**
   * Register a handler for an OCPP 2.1 SEND message on the client's default
   * protocol — `handle("NotifyPeriodicEventStream", handler)`. Nothing is sent
   * back for a SEND: `ctx.unconfirmed` is true and the return value is ignored.
   */
  handle<M extends SendMethodNames<P>>(
    method: M,
    handler: (
      context: HandlerContext<OCPPSendRequestType<P, M>>,
    ) => void | Promise<void>,
  ): void;

  /**
   * Register a handler for a custom/extension method not in the typed OCPP method maps.
   *
   * @throws {Error} If a handler for this method is already registered on this client instance.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(
    method: string,
    handler: (context: HandlerContext<Record<string, any>>) => any,
  ): void;

  /**
   * Register a wildcard handler for all unhandled methods.
   *
   * @throws {Error} If a wildcard handler is already registered on this client instance.
   */
  handle(handler: WildcardHandler): void;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(...args: any[]): void {
    if (args.length === 1 && typeof args[0] === "function") {
      // Wildcard handler
      if (this._wildcardHandler) {
        throw new Error("Wildcard handler is already registered.");
      }
      this._wildcardHandler = args[0] as WildcardHandler;
    } else if (
      args.length === 2 &&
      typeof args[0] === "string" &&
      typeof args[1] === "function"
    ) {
      // handle(method, handler) — default protocol
      if (this._handlers.has(args[0])) {
        throw new Error(`Handler for '${args[0]}' is already registered.`);
      }
      this._handlers.set(args[0], args[1] as CallHandler);
      this._releaseHandlerWaiters();
    } else if (
      args.length === 3 &&
      typeof args[0] === "string" &&
      typeof args[1] === "string" &&
      typeof args[2] === "function"
    ) {
      // handle(version, method, handler) — version-specific
      const key = `${args[0]}:${args[1]}`;
      if (this._handlers.has(key)) {
        throw new Error(
          `Handler for '${args[1]}' (protocol: ${args[0]}) is already registered.`,
        );
      }
      this._handlers.set(key, args[2] as CallHandler);
      this._releaseHandlerWaiters();
    } else {
      throw new Error(
        "Invalid arguments: provide (version, method, handler), (method, handler), or (wildcardHandler)",
      );
    }
  }

  /**
   * Remove a registered handler for a specific method on the default protocol.
   * @param method The method to remove the handler for.
   */
  removeHandler(method?: string): void;
  /**
   * Remove a registered handler for a specific version and method.
   */
  removeHandler(version: OCPPProtocol, method: string): void;
  removeHandler(versionOrMethod?: string, method?: string): void {
    if (versionOrMethod && method) {
      // removeHandler(version, method) — version-specific
      this._handlers.delete(`${versionOrMethod}:${method}`);
    } else if (versionOrMethod) {
      // removeHandler(method)
      this._handlers.delete(versionOrMethod);
    } else {
      // removeHandler() — remove wildcard
      this._wildcardHandler = null;
    }
  }

  /**
   * Check whether a handler is registered for a method
   * (optionally version-scoped, matching the handle() overloads).
   */
  hasHandler(method: string, version?: string): boolean {
    return version
      ? this._handlers.has(`${version}:${method}`)
      : this._handlers.has(method);
  }

  /**
   * Remove all registered handlers for this client, including the wildcard handler.
   */
  removeAllHandlers(): void {
    this._handlers.clear();
    this._wildcardHandler = null;
  }

  // ─── Middleware ──────────────────────────────────────────────

  /**
   * Register a middleware function, run for every phase of every message.
   * Middleware executes in the order registered.
   *
   * Middleware is the only place a payload can be **changed** — plugin hooks
   * such as `onBeforeSend` and `onBeforeReceive` observe and may veto, but
   * cannot rewrite. Reach for a plugin hook to allow or block a message, and
   * for middleware to transform one.
   *
   * See {@link MiddlewareContext} for the phases, how a server exchange nests,
   * and what happens when a middleware throws.
   */
  use(middleware: MiddlewareFunction<MiddlewareContext>): void {
    this._middleware.use(middleware);
  }

  // ─── Call ────────────────────────────────────────────────────

  /**
   * Call a version-specific typed method — `call("ocpp1.6", "BootNotification", {...})`.
   * Provides full type inference for params and response based on the OCPP version.
   */
  async call<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    version: V,
    method: M,
    params: OCPPRequestType<V, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M>>;

  /**
   * Call a custom/extension protocol/method not in the typed OCPP method maps.
   * `call("my-protocol", "my-method", params)`
   *
   * Note: This overload matches only if the protocol is NOT a known strict protocol of standard OCPP versions.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call<S extends string, TResult = any>(
    version: S extends OCPPProtocol ? never : S,
    method: string,
    params: Record<string, any>,
    options?: CallOptions,
  ): Promise<TResult>;

  /** Call a known typed method using the client's default protocol. */
  async call<M extends AllMethodNames<P>>(
    method: M,
    params: OCPPRequestType<P, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<P, M>>;

  /** Call a known typed method with explicit response type. */
  async call<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<TResult>;

  async call(...args: unknown[]): Promise<unknown> {
    let method: string;
    let params: unknown;
    let options: CallOptions;

    if (
      args.length >= 3 &&
      typeof args[0] === "string" &&
      typeof args[1] === "string"
    ) {
      // call(version, method, params, options?) — version-specific
      // version is type-level only, not sent on the wire
      method = args[1] as string;
      params = args[2] ?? {};
      options = (args[3] as CallOptions) ?? {};
    } else {
      // call(method, params?, options?)
      method = args[0] as string;
      params = args[1] ?? {};
      options = (args[2] as CallOptions) ?? {};
    }

    if (this._state !== OPEN) {
      // ── Offline Queue ──
      if (
        this._options.offlineQueue &&
        (this._state === CLOSED || this._state === CONNECTING)
      ) {
        return new Promise((resolve, reject) => {
          const maxSize = this._options.offlineQueueMaxSize ?? 100;
          if (this._offlineQueue.length >= maxSize) {
            const dropped = this._offlineQueue.shift(); // Drop oldest
            dropped?.reject(
              new Error("Offline queue overflow — oldest queued call dropped"),
            );
            this._logger?.warn?.(
              "Offline queue full — dropping oldest message",
              {
                method,
                queueSize: this._offlineQueue.length,
              },
            );
          }
          this._offlineQueue.push({
            method,
            params,
            options,
            resolve,
            reject,
          });
          this._logger?.debug?.("Call queued offline", {
            method,
            queueSize: this._offlineQueue.length,
          });
        });
      }
      throw new Error(`Cannot call: client is in state ${this._state}`);
    }

    // ── Retry wrapper with Full Jitter ──
    const maxRetries = options.retries ?? 0;
    if (maxRetries > 0) {
      return this._callWithRetry(method, params, options, maxRetries);
    }

    return this._callQueue.push(() => this._sendCall(method, params, options));
  }

  /**
   * Execute a call immediately, bypassing the callConcurrency queue.
   * Used by OCPPServer.sendBatch to pipeline warm-up calls without
   * mutating the client's configured concurrency (report M9).
   */
  callImmediate<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<TResult> {
    if (this._state !== OPEN) {
      return Promise.reject(
        new Error(`Cannot call: client is in state ${this._state}`),
      );
    }
    return this._sendCall(
      method,
      params ?? {},
      options ?? {},
    ) as Promise<TResult>;
  }

  // ─── Send (OCPP 2.1 unconfirmed messages) ───────────────────

  /**
   * Send an OCPP 2.1 unconfirmed message (RPC type SEND), such as
   * `send("NotifyPeriodicEventStream", {...})`. Nothing is answered, so this
   * resolves once the frame is written. It does not wait behind an outstanding
   * CALL (Part 4 §4.2.4) and throws on any protocol other than OCPP 2.1.
   */
  async send<M extends SendMethodNames<P>>(
    method: M,
    params: OCPPSendRequestType<P, M>,
  ): Promise<void>;

  /** Send a SEND message that is not in the typed maps. */
  async send(method: string, params?: object): Promise<void>;

  async send(
    method: string,
    params: OCPPSendRequestType<P, SendMethodNames<P>> | object = {},
  ): Promise<void> {
    if (this._protocol !== "ocpp2.1") {
      throw new Error(
        `SEND messages exist only in OCPP 2.1; this connection uses ${this._protocol ?? "no subprotocol"}`,
      );
    }
    if (this._state !== OPEN || !this._ws) {
      throw new Error(`Cannot send: client is in state ${this._state}`);
    }

    const messageId = createId();
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
      if (this._options.strictMode && this._protocol) {
        this._validateOutbound(ctxvals.method, ctxvals.params, "send");
      }

      const frame: OCPPSend = [
        MessageType.SEND,
        messageId,
        ctxvals.method,
        ctxvals.params,
      ];
      const allowSend = this._invokeBeforeSend(frame);
      const allowed =
        allowSend instanceof Promise ? await allowSend : allowSend;
      if (allowed === false) return;

      await new Promise<void>((resolve, reject) => {
        this._safeSend(this._ws, JSON.stringify(frame), (err) =>
          err ? reject(err) : resolve(),
        );
      });
      this._emitMessageEvent(frame, "OUT", ctxvals);
    });
  }

  // ─── Safe Call (Best Effort) ─────────────────────────────────

  /**
   * Version-specific safe call. Returns `undefined` on error instead of throwing.
   */
  async safeCall<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    version: V,
    method: M,
    params: OCPPRequestType<V, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M> | undefined>;

  /**
   * Custom/Extension safe call.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async safeCall<S extends string, TResult = any>(
    version: S extends OCPPProtocol ? never : S,
    method: string,
    params: Record<string, any>,
    options?: CallOptions,
  ): Promise<TResult | undefined>;

  /** Default protocol safe call. */
  async safeCall<M extends AllMethodNames<P>>(
    method: M,
    params: OCPPRequestType<P, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<P, M> | undefined>;

  /** Explicit result safe call. */
  async safeCall<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<TResult | undefined>;

  async safeCall(...args: any[]): Promise<any> {
    try {
      // @ts-expect-error - Spread arguments to the matching call overload
      return await this.call(...args);
    } catch (error) {
      if ((error as Error).name !== "TimeoutError") {
        // Resolve the method name the same way call() parses its overloads:
        // (version, method, params, options?) vs (method, params?, options?).
        const method =
          args.length >= 3 &&
          typeof args[0] === "string" &&
          typeof args[1] === "string"
            ? args[1]
            : args[0];
        const payload = {
          method,
          error,
        };
        if (this._logger?.warn) {
          this._logger.warn("SafeCall failed", payload);
        } else {
          console.warn("SafeCall failed", payload);
        }
      }
      return undefined;
    }
  }

  private async _sendCall(
    method: string,
    params: unknown,
    options: CallOptions,
  ): Promise<unknown> {
    const msgId = options.idempotencyKey ?? createId();
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
      // Cast ctx back to access specific fields safely if needed,
      // but strictly we should use 'c' which is TContext.
      // Since TContext is a union, we know it is outgoing_call here.
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "outgoing_call" }
      >;

      // Strict mode: validate outbound call
      if (this._options.strictMode && this._protocol) {
        this._validateOutbound(ctxvals.method, ctxvals.params, "req");
      }

      const message: OCPPCall = [
        MessageType.CALL,
        msgId,
        ctxvals.method,
        ctxvals.params,
      ];

      const allowSend = this._invokeBeforeSend(message);
      if (allowSend instanceof Promise) {
        if ((await allowSend) === false) return;
      } else if (allowSend === false) {
        return;
      }

      const messageStr = JSON.stringify(message);

      callResult = await new Promise<unknown>((resolve, reject) => {
        let removeAbortListener: (() => void) | undefined;

        const timeoutHandle = setTimeout(() => {
          removeAbortListener?.();
          this._pendingCalls.delete(msgId);
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
          this._pendingCalls.delete(msgId);
          reject(options.signal.reason ?? new Error("Aborted"));
          return;
        }

        const abortHandler = () => {
          clearTimeout(timeoutHandle);
          this._pendingCalls.delete(msgId);
          reject(options.signal?.reason ?? new Error("Aborted"));
        };

        if (options.signal) {
          options.signal.addEventListener("abort", abortHandler, {
            once: true,
          });
          removeAbortListener = () =>
            options.signal?.removeEventListener("abort", abortHandler);
        }

        this._pendingCalls.set(msgId, {
          resolve,
          reject,
          timeoutHandle,
          removeAbortListener,
          method: ctxvals.method,
          sentAt: Date.now(),
        });

        if (this._ws?.readyState === WebSocket.OPEN) {
          this._safeSend(this._ws, messageStr, (err) => {
            if (err) {
              // Failed to send
              clearTimeout(timeoutHandle);
              removeAbortListener?.();
              this._pendingCalls.delete(msgId);
              reject(err);
            } else {
              // Emit outbound CALL message event for observability
              this._emitMessageEvent(message, "OUT", {
                type: "outgoing_call",
                messageId: msgId,
                method: ctxvals.method,
                params: ctxvals.params,
                options: options,
              });
            }
          });
        } else if (this._state === CONNECTING) {
          // Buffer it
          this._logger?.debug?.("Buffering call", {
            method: ctxvals.method,
          });
          this._bufferOutbound(messageStr);
          // The promise remains pending until connected & flushed -> then response comes
        } else {
          clearTimeout(timeoutHandle);
          removeAbortListener?.();
          this._pendingCalls.delete(msgId);
          reject(new Error(`WebSocket is not open (state: ${this._state})`));
        }
      });

      return callResult;
    });

    return callResult;
  }

  /** Buffer a frame for flush on open, dropping the oldest past the cap. */
  private _bufferOutbound(message: string): void {
    if (this._outboundBuffer.length >= OCPPClient._OUTBOUND_BUFFER_MAX) {
      this._outboundBuffer.shift();
      this._logger?.warn?.("Outbound buffer full — dropped oldest frame", {
        identity: this._identity,
        max: OCPPClient._OUTBOUND_BUFFER_MAX,
      });
    }
    this._outboundBuffer.push(message);
  }

  /**
   * Send a raw string message over the WebSocket (use with caution).
   * Messages sent while CONNECTING are buffered and flushed on open.
   */
  sendRaw(message: string): void {
    if (this._state === OPEN && this._ws) {
      this._safeSend(this._ws, message);
    } else if (this._state === CONNECTING) {
      this._bufferOutbound(message);
    } else {
      throw new Error("Cannot send: client is not connected");
    }
  }

  // ─── Reconfigure ─────────────────────────────────────────────

  reconfigure(options: Partial<ClientOptions>): void {
    Object.assign(this._options, options);

    if (options.callConcurrency !== undefined) {
      this._callQueue.setConcurrency(options.callConcurrency);
    }

    if (
      options.strictMode !== undefined ||
      options.strictModeValidators !== undefined
    ) {
      this._setupValidators();
    }

    if (options.pingIntervalMs !== undefined) {
      this._stopPing();
      if (this._state === OPEN) {
        this._startPing();
      }
    }
  }

  // ─── Internal: WebSocket attachment ──────────────────────────

  /** Wake everything parked in the startup handler grace window. */
  private _releaseHandlerWaiters(): void {
    if (this._handlerWaiters.size === 0) return;
    const waiters = [...this._handlerWaiters];
    this._handlerWaiters.clear();
    for (const w of waiters) w();
  }

  /**
   * Park an inbound CALL that has no handler yet, for the remainder of the
   * startup grace window. Resolves as soon as any handler is registered, or
   * when the window closes — the caller re-checks either way.
   */
  private async _awaitHandlerGrace(): Promise<void> {
    const graceMs = (this._options as ClientOptions).handlerGraceMs ?? 1000;
    if (graceMs <= 0 || this._openedAt === 0) return;

    const remaining = graceMs - (Date.now() - this._openedAt);
    if (remaining <= 0) return;
    if (this._handlerWaiters.size >= OCPPClient._MAX_HANDLER_WAITERS) return;

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this._handlerWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, remaining);
      timer.unref?.();
      this._handlerWaiters.add(finish);
    });
  }

  protected _attachWebsocket(ws: WebSocket): void {
    ws.on("message", (data: WebSocket.RawData) => this._onMessage(data));
    ws.on("close", (code: number, reason: Buffer) =>
      this._onClose(code, reason),
    );
    ws.on("error", (err: Error) => {
      // Node throws when 'error' is emitted with no listener attached. The
      // connect-phase handlers already guard this; the post-open handler did
      // not, so any socket error after the connection opened crashed a process
      // that had not registered an error listener.
      if (this.listenerCount("error") > 0) {
        this.emit("error", err);
      } else {
        this._logger?.error?.("Socket error (no error listener attached)", {
          identity: this._identity,
          error: err.message,
        });
      }
    });
    ws.on("ping", () => {
      this._recordActivity();
      this.emit("ping");
    });
    ws.on("pong", () => {
      // Clear pong timeout — connection is alive
      if (this._pongTimer) {
        clearTimeout(this._pongTimer);
        this._pongTimer = null;
      }
      this._recordActivity();
      this.emit("pong");
    });
  }

  // ─── Internal: Message event helpers ────────────────────────

  /**
   * Build an enriched message event context from middleware context.
   * Adds timestamp and optional latency metadata.
   */
  private _buildMessageEventContext(
    ctx: MiddlewareContext,
    latencyMs?: number,
  ): MessageEventContext {
    const eventCtx: MessageEventContext = {
      ...ctx,
      timestamp: new Date().toISOString(),
      latencyMs,
    };
    return eventCtx;
  }

  /**
   * Emit a message event with enriched payload (direction + context).
   * Replaces separate call/callResult/callError events for unified observability.
   */
  private _emitMessageEvent(
    message: OCPPMessage,
    direction: MessageDirection,
    ctx: MiddlewareContext,
    latencyMs?: number,
  ): void {
    const eventCtx = this._buildMessageEventContext(ctx, latencyMs);
    const payload: MessageEventPayload = {
      message,
      direction,
      ctx: eventCtx,
    };
    this.emit("message", payload);
  }

  // ─── Internal: Message handling ──────────────────────────────

  protected _onMessage(rawData: WebSocket.RawData, preParsed?: unknown): void {
    this._recordActivity();

    // Some charge points send empty frames. They carry nothing to answer, and
    // counting them as bad messages would disconnect an otherwise working
    // charger.
    if (preParsed === undefined && isEmptyFrame(rawData)) return;

    const rawText = () =>
      typeof rawData === "string" ? rawData : (rawData as Buffer).toString();

    // Until the message ID has been read, a bad frame is answered under ID
    // "-1" (2.0.1 / 2.1 §4.2.3: "When also the MessageId cannot be read").
    let message: OCPPMessage;
    try {
      message =
        preParsed !== undefined
          ? // Worker pool already parsed — skip JSON.parse entirely
            (preParsed as OCPPMessage)
          : // JSON.parse accepts a Buffer directly (implicit utf8 toString).
            (JSON.parse(rawData as unknown as string) as OCPPMessage);
    } catch {
      this._onBadMessage(
        rawText(),
        createRPCError("RpcFrameworkError", "Message must be a JSON structure"),
        UNREADABLE_ID_REPLY,
      );
      return;
    }
    if (!Array.isArray(message)) {
      this._onBadMessage(
        rawText(),
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
        rawText(),
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
        rawText(),
        new RPCMessageTypeNotSupportedError(
          `Unknown message type: ${messageType}`,
        ),
        UNREADABLE_ID_REPLY,
      );
      return;
    }

    if (typeof messageId !== "string") {
      this._onBadMessage(
        rawText(),
        createRPCError("RpcFrameworkError", "Message ID must be a string"),
        UNREADABLE_ID_REPLY,
      );
      return;
    }

    if (message.length < MIN_FRAME_LENGTH[messageType]) {
      this._onBadMessage(
        JSON.stringify(message),
        new RPCFormatViolationError(
          `Missing payload elements for message type ${messageType}`,
        ),
        this._replyTo(messageType, messageId),
      );
      return;
    }

    // Payload MUST be a JSON object (not array or primitive)
    const payloadIndex = PAYLOAD_INDEX[messageType];
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
    const payload = message[payloadIndex];
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      this._onBadMessage(
        JSON.stringify(message),
        new RPCFormatViolationError(
          `Payload must be a JSON object, got ${
            payload === null
              ? "null"
              : Array.isArray(payload)
                ? "array"
                : typeof payload
          }`,
        ),
        this._replyTo(messageType, messageId),
      );
      return;
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
        // Async with no await: an error escaping it (a throwing middleware or
        // response listener) became an unhandled rejection and took the
        // process down. The message is already dispatched, so log and carry on.
        this._handleCallResult(message as OCPPCallResult).catch((err) => {
          this._logger?.error?.("Error handling CALLRESULT", {
            identity: this._identity,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        break;
      case MessageType.CALLERROR:
        this._handleCallError(message as OCPPCallError).catch((err) => {
          this._logger?.error?.("Error handling CALLERROR", {
            identity: this._identity,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        break;
    }
  }

  /** CALLRESULTERROR and SEND exist only in OCPP 2.1. */
  private _isKnownMessageType(type: number): boolean {
    if (
      type === MessageType.CALL ||
      type === MessageType.CALLRESULT ||
      type === MessageType.CALLERROR
    ) {
      return true;
    }
    return (
      this._protocol === "ocpp2.1" &&
      (type === MessageType.CALLRESULTERROR || type === MessageType.SEND)
    );
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
   * ever sent back, neither a result nor an error (Part 4 §4.2.4, Part 2
   * FR.07). Failures are logged and surfaced as events only.
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
        const observed: OCPPSend = [
          MessageType.SEND,
          ctxvals.messageId,
          ctxvals.method,
          ctxvals.params,
        ];
        this._emitMessageEvent(observed, "IN", ctxvals);

        if (this._state !== OPEN) return;

        let handler = this._findHandler(ctxvals.method);
        if (!handler && !this._wildcardHandler) {
          await this._awaitHandlerGrace();
          handler = this._findHandler(ctxvals.method);
        }
        if (!handler && !this._wildcardHandler) {
          this._logger?.debug?.("No handler for SEND message", {
            method: ctxvals.method,
          });
          return;
        }

        if (this._options.strictMode && this._protocol) {
          try {
            this._validateInbound(ctxvals.method, ctxvals.params, "send");
          } catch {
            // strictValidationFailure was emitted; there is nobody to tell.
            return;
          }
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
            await this._wildcardHandler?.(ctxvals.method, context);
          }
        } catch (err) {
          this._logger?.warn?.("Handler failed for SEND message", {
            method: ctxvals.method,
            error: (err as Error)?.message ?? String(err),
          });
          this.emit("handlerError", {
            method: ctxvals.method,
            error: err as Error,
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

    try {
      await this._middleware.execute(ctx, async (c) => {
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

        // Emit enriched message event (replaces old "call" event)
        this._emitMessageEvent(modifiedMessage, "IN", ctxvals);
        // Keep backward-compatible "call" event
        this.emit("call", modifiedMessage);

        if (this._state !== OPEN) {
          return;
        }

        try {
          if (this._pendingResponses.has(ctxvals.messageId)) {
            // 1.6J Table 7 has no RpcFrameworkError; GenericError covers
            // "any other error not covered by the previous ones".
            throw createRPCError(
              this._protocol === "ocpp1.6"
                ? "GenericError"
                : "RpcFrameworkError",
              `Already processing call with ID: ${ctxvals.messageId}`,
            );
          }

          let specificHandler = this._findHandler(ctxvals.method);

          // Startup grace. The socket dispatches as soon as it opens, so a CALL
          // can arrive before the application has finished registering its
          // handlers — and rejecting it would tell the peer this charger does
          // not support an action it does support. Wait briefly instead; see
          // ClientOptions.handlerGraceMs.
          if (!specificHandler && !this._wildcardHandler) {
            await this._awaitHandlerGrace();
            specificHandler = this._findHandler(ctxvals.method);
          }

          if (!specificHandler && !this._wildcardHandler) {
            throw new RPCNotImplementedError(
              `Method "${ctxvals.method}" not implemented`,
            );
          }

          if (this._options.strictMode && this._protocol) {
            this._validateInbound(ctxvals.method, ctxvals.params, "req");
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
            result = await this._wildcardHandler(ctxvals.method, context);
          }

          this._pendingResponses.delete(ctxvals.messageId);

          if (result === NOREPLY) return;

          if (this._options.strictMode && this._protocol) {
            this._validateOutbound(ctxvals.method, result, "conf");
          }

          // Run the response through the middleware chain before sending it.
          //
          // `outgoing_result` was declared as a context type and consumed by
          // schemaVersioningPlugin — which transforms a response *down* for an
          // older charge point — but the chain never executed for it, so that
          // branch could not run.
          //
          // `onBeforeSend` sees this response too, but a CALLRESULT is
          // `[3, messageId, payload]` and carries no action name, so a plugin
          // there cannot tell which request it answers without correlating
          // against pending state. Carrying `method` is why this context type
          // exists.
          //
          // Validation above deliberately stays ahead of this: a handler's
          // result is checked against the current schema, and only then adapted
          // for whatever the peer speaks.
          let payload = result;
          try {
            const outCtx: MiddlewareContext = {
              type: "outgoing_result",
              messageId: ctxvals.messageId,
              method: ctxvals.method,
              payload: result,
            };
            await this._middleware.execute(outCtx, async (c) => {
              payload = (
                c as Extract<MiddlewareContext, { type: "outgoing_result" }>
              ).payload;
            });
          } catch (err) {
            // Fail open with what the handler produced. A middleware that
            // throws must not cost the charge point its response — it would
            // sit waiting for a CALLRESULT that never arrives.
            this._logger?.error?.("Middleware failed on outgoing result", {
              method: ctxvals.method,
              error: (err as Error)?.message ?? String(err),
            });
          }

          const response: OCPPCallResult = [
            MessageType.CALLRESULT,
            ctxvals.messageId,
            payload,
          ];

          const allowSend = this._invokeBeforeSend(response);
          if (allowSend instanceof Promise) {
            if ((await allowSend) === false) return result;
          } else if (allowSend === false) {
            return result;
          }

          this._safeSend(this._ws, JSON.stringify(response));
          // Emit outbound CALLRESULT message event for observability
          this._emitMessageEvent(response, "OUT", {
            type: "outgoing_result",
            messageId: ctxvals.messageId,
            method: ctxvals.method,
            // What was sent, not what the handler returned — they differ once
            // a middleware has transformed the response.
            payload,
          });
          this.emit("callResult", response);

          return result;
        } catch (err) {
          this._pendingResponses.delete(ctxvals.messageId);

          const rpcErr =
            err instanceof RPCGenericError || (err as RPCError).rpcErrorCode
              ? (err as RPCError)
              : createRPCError("InternalError", (err as Error).message);

          // Never ship stack traces to remote peers (report M13)
          const details = this._options.respondWithDetailedErrors
            ? getErrorPlainObject(err as Error, false)
            : {};

          // Same treatment as the CALLRESULT path above: a CALLERROR on the
          // wire carries no action name either, so this context is the only
          // place a plugin can make an action-specific decision about one.
          // The declared context exposes the code and description; `details`
          // is not part of it and is sent as produced.
          let errorCode = rpcErr.rpcErrorCode;
          let errorDescription =
            rpcErr.rpcErrorMessage || (err as Error).message || "";
          try {
            const outCtx: MiddlewareContext = {
              type: "outgoing_error",
              messageId: ctxvals.messageId,
              method: ctxvals.method,
              errorCode,
              errorDescription,
            };
            await this._middleware.execute(outCtx, async (c) => {
              const out = c as Extract<
                MiddlewareContext,
                { type: "outgoing_error" }
              >;
              errorCode = out.errorCode;
              errorDescription = out.errorDescription;
            });
          } catch (mwErr) {
            // Fail open. A middleware that throws while an error is being
            // reported must not swallow the error report itself.
            this._logger?.error?.("Middleware failed on outgoing error", {
              method: ctxvals.method,
              error: (mwErr as Error)?.message ?? String(mwErr),
            });
          }
          errorDescription = this._fitErrorDescription(errorDescription);

          const errorResponse: OCPPCallError = [
            MessageType.CALLERROR,
            ctxvals.messageId,
            errorCode,
            errorDescription,
            details,
          ];

          const allowSend = this._invokeBeforeSend(errorResponse);
          if (allowSend instanceof Promise) {
            if ((await allowSend) === false) throw err;
          } else if (allowSend === false) {
            throw err;
          }

          this._safeSend(this._ws, JSON.stringify(errorResponse));
          // Emit outbound CALLERROR message event for observability
          this._emitMessageEvent(errorResponse, "OUT", {
            type: "outgoing_error",
            messageId: ctxvals.messageId,
            method: ctxvals.method,
            // What was sent, not what was thrown — they differ once a
            // middleware has rewritten the code or description.
            errorCode,
            errorDescription,
          });
          this.emit("callError", errorResponse);
          // Emit handler error event for plugin observability
          this.emit("handlerError", {
            method: ctxvals.method,
            error: err as Error,
          });

          throw err;
        }
      });
    } catch {
      // Ignored: The error was already sent as a CALLERROR to the peer,
      // and logged explicitly by the createLoggingMiddleware.
      // We swallow it here to prevent an UnhandledPromiseRejection
      // since _handleIncomingCall is executed synchronously by _onMessage.
    }
  }

  private async _handleCallResult(message: OCPPCallResult): Promise<void> {
    const [, msgId, payload] = message;

    if (!this._pendingCalls.has(msgId)) {
      this._logger?.warn?.("Received CallResult for unknown messageId", {
        messageId: msgId,
      });
      return;
    }

    const pending = this._pendingCalls.get(msgId)!;

    const ctx: MiddlewareContext = {
      type: "incoming_result",
      messageId: msgId,
      payload,
      method: pending.method,
    };

    await this._middleware.execute(ctx, async (c) => {
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "incoming_result" }
      >;
      const pendingCtx = this._pendingCalls.get(ctxvals.messageId);
      if (!pendingCtx) return;

      // Handled by createLoggingMiddleware
      const latencyMs = Date.now() - pendingCtx.sentAt;

      // Rebuild from the post-middleware context, the way the inbound CALL
      // path does. Emitting the raw frame handed observers the payload as it
      // arrived, so a middleware that rewrote it — piiRedactorPlugin returns a
      // redacted clone rather than mutating in place — was bypassed, and
      // unredacted payloads reached broker plugins running includePayload.
      const observedResult: OCPPCallResult = [
        MessageType.CALLRESULT,
        ctxvals.messageId,
        ctxvals.payload,
      ];

      // Emit enriched message event (replaces old "callResult" event)
      this._emitMessageEvent(observedResult, "IN", ctxvals, latencyMs);
      // Keep backward-compatible "callResult" event
      this.emit("callResult", observedResult);

      // Strict mode: validate the inbound response payload against the
      // method's .conf schema (report M6).
      if (this._options.strictMode && this._protocol) {
        try {
          this._validateInbound(pendingCtx.method, ctxvals.payload, "conf");
        } catch (err) {
          clearTimeout(pendingCtx.timeoutHandle);
          pendingCtx.removeAbortListener?.();
          this._pendingCalls.delete(ctxvals.messageId);
          pendingCtx.reject(err);
          // 2.1 Part 2 FR.06: a response that fails the schema is answered
          // with CALLRESULTERROR so the sender learns it was not processed.
          if (this._protocol === "ocpp2.1") {
            this._sendRpcError([
              MessageType.CALLRESULTERROR,
              ctxvals.messageId,
              (err as RPCError).rpcErrorCode ?? "FormatViolation",
              (err as Error).message ?? "",
              {},
            ]);
          }
          return;
        }
      }

      clearTimeout(pendingCtx.timeoutHandle);
      pendingCtx.removeAbortListener?.();
      this._pendingCalls.delete(ctxvals.messageId);
      pendingCtx.resolve(ctxvals.payload);
    });
  }

  private async _handleCallError(message: OCPPCallError): Promise<void> {
    const [, msgId] = message;

    const pending = this._pendingCalls.get(msgId);
    if (!pending) {
      this._logger?.warn?.("Received CallError for unknown messageId", {
        messageId: msgId,
      });
      return;
    }

    const ctx: MiddlewareContext = {
      type: "incoming_error",
      messageId: msgId,
      error: message,
      method: pending.method,
    };

    await this._middleware.execute(ctx, async (c) => {
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "incoming_error" }
      >;
      const pendingCtx = this._pendingCalls.get(ctxvals.messageId);
      if (!pendingCtx) return;

      const latencyMs = Date.now() - pendingCtx.sentAt;

      // Same rebuild as the CALLRESULT path above: observers must see what
      // middleware produced, not what arrived on the wire.
      const observedError = ctxvals.error as OCPPCallError;

      // Emit enriched message event (replaces old "callError" event)
      this._emitMessageEvent(observedError, "IN", ctxvals, latencyMs);
      // Keep backward-compatible "callError" event
      this.emit("callError", observedError);

      const [, , code, msg, details] = ctxvals.error;

      clearTimeout(pendingCtx.timeoutHandle);
      pendingCtx.removeAbortListener?.();
      this._pendingCalls.delete(ctxvals.messageId);

      const err = createRPCError(code, msg, details);
      pendingCtx.reject(err);
    });
  }

  // ─── Internal: Bad message handling ──────────────────────────

  /**
   * maxBadMessages counts bad messages in a row, so a valid frame ends the run.
   * Counting over the whole connection slowly disconnected working chargers
   * that send an occasional odd frame.
   */
  private _resetBadMessageCount(): void {
    this._badMessageCount = 0;
    this._badMessageWindowStart = 0;
  }

  /**
   * A malformed CALL gets a CALLERROR (Part 4 §4.2.3, "the call is received"),
   * and on OCPP 2.1 a malformed CALLRESULT gets a CALLRESULTERROR (2.1 Part 2
   * FR.06). Nothing else is answered — a CALLERROR in particular, since two
   * peers replying to each other's errors would loop.
   */
  private _replyTo(
    messageType: number,
    messageId: string,
  ): BadMessageReply | undefined {
    if (messageType === MessageType.CALL) {
      return { frame: MessageType.CALLERROR, messageId };
    }
    if (
      messageType === MessageType.CALLRESULT &&
      this._protocol === "ocpp2.1"
    ) {
      return { frame: MessageType.CALLRESULTERROR, messageId };
    }
    return undefined;
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

    // The caller decides whether and how the frame is answered, so the sender
    // of a malformed request is not left waiting out its timeout.
    if (reply && this._ws) {
      // Report the error that actually occurred. This previously sent the
      // format-violation code whatever had gone wrong, so an unsupported
      // message type was reported to the peer as a malformed payload.
      const rpcCode = (error as { rpcErrorCode?: string }).rpcErrorCode;
      // OCPP 1.6J spells this error "FormationViolation" (report M7)
      const formatCode =
        this._protocol === "ocpp1.6" ? "FormationViolation" : "FormatViolation";
      // A format violation is spelled differently per version, so it is
      // resolved here rather than taken from the error as-is.
      const code =
        !rpcCode || rpcCode === "GenericError" || rpcCode === "FormatViolation"
          ? formatCode
          : rpcCode;
      const description = error.message || "Invalid message format";
      this._sendRpcError([reply.frame, reply.messageId, code, description, {}]);
    }

    if (this._badMessageCount >= this._options.maxBadMessages) {
      this.close({ code: 1002, reason: "Too many bad messages" }).catch(
        () => {},
      );
    }
  }

  /** Send a CALLERROR or CALLRESULTERROR, honouring an onBeforeSend veto. */
  private _sendRpcError(frame: OCPPCallError | OCPPCallResultError): void {
    frame[3] = this._fitErrorDescription(frame[3]);
    const send = () => {
      this._safeSend(this._ws, JSON.stringify(frame));
      if (frame[0] === MessageType.CALLERROR) this.emit("callError", frame);
    };
    const allowSend = this._invokeBeforeSend(frame);
    if (allowSend instanceof Promise) {
      allowSend
        .then((allowed) => {
          if (allowed !== false) send();
        })
        .catch(() => {});
    } else if (allowSend !== false) {
      send();
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
  }

  protected _onClose(code: number, reason: Buffer): void {
    this._stopPing();
    // A pending pong timer must not fire a spurious pongTimeout for a
    // connection that already closed (review fix).
    if (this._pongTimer) {
      clearTimeout(this._pongTimer);
      this._pongTimer = null;
    }
    const reasonStr = reason.toString();
    this._rejectPendingCalls(`Connection closed (${code}: ${reasonStr})`);

    if (this._state !== CLOSING) {
      // Unexpected close — emit disconnect (transient, reconnect may follow)
      this._logger?.info?.("Disconnected", { code, reason: reasonStr });
      this.emit("disconnect", { code, reason: reasonStr });

      if (
        this._options.reconnect &&
        this._reconnectAttempt < this._options.maxReconnects
      ) {
        this._scheduleReconnect();
      } else {
        // No reconnect — this is a permanent close
        this._state = CLOSED;
        // Nothing will ever flush the offline queue now, so settle it rather
        // than leaving those callers pending forever.
        this._drainOfflineQueue(
          `Connection closed permanently (${code}: ${reasonStr})`,
        );
        this._outboundBuffer.length = 0;
        this.emit("close", { code, reason: reasonStr });
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
    // close() may have landed between the socket dropping and this call.
    if (this._closeRequested) return;
    this._reconnectAttempt++;
    this._state = CONNECTING;

    // Exponential backoff with jitter (OCPP 2.0.1 §J.1)
    // Floor the base delay. `backoffMin: 0` collapsed the exponential term to
    // zero, so a client that could not reach the CSMS reconnected in a tight
    // loop, saturating a CPU and hammering the server it was waiting on.
    const base = Math.max(50, this._options.backoffMin);
    const max = Math.max(base, this._options.backoffMax);
    const delayMs = Math.min(
      max,
      base * 2 ** (this._reconnectAttempt - 1) * (0.5 + Math.random() * 0.5),
    );

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
      // close() clears a *pending* timer, but once this callback has fired
      // there is nothing left to clear — so the attempt has to check for
      // itself, both before connecting and after, or a closed client comes
      // back to life and sits in CONNECTING forever.
      if (this._closeRequested) {
        this._state = CLOSED;
        return;
      }
      try {
        await this._connectInternal();
        if (this._closeRequested) {
          // The caller closed us while this attempt was in flight. Tear the
          // socket we just opened straight back down.
          this._logger?.debug?.(
            "Closed during reconnect — dropping new socket",
          );
          this._ws?.terminate();
          this._state = CLOSED;
        }
      } catch (err) {
        if (this._closeRequested) {
          this._state = CLOSED;
          return;
        }
        // Intolerable errors — do not retry
        const msg = err instanceof Error ? err.message : "";
        if (OCPPClient._INTOLERABLE_ERRORS.has(msg)) {
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

  // ─── Internal: Offline Queue ──────────────────────────────────

  /**
   * Atomically drains the offline queue and sends each message via _sendCall.
   * Uses splice(0) to prevent re-entry bugs (double billing) if the connection
   * drops again mid-flush — the queue is empty before any sends begin.
   */
  private _flushOfflineQueue(): void {
    if (this._offlineQueue.length === 0) return;

    // Atomic snapshot — clears queue before sending to prevent re-entry
    const snapshot = this._offlineQueue.splice(0, this._offlineQueue.length);
    this._logger?.info?.("Flushing offline queue", {
      count: snapshot.length,
    });

    for (const entry of snapshot) {
      this._callQueue
        .push(() => this._sendCall(entry.method, entry.params, entry.options))
        .then(entry.resolve)
        .catch(entry.reject);
    }
  }

  // ─── Internal: Call Retry with Full Jitter ───────────────────

  /**
   * Retry wrapper using Full Jitter exponential backoff.
   * delay = random(0, min(retryMaxDelayMs, retryDelayMs * 2^attempt))
   * Only retries on TimeoutError — all other errors propagate immediately.
   */
  private async _callWithRetry(
    method: string,
    params: unknown,
    options: CallOptions,
    maxRetries: number,
  ): Promise<unknown> {
    const baseDelay = options.retryDelayMs ?? 1000;
    const maxDelay = options.retryMaxDelayMs ?? 30000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._callQueue.push(() =>
          this._sendCall(method, params, options),
        );
      } catch (err) {
        if (attempt === maxRetries || !(err instanceof TimeoutError)) {
          throw err;
        }
        // Full Jitter: random(0, min(maxDelay, baseDelay * 2^attempt))
        const expDelay = Math.min(maxDelay, baseDelay * 2 ** attempt);
        const jitteredDelay = Math.random() * expDelay;
        this._logger?.warn?.("Call retry", {
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

  // ─── Internal: Backpressure-Aware Send ───────────────────────

  /** Maximum bytes allowed in the ws send buffer before applying backpressure (512KB) */
  private static readonly _BACKPRESSURE_THRESHOLD = 512 * 1024;

  /** Sends queued while the socket is backpressured (FIFO). */
  private _backpressureQueue: Array<{
    data: string;
    cb?: (err?: Error) => void;
    enqueuedAt: number;
  }> = [];
  private _backpressureTimer: ReturnType<typeof setInterval> | null = null;
  /** Frames held while the socket is over threshold, before dropping oldest. */
  private static readonly _BACKPRESSURE_MAX_QUEUE = 1000;
  /** How long a frame may wait for the peer to drain before it is failed. */
  private static readonly _BACKPRESSURE_MAX_WAIT_MS = 10_000;

  /**
   * Protected hook for plugins to intercept outbound messages before serialization.
   * Return `false` to suppress the message transmission.
   */
  protected _invokeBeforeSend(
    _message: OCPPMessage,
  ): boolean | Promise<boolean> {
    return true; // Implemented by OCPPServerClient
  }

  /**
   * Wraps ws.send() with backpressure protection. When bufferedAmount
   * exceeds the threshold, sends are queued and flushed FIFO by a single
   * shared 50ms drain timer (one per client, not one per send — report M10).
   * Entries older than 10s are sent regardless, preserving the previous
   * timeout semantics. Prevents OOM on slow 2G/3G charger connections.
   */
  private _safeSend(
    ws: WebSocket | null,
    data: string,
    cb?: (err?: Error) => void,
  ): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      cb?.(new Error("WebSocket is not open"));
      return;
    }

    if (
      ws.bufferedAmount > OCPPClient._BACKPRESSURE_THRESHOLD ||
      this._backpressureQueue.length > 0
    ) {
      if (this._backpressureQueue.length === 0) {
        this._logger?.warn?.("Backpressure — pausing send", {
          identity: this._identity,
          bufferedAmount: ws.bufferedAmount,
          threshold: OCPPClient._BACKPRESSURE_THRESHOLD,
        });
        // Emit identity + buffered amount for operator alerting
        this.emit("backpressure", {
          identity: this._identity,
          bufferedAmount: ws.bufferedAmount,
        });
      }
      // Bound the queue. Under sustained backpressure this array grew without
      // limit, holding every frame in memory for a peer that is not reading.
      if (
        this._backpressureQueue.length >= OCPPClient._BACKPRESSURE_MAX_QUEUE
      ) {
        const dropped = this._backpressureQueue.shift();
        dropped?.cb?.(
          new Error("Backpressure queue full — oldest frame dropped"),
        );
        this._logger?.warn?.("Backpressure queue full — dropping oldest", {
          identity: this._identity,
          max: OCPPClient._BACKPRESSURE_MAX_QUEUE,
        });
      }
      this._backpressureQueue.push({ data, cb, enqueuedAt: Date.now() });
      this._startBackpressureDrain(ws);
      return;
    }

    ws.send(data, cb);
  }

  private _startBackpressureDrain(ws: WebSocket): void {
    if (this._backpressureTimer) return;
    this._backpressureTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        this._stopBackpressureDrain();
        const failed = this._backpressureQueue.splice(0);
        for (const entry of failed) {
          entry.cb?.(new Error("WebSocket closed during backpressure wait"));
        }
        return;
      }
      const now = Date.now();
      while (this._backpressureQueue.length > 0) {
        const head = this._backpressureQueue[0];
        if (!head) break;

        if (now - head.enqueuedAt >= OCPPClient._BACKPRESSURE_MAX_WAIT_MS) {
          // Aged out. This used to send anyway, which flushed the whole
          // backlog into a socket that was already over the threshold — the
          // timeout defeated the backpressure it existed to apply. A frame the
          // peer has not been able to accept for ten seconds is stale for OCPP
          // purposes, so the caller is told instead.
          this._backpressureQueue.shift();
          head.cb?.(
            new Error("Backpressure timeout — peer did not drain in time"),
          );
          continue;
        }

        if (ws.bufferedAmount <= OCPPClient._BACKPRESSURE_THRESHOLD) {
          this._backpressureQueue.shift();
          ws.send(head.data, head.cb);
        } else {
          break;
        }
      }
      if (this._backpressureQueue.length === 0) {
        this._stopBackpressureDrain();
      }
    }, 50);
  }

  private _stopBackpressureDrain(): void {
    if (this._backpressureTimer) {
      clearInterval(this._backpressureTimer);
      this._backpressureTimer = null;
    }
  }

  // ─── Internal: Ping/Pong ─────────────────────────────────────

  protected _startPing(): void {
    if (this._options.pingIntervalMs <= 0) return;

    const pongTimeoutMs =
      (this._options as ClientOptions).pongTimeoutMs ??
      this._options.pingIntervalMs + 5000;

    const doPing = () => {
      if (this._state !== OPEN || !this._ws) return;

      if (this._options.deferPingsOnActivity) {
        const elapsed = Date.now() - this._lastActivity;
        if (elapsed < this._options.pingIntervalMs) {
          this._pingTimer = setTimeout(
            doPing,
            this._options.pingIntervalMs - elapsed,
          );
          return;
        }
      }

      this._ws.ping();

      // Start pong timeout — if no pong received, connection is dead
      // Only arm a pong deadline when none is outstanding. Overwriting the
      // handle orphaned the previous timer — it still fired, and terminated
      // whatever socket was current by then, including a healthy reconnect.
      // Keeping the first unanswered ping's deadline also preserves dead-peer
      // detection when pongTimeoutMs exceeds pingIntervalMs.
      if (pongTimeoutMs > 0 && !this._pongTimer) {
        this._pongTimer = setTimeout(() => {
          this._pongTimer = null;
          this._logger?.warn?.("Pong timeout — terminating dead connection", {
            identity: this._identity,
            timeoutMs: pongTimeoutMs,
          });
          // Emit pongTimeout event for plugin observability
          this.emit("pongTimeout", { identity: this._identity });
          this._ws?.terminate();
        }, pongTimeoutMs);
      }

      // Add ±25% jitter to prevent thundering herds on mass reconnections
      const jitteredInterval =
        this._options.pingIntervalMs * (0.75 + Math.random() * 0.5);
      this._pingTimer = setTimeout(doPing, jitteredInterval);
    };

    // Add ±25% jitter to the very first ping as well
    const initialJitteredInterval =
      this._options.pingIntervalMs * (0.75 + Math.random() * 0.5);
    this._pingTimer = setTimeout(doPing, initialJitteredInterval);
  }

  private _stopPing(): void {
    if (this._pingTimer) {
      clearTimeout(this._pingTimer);
      this._pingTimer = null;
    }
  }

  protected _recordActivity(): void {
    this._lastActivity = Date.now();
  }

  // ─── Internal: Validation ────────────────────────────────────

  private _setupValidators(): void {
    // Custom validators are taken as given. Standard ones are left null and
    // resolved per protocol in _findValidator once the subprotocol is actually
    // negotiated, so a connection never builds validators for versions it does
    // not speak — and never misses one the peer chose.
    this._validators = this._options.strictModeValidators ?? null;

    if (Array.isArray(this._options.strictMode)) {
      this._strictProtocols = this._options.strictMode;
    } else {
      this._strictProtocols = null;
    }
  }

  private _validateOutbound(
    method: string,
    params: unknown,
    suffix: SchemaKind,
  ): void {
    const validator = this._findValidator();
    if (!validator) return;

    if (
      this._options.strictModeMethods &&
      !this._options.strictModeMethods.includes(method as any)
    ) {
      return; // Skip validation if method is not in the explicit strict list
    }

    const schemaId = schemaIdFor(method, suffix);
    try {
      validator.validate(schemaId, params);
    } catch (err) {
      this.emit("strictValidationFailure", {
        message: params,
        error: err as Error,
      });
      throw err;
    }
  }

  private _validateInbound(
    method: string,
    params: unknown,
    suffix: SchemaKind,
  ): void {
    const validator = this._findValidator();
    if (!validator) return;

    if (
      this._options.strictModeMethods &&
      !this._options.strictModeMethods.includes(method as any)
    ) {
      return; // Skip validation if method is not in the explicit strict list
    }

    const schemaId = schemaIdFor(method, suffix);
    try {
      validator.validate(schemaId, params);
    } catch (err) {
      this.emit("strictValidationFailure", {
        message: params,
        error: err as Error,
      });
      throw err;
    }
  }

  private _findValidator(): Validator | null {
    if (!this._protocol) return null;

    if (
      this._strictProtocols &&
      !this._strictProtocols.includes(this._protocol)
    ) {
      return null;
    }

    if (this._validators) {
      return (
        this._validators.find((v) => v.subprotocol === this._protocol) ?? null
      );
    }

    // Built on first use and cached process-wide, so this costs one lookup
    // per validated message after the first.
    return getStandardValidator(this._protocol);
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

  private _buildWsOptions(): WebSocket.ClientOptions {
    const opts: WebSocket.ClientOptions = {
      headers: {
        ...this._options.headers,
        "User-Agent": getPackageIdent(),
      },
    };

    // Bound the upgrade. `ws` aborts the handshake and emits an error when this
    // elapses, which is what turns a black-holed peer into a failed attempt the
    // reconnect logic can act on, instead of an indefinite CONNECTING.
    const connectTimeoutMs =
      (this._options as ClientOptions).connectTimeoutMs ?? 30_000;
    if (connectTimeoutMs > 0) {
      opts.handshakeTimeout = connectTimeoutMs;
    }

    const profile = this._options.securityProfile ?? SecurityProfile.NONE;

    // Profile 1 & 2: Basic Auth header
    if (
      (profile === SecurityProfile.BASIC_AUTH ||
        profile === SecurityProfile.TLS_BASIC_AUTH) &&
      this._options.password
    ) {
      const credentials = Buffer.from(
        `${this._identity}:${this._options.password.toString()}`,
      ).toString("base64");
      if (opts?.headers) opts.headers.Authorization = `Basic ${credentials}`;
    }

    // Profile 2 & 3: TLS options
    if (
      profile === SecurityProfile.TLS_BASIC_AUTH ||
      profile === SecurityProfile.TLS_CLIENT_CERT
    ) {
      const tls = this._options.tls ?? {};
      if (tls.ca) opts.ca = tls.ca;
      if (tls.rejectUnauthorized !== undefined)
        opts.rejectUnauthorized = tls.rejectUnauthorized;

      // Profile 3: Client certificates for mTLS
      if (profile === SecurityProfile.TLS_CLIENT_CERT) {
        if (tls.cert) opts.cert = tls.cert;
        if (tls.key) opts.key = tls.key;
        if (tls.passphrase) opts.passphrase = tls.passphrase;
      }
    }

    // Compression: permessage-deflate
    const compression = this._options.compression;
    if (compression) {
      opts.perMessageDeflate =
        compression === true
          ? {
              zlibDeflateOptions: { level: 6, memLevel: 8 },
              zlibInflateOptions: {},
              clientNoContextTakeover: true,
              serverNoContextTakeover: true,
            }
          : {
              zlibDeflateOptions: {
                level: compression.level ?? 6,
                memLevel: compression.memLevel ?? 8,
              },
              zlibInflateOptions: {},
              clientNoContextTakeover:
                compression.clientNoContextTakeover ?? true,
              serverNoContextTakeover:
                compression.serverNoContextTakeover ?? true,
            };
    }

    return opts;
  }

  // ─── Internal: Cleanup ───────────────────────────────────────

  /**
   * Reject everything still waiting in the offline queue.
   *
   * These entries hold the caller's resolve/reject, so leaving them in place on
   * a terminal close stranded those promises forever — the call never resolved,
   * never rejected, and never timed out, because the timeout is only armed once
   * a call is actually sent.
   */
  private _drainOfflineQueue(reason: string): void {
    if (this._offlineQueue.length === 0) return;
    const queued = this._offlineQueue.splice(0);
    this._logger?.debug?.("Rejecting offline-queued calls", {
      count: queued.length,
      reason,
    });
    for (const entry of queued) {
      entry.reject(new Error(reason));
    }
  }

  private _cleanup(): void {
    this._stopPing();
    this._drainOfflineQueue("Client closed");
    // Buffered frames belong to the connection that is going away. Keeping them
    // replayed stale messages onto the next connect() — and, since nothing
    // bounded this array, grew without limit across a long disconnect.
    this._outboundBuffer.length = 0;
    if (this._pongTimer) {
      clearTimeout(this._pongTimer);
      this._pongTimer = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._stopBackpressureDrain();
    const queued = this._backpressureQueue.splice(0);
    for (const entry of queued) {
      entry.cb?.(new Error("Connection closed"));
    }
    this._closePromise = null;
    this._ws = null;
  }
}
