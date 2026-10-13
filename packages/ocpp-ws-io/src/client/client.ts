import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { initLogger } from "../core/init-logger.js";
import { type MiddlewareFunction, MiddlewareStack } from "../core/middleware";
import { withoutUndefined } from "../core/options.js";
import { assertUniqueProtocols } from "../core/protocol-list.js";
import { Queue } from "../core/queue.js";
import { NOOP_LOGGER } from "../core/util.js";
import { assertStrictValidators } from "../core/validation/standard-validators.js";
import type { Validator } from "../core/validation/validator.js";
import type {
  AllMethodNames,
  OCPPRequestType,
  OCPPResponseType,
  OCPPSendRequestType,
  SendMethodNames,
} from "../generated/index.js";
import { createLoggingMiddleware } from "../helpers/index.js";
import type {
  CallOptions,
  CloseOptions,
  NoReplyCallOptions,
} from "../types/calls.js";
import type { ClientOptions } from "../types/client.js";
import type {
  ClientEvents,
  MessageDirection,
  MessageEventContext,
  MessageEventPayload,
  TypedEventEmitter,
} from "../types/events.js";
import type {
  CheckedAction,
  CheckedHandler,
  HandlerResult,
  HandlerReturn,
} from "../types/exact-keys.js";
import type {
  CallHandler,
  HandleArgs,
  HandlerContext,
  WildcardHandler,
} from "../types/handlers.js";
import type { JsonObject } from "../types/json.js";
import type { LoggerLike, LoggerLikeNotOptional } from "../types/logger.js";
import type { MiddlewareContext } from "../types/middleware.js";
import {
  type AnyOCPPProtocol,
  ConnectionState,
  type KnownProtocol,
  type OCPPMessage,
  type RequestOf,
  type ResponseOf,
  SecurityProfile,
  type SendRequestOf,
  type StrictModeMethodsFor,
  type UncheckedAction,
  type UncheckedHandler,
  type WithUniqueProtocols,
} from "../types/protocol.js";
import { safeSend } from "./backpressure.js";
import {
  attachWebsocket,
  closeClient,
  connectClient,
  openConnection,
} from "./connection.js";
import type {
  BackpressuredFrame,
  ClientContext,
  OfflineCall,
  PendingCall,
  ResolvedClientOptions,
} from "./context.js";
import type { SchemaKind } from "./frames.js";
import { handleMessage } from "./inbound.js";
import { startPing, stopPing } from "./keepalive.js";
import {
  bufferOutbound,
  queueCall,
  sendCall,
  sendMessage,
} from "./outbound.js";
import { handleClose } from "./reconnect.js";
import { validateMessage } from "./validation.js";
import {
  buildEndpoint,
  buildWsOptions,
  warnIgnoredWsOpts,
} from "./ws-options.js";

const { CONNECTING, OPEN, CLOSING, CLOSED } = ConnectionState;

/** safeCall()'s arguments: an action, or a version and then an action. */
type SafeCallArgs =
  | [
      method: string,
      params?: object | undefined,
      options?: CallOptions | undefined,
    ]
  | [
      version: string,
      method: string,
      params?: object | undefined,
      options?: CallOptions | undefined,
    ];

/**
 * call() by its implementation's arguments. safeCall() passes its own on
 * through call(), so a subclass that overrides call() is still used.
 */
