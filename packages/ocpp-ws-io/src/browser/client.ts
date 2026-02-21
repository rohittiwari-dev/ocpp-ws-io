/// <reference lib="dom" />

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
import { createId } from "@paralleldrive/cuid2";
import { type MiddlewareFunction, MiddlewareStack } from "../middleware.js";
import type { MiddlewareContext } from "../types.js";
import { EventEmitter } from "./emitter.js";
import {
  type RPCError,
  RPCGenericError,
  RPCMessageTypeNotSupportedError,
  TimeoutError,
} from "./errors.js";
import { Queue } from "./queue.js";
import {
  type AllMethodNames,
  type BrowserClientOptions,
  type CallHandler,
  type CallOptions,
  type CloseOptions,
  ConnectionState,
  type HandlerContext,
  type LoggerLike,
  MessageType,
  NOREPLY,
  type OCPPCall,
  type OCPPCallError,
  type OCPPCallResult,
  type OCPPMessage,
  type OCPPProtocol,
  type OCPPRequestType,
  type OCPPResponseType,
  type WildcardHandler,
} from "./types.js";
import { createRPCError, getErrorPlainObject } from "./util.js";

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
  P extends OCPPProtocol = OCPPProtocol,
> extends EventEmitter {
  // Static connection states
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  private _options: Required<
    Pick<
      BrowserClientOptions,
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
    BrowserClientOptions;

  private _state: (typeof ConnectionState)[keyof typeof ConnectionState] =
    CLOSED;
  private _ws: WebSocket | null = null;
  private _protocol: string | undefined;
  private _identity: string;

  private _handlers = new Map<string, CallHandler>();
  private _wildcardHandler: WildcardHandler | null = null;
  private _pendingCalls = new Map<string, PendingCall>();
  private _pendingResponses = new Set<string>();
  private _callQueue: Queue;
  private _closePromise: Promise<{ code: number; reason: string }> | null =
    null;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _badMessageCount = 0;
  private _outboundBuffer: string[] = [];
  private _logger: LoggerLike | null = null;
  private _middleware: MiddlewareStack<MiddlewareContext>;

  constructor(options: BrowserClientOptions) {
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
      callConcurrency: 1,
      maxBadMessages: Infinity,
      respondWithDetailedErrors: false,
      ...options,
    };

    this._callQueue = new Queue(this._options.callConcurrency);
    this._middleware = new MiddlewareStack<MiddlewareContext>();

    // Initialize logger
    const logging = this._options.logging;
    if (logging !== false && logging?.enabled !== false) {
      this._logger = logging?.handler ?? console;
      if (this._logger?.child) {
        this._logger = this._logger.child({
          component: "BrowserOCPPClient",
          identity: this._identity,
        });
      }
    }
  }

  // ─── Getters ─────────────────────────────────────────────────

  get log(): LoggerLike {
    return this._logger ?? console;
  }
  get identity(): string {
    return this._identity;
  }
  get protocol(): string | undefined {
    return this._protocol;
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

      this._logger?.debug?.("Connecting", { url: endpoint });
      this.emit("connecting", { url: endpoint });

      let ws: WebSocket;
      try {
        ws = this._options.protocols?.length
          ? new WebSocket(endpoint, this._options.protocols)
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

        // Narrow protocols to negotiated protocol for future reconnects
        if (ws.protocol && this._reconnectAttempt === 0) {
          this._options.protocols = [ws.protocol];
        }

        this._attachWebsocket(ws);

        // Flush outbound buffer (messages queued during CONNECTING)
        if (this._outboundBuffer.length > 0) {
          const buffer = this._outboundBuffer;
          this._outboundBuffer = [];
          for (const msg of buffer) this._ws?.send(msg);
        }

        this._logger?.info?.("Connected", {
          protocol: ws.protocol || undefined,
        });
        this.emit("open", event);
        resolve();
      };

      const onError = (event: Event) => {
        cleanup();
        this._state = CLOSED;
        this._logger?.error?.("Connection error");
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
      this._wildcardHandler = args[0] as WildcardHandler;
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

  removeHandler(method?: string): void;
  removeHandler(version: OCPPProtocol, method: string): void;
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
      // call(version, method, params, options?)
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
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "outgoing_call" }
      >;

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
          this._logger?.warn?.("Call timed out", {
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
          pending.abortHandler = abortHandler;
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

  // ─── Reconfigure ─────────────────────────────────────────────

  reconfigure(options: Partial<BrowserClientOptions>): void {
    Object.assign(this._options, options);

    if (options.callConcurrency !== undefined) {
      this._callQueue.setConcurrency(options.callConcurrency);
    }
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

    let message: OCPPMessage;
    try {
      message = JSON.parse(raw) as OCPPMessage;
      if (!Array.isArray(message)) throw new Error("Message is not an array");
    } catch (err) {
      this._onBadMessage(raw, err as Error);
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
          result = await this._wildcardHandler(ctxvals.method, context);
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
        this._logger?.error?.("Handler error", {
          messageId: ctxvals.messageId,
          method: ctxvals.method,
          error: (err as Error).message,
        });

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
      }
    });
  }

  private async _handleCallResult(message: OCPPCallResult): Promise<void> {
    const [, msgId, result] = message;

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
      method: pending.method,
      payload: result,
    };

    await this._middleware.execute(ctx, async (c) => {
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
      this._pendingCalls.delete(msgId);
      pending.resolve(ctxvals.payload);
    });
  }

  private async _handleCallError(message: OCPPCallError): Promise<void> {
    const [, msgId, errorCode, errorMessage, errorDetails] = message;

    if (!this._pendingCalls.has(msgId)) {
      this._logger?.warn?.("Received CallError for unknown messageId", {
        messageId: msgId,
      });
      return;
    }

    const pending = this._pendingCalls.get(msgId)!;

    const error = createRPCError(errorCode, errorMessage, errorDetails);

    const ctx: MiddlewareContext = {
      type: "incoming_error",
      messageId: msgId,
      method: pending.method,
      error: error as unknown as OCPPCallError, // Map to types.ts expected `error` shape which takes OCPPCallError specifically here, though we pass it via RPCError
    };

    await this._middleware.execute(ctx, async (c) => {
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "incoming_error" }
      >;

      // Cast back to any to extract dynamic properties cleanly
      const resolvedRpcErr = ctxvals.error as unknown as any;

      const modifiedMessage: OCPPCallError = [
        MessageType.CALLERROR,
        msgId,
        resolvedRpcErr.rpcErrorCode,
        resolvedRpcErr.message,
        resolvedRpcErr.rpcErrorDetails ?? {},
      ];
      this.emit("callError", modifiedMessage);

      clearTimeout(pending.timeoutHandle);
      this._pendingCalls.delete(msgId);
      pending.reject(resolvedRpcErr);
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

    // Best-effort: try to extract messageId and respond with CALLERROR
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
    let url = this._options.endpoint;

    if (!url.endsWith("/")) url += "/";
    url += encodeURIComponent(this._identity);

    if (this._options.query) {
      const params = new URLSearchParams(this._options.query);
      url += (url.includes("?") ? "&" : "?") + params.toString();
    }

    return url;
  }

  // ─── Internal: Cleanup ───────────────────────────────────────

  private _cleanup(): void {
    this._closePromise = null;
    this._ws = null;
  }
}
