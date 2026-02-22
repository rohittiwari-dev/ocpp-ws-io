import { EventEmitter } from "node:events";
import { createId } from "@paralleldrive/cuid2";
import WebSocket from "ws";
import {
  type RPCError,
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
import { standardValidators } from "./standard-validators.js";
import {
  type CallHandler,
  type CallOptions,
  type ClientEvents,
  type ClientOptions,
  type CloseOptions,
  ConnectionState,
  type HandlerContext,
  type LoggerLike,
  type LoggerLikeNotOptional,
  MessageType,
  type MiddlewareContext,
  NOREPLY,
  type OCPPCall,
  type OCPPCallError,
  type OCPPCallResult,
  type OCPPMessage,
  type OCPPProtocol,
  SecurityProfile,
  type TypedEventEmitter,
  type WildcardHandler,
} from "./types.js";
import {
  createRPCError,
  getErrorPlainObject,
  getPackageIdent,
  NOOP_LOGGER,
} from "./util.js";
import type { Validator } from "./validator.js";
import { isValidStatusCode } from "./ws-util.js";

const { CONNECTING, OPEN, CLOSING, CLOSED } = ConnectionState;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  abortHandler?: () => void;
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
  private _pongTimer: ReturnType<typeof setTimeout> | null = null;
  private _closePromise: Promise<{ code: number; reason: string }> | null =
    null;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _badMessageCount = 0;
  private _lastActivity = 0;
  private _outboundBuffer: string[] = [];
  private _middleware: MiddlewareStack<MiddlewareContext>;
  private _validators: Validator[] = [];
  private _strictProtocols: string[] | null = null;
  protected _handshake: unknown = null;
  protected _logger: LoggerLike = NOOP_LOGGER;
  protected _exchangeLog = false;
  protected _prettify = false;

  constructor(options: ClientOptions) {
    super();

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
      maxBadMessages: Infinity,
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
  get log() {
    return (this._logger || NOOP_LOGGER) as LoggerLikeNotOptional;
  }
  public get identity(): string {
    return this._options.identity;
  }

  public get endpoint(): string {
    return this._options.endpoint;
  }

  public get options(): Readonly<ClientOptions> {
    return this._options;
  }

  get protocol(): string | undefined {
    return this._protocol;
  }
  get state(): ConnectionState {
    return this._state;
  }
  get securityProfile(): SecurityProfile {
    return this._options.securityProfile ?? SecurityProfile.NONE;
  }

  // ─── Connect ─────────────────────────────────────────────────

  async connect(): Promise<{ response: import("node:http").IncomingMessage }> {
    if (this._state !== CLOSED) {
      throw new Error(`Cannot connect: client is in state ${this._state}`);
    }

    this._state = CONNECTING;
    this._reconnectAttempt = 0;

    return this._connectInternal();
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

        // Narrow protocols to negotiated protocol for future reconnects (prevents flip-flopping)
        if (ws.protocol && this._reconnectAttempt === 0) {
          this._options.protocols = [ws.protocol];
        }

        this._attachWebsocket(ws);
        this._startPing();

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
        this._logger?.error?.("Connection error", { error: err.message });
        this.emit("error", err);
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
        this.emit("error", err);
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
    this._stopPing();

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
        const result = { code: closeCode, reason: closeReason.toString() };
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
   */
  handle<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    version: V,
    method: M,
    handler: (
      context: HandlerContext<OCPPRequestType<V, M>>,
    ) => OCPPResponseType<V, M> | Promise<OCPPResponseType<V, M>>,
  ): void;

  /**
   * Register a handler for a custom/extension protocol/method not in the typed OCPP method maps.
   * `handle("my-protocol", "my-method", handler)`
   *
   * Note: This overload matches only if the protocol is NOT a known strict protocol of standard OCPP versions.
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
   */
  handle<M extends AllMethodNames<P>>(
    method: M,
    handler: (
      context: HandlerContext<OCPPRequestType<P, M>>,
    ) => OCPPResponseType<P, M> | Promise<OCPPResponseType<P, M>>,
  ): void;

  /** Register a handler for a custom/extension method not in the typed OCPP method maps. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(
    method: string,
    handler: (context: HandlerContext<Record<string, any>>) => any,
  ): void;

  /** Register a wildcard handler for all unhandled methods. */
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
    } else {
      throw new Error(
        "Invalid arguments: provide (version, method, handler), (method, handler), or (wildcardHandler)",
      );
    }
  }

  removeHandler(method?: string): void;
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
      throw new Error(`Cannot call: client is in state ${this._state}`);
    }

    return this._callQueue.push(() => this._sendCall(method, params, options));
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
        const payload = {
          method: args.find(
            (a) => typeof a === "string" && !a.startsWith("ocpp"),
          ), // heuristic
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
    const msgId = createId();
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
      const messageStr = JSON.stringify(message);

      callResult = await new Promise<unknown>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._pendingCalls.delete(msgId);
          reject(
            new TimeoutError(
              `Call to "${ctxvals.method}" timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);

        const abortHandler = () => {
          clearTimeout(timeoutHandle);
          this._pendingCalls.delete(msgId);
          reject(new Error("Aborted"));
        };

        if (options.signal) {
          options.signal.addEventListener("abort", abortHandler);
        }

        this._pendingCalls.set(msgId, {
          resolve,
          reject,
          timeoutHandle,
          abortHandler: options.signal
            ? () => options.signal?.removeEventListener("abort", abortHandler)
            : undefined,
          method: ctxvals.method,
          sentAt: Date.now(),
        });

        if (this._ws?.readyState === WebSocket.OPEN) {
          this._ws.send(messageStr, (err) => {
            if (err) {
              // Failed to send
              clearTimeout(timeoutHandle);
              this._pendingCalls.delete(msgId);
              reject(err);
            } else {
              // Handled by createLoggingMiddleware
            }
          });
        } else if (this._state === CONNECTING) {
          // Buffer it
          this._logger?.debug?.("Buffering call", { method: ctxvals.method });
          this._outboundBuffer.push(messageStr);
          // The promise remains pending until connected & flushed -> then response comes
        } else {
          clearTimeout(timeoutHandle);
          this._pendingCalls.delete(msgId);
          reject(new Error(`WebSocket is not open (state: ${this._state})`));
        }
      });

      return callResult;
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

  protected _attachWebsocket(ws: WebSocket): void {
    ws.on("message", (data: WebSocket.RawData) => this._onMessage(data));
    ws.on("close", (code: number, reason: Buffer) =>
      this._onClose(code, reason),
    );
    ws.on("error", (err: Error) => this.emit("error", err));
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

  // ─── Internal: Message handling ──────────────────────────────

  private _onMessage(rawData: WebSocket.RawData): void {
    this._recordActivity();

    let message: OCPPMessage;
    try {
      const str = rawData.toString();
      message = JSON.parse(str) as OCPPMessage;
      if (!Array.isArray(message)) throw new Error("Message is not an array");
    } catch (err) {
      this._onBadMessage(rawData.toString(), err as Error);
      return;
    }

    const messageType = message[0];

    switch (messageType) {
      case MessageType.CALL:
        this._handleIncomingCall(message as OCPPCall);
        break;
      case MessageType.CALLRESULT:
        this._handleCallResult(message as OCPPCallResult);
        break;
      case MessageType.CALLERROR:
        this._handleCallError(message as OCPPCallError);
        break;
      default:
        this._onBadMessage(
          JSON.stringify(message),
          new RPCMessageTypeNotSupportedError(
            `Unknown message type: ${messageType}`,
          ),
        );
    }
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
        this.emit("call", modifiedMessage);

        if (this._state !== OPEN) {
          return;
        }

        try {
          if (this._pendingResponses.has(ctxvals.messageId)) {
            throw createRPCError(
              "RpcFrameworkError",
              `Already processing call with ID: ${ctxvals.messageId}`,
            );
          }

          const specificHandler =
            (this._protocol
              ? this._handlers.get(`${this._protocol}:${ctxvals.method}`)
              : undefined) ?? this._handlers.get(ctxvals.method);

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

          const response: OCPPCallResult = [
            MessageType.CALLRESULT,
            ctxvals.messageId,
            result,
          ];
          this._ws?.send(JSON.stringify(response));
          this.emit("callResult", response);

          return result;
        } catch (err) {
          this._pendingResponses.delete(ctxvals.messageId);

          const rpcErr =
            err instanceof RPCGenericError || (err as RPCError).rpcErrorCode
              ? (err as RPCError)
              : createRPCError("InternalError", (err as Error).message);

          const details = this._options.respondWithDetailedErrors
            ? getErrorPlainObject(err as Error)
            : {};

          const errorResponse: OCPPCallError = [
            MessageType.CALLERROR,
            ctxvals.messageId,
            rpcErr.rpcErrorCode,
            rpcErr.rpcErrorMessage || (err as Error).message || "",
            details,
          ];
          this._ws?.send(JSON.stringify(errorResponse));
          this.emit("callError", errorResponse);

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

      this.emit("callResult", message);

      clearTimeout(pendingCtx.timeoutHandle);
      if (pendingCtx.abortHandler) {
        // Remove abort listener if bound
      }
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
      const [, , code, msg, details] = ctxvals.error;

      const pendingCtx = this._pendingCalls.get(ctxvals.messageId);
      if (!pendingCtx) return;

      // Handled by createLoggingMiddleware

      this.emit("callError", ctxvals.error);

      clearTimeout(pendingCtx.timeoutHandle);
      this._pendingCalls.delete(ctxvals.messageId);

      const err = createRPCError(code, msg, details);
      pendingCtx.reject(err);
    });
  }

  // ─── Internal: Bad message handling ──────────────────────────

  private _onBadMessage(rawMessage: string, error: Error): void {
    this._badMessageCount++;
    this._logger?.warn?.("Bad message", {
      error: error.message,
      count: this._badMessageCount,
    });
    this.emit("badMessage", { message: rawMessage, error });

    // Best-effort: try to extract messageId from the raw string and respond
    // with a proper CALLERROR so the sender isn't left waiting.
    // Pattern matches OCPP-J CALL format: [2, "messageId", ...]
    const match = rawMessage.match(/^\s*\[\s*2\s*,\s*"([^"]+)"/);
    if (match?.[1] && this._ws) {
      const errorResponse: OCPPCallError = [
        MessageType.CALLERROR,
        match[1],
        "FormatViolation",
        error.message || "Invalid message format",
        {},
      ];
      this._ws.send(JSON.stringify(errorResponse));
      this.emit("callError", errorResponse);
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
      pending.reject(new Error(reason));
    }
    this._pendingCalls.clear();
    this._pendingResponses.clear();
  }

  private _onClose(code: number, reason: Buffer): void {
    this._stopPing();
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
    this._reconnectAttempt++;
    this._state = CONNECTING;

    // Exponential backoff with jitter (OCPP 2.0.1 §J.1)
    const base = this._options.backoffMin;
    const max = this._options.backoffMax;
    const delayMs = Math.min(
      max,
      base * 2 ** (this._reconnectAttempt - 1) * (0.5 + Math.random() * 0.5),
    );

    this._logger?.warn?.("Reconnecting", {
      attempt: this._reconnectAttempt,
      delayMs: Math.round(delayMs),
    });
    this.emit("reconnect", { attempt: this._reconnectAttempt, delay: delayMs });

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this._connectInternal();
      } catch (err) {
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

  // ─── Internal: Ping/Pong ─────────────────────────────────────

  private _startPing(): void {
    if (this._options.pingIntervalMs <= 0) return;

    const pongTimeoutMs =
      (this._options as ClientOptions).pongTimeoutMs ??
      this._options.pingIntervalMs + 5000;

    const doPing = () => {
      // console.log("doPing called", this._state, !!this._ws, "interval", this._options.pingIntervalMs);
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
      if (pongTimeoutMs > 0) {
        this._pongTimer = setTimeout(() => {
          this._logger?.warn?.("Pong timeout — terminating dead connection", {
            identity: this._identity,
            timeoutMs: pongTimeoutMs,
          });
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

  private _recordActivity(): void {
    this._lastActivity = Date.now();
  }

  // ─── Internal: Validation ────────────────────────────────────

  private _setupValidators(): void {
    if (this._options.strictModeValidators) {
      this._validators = this._options.strictModeValidators;
    } else {
      this._validators = standardValidators;
    }

    if (Array.isArray(this._options.strictMode)) {
      this._strictProtocols = this._options.strictMode;
    } else {
      this._strictProtocols = null;
    }
  }

  private _validateOutbound(
    method: string,
    params: unknown,
    suffix: "req" | "conf",
  ): void {
    const validator = this._findValidator();
    if (!validator) return;

    if (
      this._options.strictModeMethods &&
      !this._options.strictModeMethods.includes(method as any)
    ) {
      return; // Skip validation if method is not in the explicit strict list
    }

    const schemaId = `urn:${method}.${suffix}`;
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
    suffix: "req" | "conf",
  ): void {
    const validator = this._findValidator();
    if (!validator) return;

    if (
      this._options.strictModeMethods &&
      !this._options.strictModeMethods.includes(method as any)
    ) {
      return; // Skip validation if method is not in the explicit strict list
    }

    const schemaId = `urn:${method}.${suffix}`;
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

    return (
      this._validators.find((v) => v.subprotocol === this._protocol) ?? null
    );
  }

  // ─── Internal: Endpoint building ─────────────────────────────

  private _buildEndpoint(): string {
    let url = this._options.endpoint;

    // Append identity to URL path
    if (!url.endsWith("/")) url += "/";
    url += encodeURIComponent(this._identity);

    // Append query parameters
    if (this._options.query) {
      const params = new URLSearchParams(this._options.query);
      url += (url.includes("?") ? "&" : "?") + params.toString();
    }

    return url;
  }

  private _buildWsOptions(): WebSocket.ClientOptions {
    const opts: WebSocket.ClientOptions = {
      headers: {
        ...this._options.headers,
        "User-Agent": getPackageIdent(),
      },
    };

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

    return opts;
  }

  // ─── Internal: Cleanup ───────────────────────────────────────

  private _cleanup(): void {
    this._stopPing();
    if (this._pongTimer) {
      clearTimeout(this._pongTimer);
      this._pongTimer = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._closePromise = null;
    this._ws = null;
  }
}