interface CallsByArgs {
  call(...args: SafeCallArgs): Promise<unknown>;
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
  P extends AnyOCPPProtocol = AnyOCPPProtocol,
  // The protocols list as given, so a protocol listed twice is a type error.
  const L extends readonly P[] = readonly P[],
> extends (EventEmitter as new () => TypedEventEmitter<ClientEvents>) {
  // Static connection states
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  protected _options: ResolvedClientOptions<P>;

  protected _state: ConnectionState = CLOSED;
  protected _ws: WebSocket | null = null;
  protected _protocol: string | undefined;
  protected _identity: string;

  private _handlers = new Map<string, CallHandler>();
  private _wildcardHandler: WildcardHandler | null = null;
  private _pendingCalls = new Map<string, PendingCall>();
  /**
   * IDs of noReply calls whose answer can still arrive, each with the timer
   * that forgets it. The answer is then dropped quietly.
   */
  private _noReplyCalls = new Map<string, ReturnType<typeof setTimeout>>();
  private _pendingResponses = new Set<string>();
  /** Controllers of the handlers' signals, aborted when the connection closes. */
  private _runningHandlers = new Set<AbortController>();
  /** Incoming calls being answered; close() with awaitPending waits for them. */
  private _answering = new Set<Promise<void>>();
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

  private _offlineQueue: OfflineCall[] = [];
  private _middleware: MiddlewareStack<MiddlewareContext>;
  /** Explicit validators from options; null means resolve per protocol. */
  private _validators: readonly Validator[] | null = null;
  private _strictProtocols: string[] | null = null;
  protected _handshake: unknown = null;
  protected _logger: LoggerLike = NOOP_LOGGER;
  protected _exchangeLog = false;
  protected _prettify = false;
  /** The client's state as the modules in client/ read and write it. */
  private readonly _context: ClientContext = this._createContext();

  constructor(
    options: WithUniqueProtocols<ClientOptions<P>, P, L> &
      StrictModeMethodsFor<P>,
  ) {
    super();
    this.setMaxListeners(0);

    if (!options.identity) {
      throw new Error("identity is required");
    }
    assertUniqueProtocols(options.protocols);
    assertStrictValidators(
      options.protocols,
      options.strictMode,
      options.strictModeValidators,
    );

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
      ...withoutUndefined(options),
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

    if (this._options.respondWithDetailedErrors) this._warnDetailedErrors();
    warnIgnoredWsOpts(this._options.wsOpts, this._logger);

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
  public get options(): Readonly<ClientOptions<P>> {
    return this._options;
  }

  /**
   * The negotiated OCPP protocol version, available after connection.
   */
  get protocol(): P | undefined {
    // Negotiated from this client's own protocols.
    return this._protocol as P | undefined;
  }

  /**
   * This client typed for one of its protocols, or undefined while it speaks
   * another (or is not connected). A client configured for several versions
   * is typed for all of them until narrowed this way.
   */
  forProtocol<V extends P>(version: V): OCPPClient<V> | undefined;
  // The same object; only its type narrows.
  forProtocol(version: AnyOCPPProtocol): object | undefined {
    return this._protocol === version ? this : undefined;
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
  connect(): Promise<{
    response: import("node:http").IncomingMessage;
  }> {
    return connectClient(this._context);
  }

  /** Test seam, replaced by tests: see openConnection in client/connection.ts. */
  private _connectInternal(): Promise<{
    response: import("node:http").IncomingMessage;
  }> {
    return openConnection(this._context);
  }

  // ─── Close ───────────────────────────────────────────────────

  /**
   * Close the WebSocket connection.
   * By default, it awaits any pending calls to finish before closing.
   *
   * @param options Configuration for closing the connection (code, reason, awaiting pending calls, force close).
   * @returns A promise that resolves when the connection is fully closed.
   */
  close(options: CloseOptions = {}): Promise<{ code: number; reason: string }> {
    return closeClient(this._context, options);
  }

  // Typed overloads check the payload for keys the schema does not define on
  // the action name (`CheckedAction<M, ...>`, see ExactKeys), so the handler's
  // return is inferred as plain R. Method-only overloads come first: while a
  // handler's return is being written every overload fails, and editors take
  // their suggestions from the first one that accepts that many arguments.

  /**
   * Register a handler for the client's default protocol — `handle("BootNotification", handler)`.
   * Typed for the client's protocols; on a client configured for several, the
   * requests and responses of all of them. A response with a key the schema
   * does not define is an error.
   *
   * @throws {Error} If a handler for this method is already registered on this client instance.
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
   * Register a handler for an OCPP 2.1 SEND message on the client's default
   * protocol — `handle("NotifyPeriodicEventStream", handler)`. Nothing is sent
   * back for a SEND: `ctx.unconfirmed` is true and the return value is ignored.
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
   *
   * @throws {Error} If a handler for this version and method is already registered on this client instance.
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
   * Register a version-specific handler for an OCPP 2.1 SEND message —
   * `handle("ocpp2.1", "NotifyPeriodicEventStream", handler)`. Nothing is sent
   * back for a SEND: `ctx.unconfirmed` is true and the return value is ignored.
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
   *
   * @throws {Error} If a handler for this method is already registered on this client instance.
   */
  handle(method: UncheckedAction, handler: UncheckedHandler): void;

  /**
   * Register a version-specific handler for an action the types do not check —
   * `handle("vendor-proto", unchecked("Ping"), handler)`. The version must be
   * one of the client's protocols.
   *
   * @throws {Error} If a handler for this version and method is already registered on this client instance.
   */
  handle(version: P, method: UncheckedAction, handler: UncheckedHandler): void;

  /**
   * Register a wildcard handler for all unhandled methods.
   *
   * @throws {Error} If a wildcard handler is already registered on this client instance.
   */
  handle(handler: WildcardHandler): void;

  handle(...args: HandleArgs): void {
    if (args.length === 1 && typeof args[0] === "function") {
      // Wildcard handler
      if (this._wildcardHandler) {
        throw new Error("Wildcard handler is already registered.");
      }
      this._wildcardHandler = args[0];
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
  removeHandler(
    method?:
      | AllMethodNames<KnownProtocol<P>>
      | SendMethodNames<KnownProtocol<P>>
      | UncheckedAction,
  ): void;
  /**
   * Remove a registered handler for a specific version and method.
   */
  removeHandler<V extends KnownProtocol<P>>(
    version: V,
    method: AllMethodNames<V> | SendMethodNames<V> | UncheckedAction,
  ): void;
  /**
   * Remove a version-specific handler for an action the types do not check.
   */
  removeHandler(version: P, method: UncheckedAction): void;
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

  // Params are inferred as plain T and checked on the action name; see
  // handle(). Order: the method-only form without options first (2 arguments),
  // then the version-named forms, then the method-only forms with options, so
  // an incomplete call of either common form lines up with its own params.

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
   * with `undefined` once the frame is written; see {@link NoReplyCallOptions}.
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

  /**
   * Call an action the types do not check, such as an undeclared vendor
   * action, without waiting for its answer —
   * `call(unchecked("VendorPing"), params, { noReply: true })`.
   */
  async call(
    method: UncheckedAction,
    params: object,
    options: NoReplyCallOptions,
  ): Promise<void>;

  /**
   * Call an action the types do not check, such as an undeclared vendor
   * action — `call(unchecked("VendorPing"), params)`. The response is a JSON
   * object unless a type is given: `call<VendorPong>(unchecked("VendorPing"), params)`.
   */
  async call<TResult = JsonObject>(
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult>;

  /**
   * A version-specific CALL of an action the types do not check, without
   * waiting for its answer. The version must be one of the client's protocols.
   */
  async call(
    version: P,
    method: UncheckedAction,
    params: object,
    options: NoReplyCallOptions,
  ): Promise<void>;

  /**
   * Call an action the types do not check on a given version —
   * `call("vendor-proto", unchecked("Ping"), params)`. The version must be
   * one of the client's protocols.
   */
  async call<TResult = JsonObject>(
    version: P,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult>;

  call(...args: unknown[]): Promise<unknown> {
    return queueCall(this._context, args);
  }

  /**
   * Execute a call immediately, bypassing the callConcurrency queue, so it can
   * go out while earlier CALLs are unanswered. That breaks OCPP-J §4.1.1
   * (Synchronicity: a new CALL waits for the previous answer or its timeout)
   * on purpose: use it only with a peer known to cope, as with callConcurrency
   * above 1. Rejects unless connected. Used by OCPPServer.sendBatch to
   * pipeline warm-up calls without mutating the client's configured
   * concurrency (report M9).
   */
  callImmediate<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
    options?: CallOptions,
  ): Promise<OCPPResponseType<KnownProtocol<P>, M>>;

  /** callImmediate for an action the types do not check — \`callImmediate(unchecked("VendorPing"), params)\`. */
  callImmediate<TResult = JsonObject>(
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult>;

  callImmediate<TResult = unknown>(
    method: string,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult> {
    if (this._state !== OPEN) {
      return Promise.reject(
        new Error(`Cannot call: client is in state ${this._state}`),
      );
    }
    return sendCall(
      this._context,
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
  async send<
    M extends SendMethodNames<KnownProtocol<P>>,
    T extends SendRequestOf<KnownProtocol<P>, M>,
  >(
    method: CheckedAction<M, SendRequestOf<KnownProtocol<P>, M>, T>,
    params: T,
  ): Promise<void>;

  /**
   * Send a SEND message the types do not check —
   * `send(unchecked("VendorEvent"), params)`.
   */
  async send(method: UncheckedAction, params?: object): Promise<void>;

  send(
    method: string,
    params:
      | OCPPSendRequestType<KnownProtocol<P>, SendMethodNames<KnownProtocol<P>>>
      | object = {},
  ): Promise<void> {
    return sendMessage(this._context, method, params);
  }

  // ─── Safe Call (Best Effort) ─────────────────────────────────

  // Same order as call(); see there.

  /** Default protocol safe call. Returns `undefined` on error instead of throwing. */
  async safeCall<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
  ): Promise<OCPPResponseType<KnownProtocol<P>, M> | undefined>;

  /**
   * Version-specific safe call. Returns `undefined` on error instead of throwing.
   */
  async safeCall<
    V extends KnownProtocol<P>,
    M extends AllMethodNames<V>,
    T extends RequestOf<V, M>,
  >(
    version: V,
    method: CheckedAction<M, RequestOf<V, M>, T>,
    params: T,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M> | undefined>;

  /** Default protocol safe call, with options. */
  async safeCall<
    M extends AllMethodNames<KnownProtocol<P>>,
    T extends RequestOf<KnownProtocol<P>, M>,
  >(
    method: CheckedAction<M, RequestOf<KnownProtocol<P>, M>, T>,
    params: T,
    options: CallOptions,
  ): Promise<OCPPResponseType<KnownProtocol<P>, M> | undefined>;

  /** Safe call of an action the types do not check — `safeCall(unchecked("VendorPing"), params)`. */
  async safeCall<TResult = JsonObject>(
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult | undefined>;

  /**
   * Version-specific safe call of an action the types do not check. The
   * version must be one of the client's protocols.
   */
  async safeCall<TResult = JsonObject>(
    version: P,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult | undefined>;

  async safeCall(...args: SafeCallArgs): Promise<unknown> {
    try {
      return await (this as CallsByArgs).call(...args);
    } catch (error) {
      if ((error as Error).name !== "TimeoutError") {
        // Resolve the method name the same way call() parses its overloads:
        // (version, method, params?, options?) vs (method, params?, options?).
        const method =
          typeof args[0] === "string" && typeof args[1] === "string"
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

  /** Test seam: see bufferOutbound in client/outbound.ts. */
  private _bufferOutbound(message: string): void {
    bufferOutbound(this._context, message);
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

  reconfigure(options: Partial<ClientOptions<P>>): void {
    const given = withoutUndefined(options);
    // Checked on the combined options before any is applied.
    const next = { ...this._options, ...given };
    assertUniqueProtocols(next.protocols);
    assertStrictValidators(
      next.protocols,
      next.strictMode,
      next.strictModeValidators,
    );
    const detailedBefore = this._options.respondWithDetailedErrors;
    Object.assign(this._options, given);

    if (options.respondWithDetailedErrors && !detailedBefore) {
      this._warnDetailedErrors();
    }
    if (options.wsOpts !== undefined)
      warnIgnoredWsOpts(this._options.wsOpts, this._logger);

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

  /**
   * respondWithDetailedErrors sends a handler error's properties to the peer.
   * Overridden by the server's per-connection clients: the server warns once
   * for all of them instead of once per charger.
   */
  protected _warnDetailedErrors(): void {
    this._logger.warn?.(
      "respondWithDetailedErrors is on: a handler error's properties are sent to the CSMS in CALLERROR details. Keep it off in production.",
    );
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

  /** See attachWebsocket in client/connection.ts. */
  protected _attachWebsocket(ws: WebSocket): void {
    attachWebsocket(this._context, ws);
  }

  /**
   * The client's fields, read and written by name, and the methods that stay
   * on the client, called through it so overrides, test replacements and the
   * client's listeners apply.
   */
  private _createContext(): ClientContext {
    const client = this;
    return {
      get identity() {
        return client._identity;
      },
      get logger() {
        return client._logger;
      },
      get options() {
        return client._options;
      },
      get strictMode() {
        return client._options.strictMode;
      },
      get strictProtocols() {
        return client._strictProtocols;
      },
      get idValidator() {
        return client._options.idValidator;
      },
      get respondWithDetailedErrors() {
        return client._options.respondWithDetailedErrors;
      },
      get badMessageWindowMs() {
        return client._options.badMessageWindowMs;
      },
      get maxBadMessages() {
        return client._options.maxBadMessages;
      },
      get handlers() {
        return client._handlers;
      },
      get wildcardHandler() {
        return client._wildcardHandler;
      },
      get middleware() {
        return client._middleware;
      },
      get pendingCalls() {
        return client._pendingCalls;
      },
      get pendingResponses() {
        return client._pendingResponses;
      },
      get runningHandlers() {
        return client._runningHandlers;
      },
      get answering() {
        return client._answering;
      },
      get handlerTimeoutMs() {
        return client._options.handlerTimeoutMs ?? 0;
      },
      get noReplyCalls() {
        return client._noReplyCalls;
      },
      get offlineQueue() {
        return client._offlineQueue;
      },
      get callQueue() {
        return client._callQueue;
      },
      get backpressureQueue() {
        return client._backpressureQueue;
      },
      get lastActivity() {
        return client._lastActivity;
      },
      get validators() {
        return client._validators;
      },
      get state() {
        return client._state;
      },
      set state(state) {
        client._state = state;
      },
      get ws() {
        return client._ws;
      },
      set ws(ws) {
        client._ws = ws;
      },
      get protocol() {
        return client._protocol;
      },
      set protocol(protocol) {
        client._protocol = protocol;
      },
      get badMessageCount() {
        return client._badMessageCount;
      },
      set badMessageCount(count) {
        client._badMessageCount = count;
      },
      get badMessageWindowStart() {
        return client._badMessageWindowStart;
      },
      set badMessageWindowStart(at) {
        client._badMessageWindowStart = at;
      },
      get outboundBuffer() {
        return client._outboundBuffer;
      },
      set outboundBuffer(buffer) {
        client._outboundBuffer = buffer;
      },
      get backpressureTimer() {
        return client._backpressureTimer;
      },
      set backpressureTimer(timer) {
        client._backpressureTimer = timer;
      },
      get pingTimer() {
        return client._pingTimer;
      },
      set pingTimer(timer) {
        client._pingTimer = timer;
      },
      get pongTimer() {
        return client._pongTimer;
      },
      set pongTimer(timer) {
        client._pongTimer = timer;
      },
      get reconnectAttempt() {
        return client._reconnectAttempt;
      },
      set reconnectAttempt(attempt) {
        client._reconnectAttempt = attempt;
      },
      get reconnectTimer() {
        return client._reconnectTimer;
      },
      set reconnectTimer(timer) {
        client._reconnectTimer = timer;
      },
      get closeRequested() {
        return client._closeRequested;
      },
      set closeRequested(requested) {
        client._closeRequested = requested;
      },
      get closePromise() {
        return client._closePromise;
      },
      set closePromise(closing) {
        client._closePromise = closing;
      },
      get openedAt() {
        return client._openedAt;
      },
      set openedAt(at) {
        client._openedAt = at;
      },
      get emitter() {
        return client;
      },
      recordActivity: () => client._recordActivity(),
      awaitHandlerGrace: () => client._awaitHandlerGrace(),
      validateInbound: (method, params, kind) =>
        client._validateInbound(method, params, kind),
      validateOutbound: (method, params, kind) =>
        client._validateOutbound(method, params, kind),
      invokeBeforeSend: (message) => client._invokeBeforeSend(message),
      safeSend: (ws, data, cb) => client._safeSend(ws, data, cb),
      bufferOutbound: (message) => client._bufferOutbound(message),
      emitMessageEvent: (message, direction, ctx, latencyMs) =>
        client._emitMessageEvent(message, direction, ctx, latencyMs),
      startPing: () => client._startPing(),
      stopPing: () => client._stopPing(),
      connectInternal: () => client._connectInternal(),
      attachWebsocket: (ws) => client._attachWebsocket(ws),
      onMessage: (data) => client._onMessage(data),
      onClose: (code, reason) => client._onClose(code, reason),
      buildEndpoint: () => client._buildEndpoint(),
      buildWsOptions: () => client._buildWsOptions(),
      close: (options) => client.close(options),
    };
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

  /** The server client's entry point, and a test seam: see handleMessage in client/inbound.ts. */
  protected _onMessage(rawData: WebSocket.RawData, preParsed?: unknown): void {
    handleMessage(this._context, rawData, preParsed);
  }

  // ─── Internal: Close handling ────────────────────────────────

  /** The server client's close handler too: see handleClose in client/reconnect.ts. */
  protected _onClose(code: number, reason: Buffer): void {
    handleClose(this._context, code, reason);
  }

  // ─── Internal: Backpressure-Aware Send ───────────────────────

  /** Sends queued while the socket is backpressured (FIFO). */
  private _backpressureQueue: BackpressuredFrame[] = [];
  private _backpressureTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Protected hook for plugins to intercept outbound messages before serialization.
   * Return `false` to suppress the message transmission.
   */
  protected _invokeBeforeSend(
    _message: OCPPMessage,
  ): boolean | Promise<boolean> {
    return true; // Implemented by OCPPServerClient
  }

  /** Test seam: see safeSend in client/backpressure.ts. */
  private _safeSend(
    ws: WebSocket | null,
    data: string,
    cb?: (err?: Error) => void,
  ): void {
    safeSend(this._context, ws, data, cb);
  }

  // ─── Internal: Ping/Pong ─────────────────────────────────────

  /** The server client calls it too: see startPing in client/keepalive.ts. */
  protected _startPing(): void {
    startPing(this._context);
  }

  /** Test seam: see stopPing in client/keepalive.ts. */
  private _stopPing(): void {
    stopPing(this._context);
  }

  protected _recordActivity(): void {
    this._lastActivity = Date.now();
  }

  // ─── Internal: Validation ────────────────────────────────────

  private _setupValidators(): void {
    // Custom validators add to the built-in ones, as documented: one for a
    // subprotocol wins over the built-in validator, which covers the rest.
    // Built-in validators are resolved per protocol in _findValidator once the
    // subprotocol is actually negotiated, so a connection never builds
    // validators for versions it does not speak.
    this._validators = this._options.strictModeValidators ?? null;

    if (Array.isArray(this._options.strictMode)) {
      this._strictProtocols = this._options.strictMode;
    } else {
      this._strictProtocols = null;
    }
  }

  /** Test seam: see validateMessage in client/validation.ts. */
  private _validateOutbound(
    method: string,
    params: unknown,
    suffix: SchemaKind,
  ): void {
    validateMessage(this._context, method, params, suffix);
  }

  /** Test seam: see validateMessage in client/validation.ts. */
  private _validateInbound(
    method: string,
    params: unknown,
    suffix: SchemaKind,
  ): void {
    validateMessage(this._context, method, params, suffix);
  }

  // ─── Internal: Endpoint building ─────────────────────────────

  /** Test seam: see buildEndpoint in client/ws-options.ts. */
  private _buildEndpoint(): string {
    return buildEndpoint(this._options, this._identity);
  }

  /** Test seam: see buildWsOptions in client/ws-options.ts. */
  private _buildWsOptions(): WebSocket.ClientOptions {
    return buildWsOptions(this._options, this._identity);
  }
}

/** The members of OCPPClient whose types follow its protocols. */
type ProtocolTypedMember =
  | "call"
  | "safeCall"
  | "handle"
  | "send"
  | "forProtocol";

/**
 * Any OCPPClient, whatever protocols it is configured for: every member except
 * the calls typed by protocol. A client typed for its protocols does not fit
 * a variable of another protocol set, so code holding differently configured
 * clients, such as a list to close, uses this type.
 */
export type AnyOCPPClient = Omit<OCPPClient, ProtocolTypedMember>;
