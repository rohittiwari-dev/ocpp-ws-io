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
import { EventEmitter } from "./emitter.js";
import { Queue } from "./queue.js";
import {
  TimeoutError,
  RPCGenericError,
  RPCMessageTypeNotSupportedError,
  type RPCError,
} from "./errors.js";
import { createRPCError, getErrorPlainObject } from "./util.js";
import {
  ConnectionState,
  MessageType,
  NOREPLY,
  type OCPPProtocol,
  type CallOptions,
  type CloseOptions,
  type CallHandler,
  type WildcardHandler,
  type HandlerContext,
  type OCPPCall,
  type OCPPCallResult,
  type OCPPCallError,
  type OCPPMessage,
  type AllMethodNames,
  type OCPPRequestType,
  type OCPPResponseType,
  type BrowserClientOptions,
} from "./types.js";

const { CONNECTING, OPEN, CLOSING, CLOSED } = ConnectionState;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  abortHandler?: () => void;
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
  }

  // ─── Getters ─────────────────────────────────────────────────

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
        this._attachWebsocket(ws);
        this.emit("open", event);
        resolve();
      };

      const onError = (event: Event) => {
        cleanup();
        this._state = CLOSED;
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
        this._ws.close(code, reason);
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

    const message: OCPPCall = [MessageType.CALL, msgId, method, params];
    const messageStr = JSON.stringify(message);

    return new Promise<unknown>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingCalls.delete(msgId);
        reject(
          new TimeoutError(
            `Call to "${method}" timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      const pending: PendingCall = {
        resolve: resolve as (v: unknown) => void,
        reject,
        timeoutHandle,
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
          reject(options.signal!.reason ?? new Error("Aborted"));
        };
        options.signal.addEventListener("abort", abortHandler, { once: true });
        pending.abortHandler = abortHandler;
      }

      this._pendingCalls.set(msgId, pending);
      this._ws!.send(messageStr);
      this.emit("message", message);
    });
  }

  /**
   * Send a raw string message over the WebSocket (use with caution).
   */
  sendRaw(message: string): void {
    if (this._state !== OPEN || !this._ws) {
      throw new Error("Cannot send: client is not connected");
    }
    this._ws.send(message);
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

    this.emit("call", message);

    if (this._state !== OPEN) {
      return;
    }

    try {
      if (this._pendingResponses.has(msgId)) {
        throw createRPCError(
          "RpcFrameworkError",
          `Already processing call with ID: ${msgId}`,
        );
      }

      // Try version-specific handler first, then fall back to generic
      const handler = this._protocol
        ? (this._handlers.get(`${this._protocol}:${method}`) ??
          this._handlers.get(method))
        : this._handlers.get(method);
      let isWildcard = false;
      if (!handler) {
        if (this._wildcardHandler) {
          isWildcard = true;
        } else {
          throw createRPCError(
            "NotImplemented",
            `No handler for method: ${method}`,
          );
        }
      }

      this._pendingResponses.add(msgId);

      const ac = new AbortController();
      const context: HandlerContext = {
        messageId: msgId,
        method,
        protocol: this._protocol,
        params,
        signal: ac.signal,
      };

      let result: unknown;
      if (isWildcard && this._wildcardHandler) {
        result = await this._wildcardHandler(method, context);
      } else {
        result = await handler!(context);
      }

      this._pendingResponses.delete(msgId);

      if (result === NOREPLY) return;

      const response: OCPPCallResult = [MessageType.CALLRESULT, msgId, result];
      this._ws?.send(JSON.stringify(response));
      this.emit("callResult", response);
    } catch (err) {
      this._pendingResponses.delete(msgId);

      const rpcErr =
        err instanceof RPCGenericError || (err as RPCError).rpcErrorCode
          ? (err as RPCError)
          : createRPCError("InternalError", (err as Error).message);

      const details = this._options.respondWithDetailedErrors
        ? getErrorPlainObject(err as Error)
        : {};

      const errorResponse: OCPPCallError = [
        MessageType.CALLERROR,
        msgId,
        rpcErr.rpcErrorCode,
        rpcErr.rpcErrorMessage || (err as Error).message || "",
        details,
      ];
      this._ws?.send(JSON.stringify(errorResponse));
      this.emit("callError", errorResponse);
    }
  }

  private _handleCallResult(message: OCPPCallResult): void {
    const [, msgId, result] = message;

    this.emit("callResult", message);

    const pending = this._pendingCalls.get(msgId);
    if (!pending) return;

    clearTimeout(pending.timeoutHandle);
    this._pendingCalls.delete(msgId);
    pending.resolve(result);
  }

  private _handleCallError(message: OCPPCallError): void {
    const [, msgId, errorCode, errorMessage, errorDetails] = message;

    this.emit("callError", message);

    const pending = this._pendingCalls.get(msgId);
    if (!pending) return;

    clearTimeout(pending.timeoutHandle);
    this._pendingCalls.delete(msgId);

    const err = createRPCError(errorCode, errorMessage, errorDetails);
    pending.reject(err);
  }

  // ─── Internal: Bad message handling ──────────────────────────

  private _onBadMessage(rawMessage: string, error: Error): void {
    this._badMessageCount++;
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

  private _onClose(code: number, reason: string): void {
    // Reject all pending calls
    for (const [, pending] of this._pendingCalls) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error(`Connection closed (${code}: ${reason})`));
    }
    this._pendingCalls.clear();
    this._pendingResponses.clear();

    if (this._state !== CLOSING) {
      // Unexpected close — attempt reconnect
      this._state = CLOSED;
      this.emit("close", { code, reason });

      if (
        this._options.reconnect &&
        this._reconnectAttempt < this._options.maxReconnects
      ) {
        this._scheduleReconnect();
      }
    } else {
      this._state = CLOSED;
      // close() handles the emit
    }
  }

  // ─── Internal: Reconnection ──────────────────────────────────

  private _scheduleReconnect(): void {
    this._reconnectAttempt++;

    // Exponential backoff with jitter
    const base = this._options.backoffMin;
    const max = this._options.backoffMax;
    const delayMs = Math.min(
      max,
      base *
        Math.pow(2, this._reconnectAttempt - 1) *
        (0.5 + Math.random() * 0.5),
    );

    this.emit("reconnect", { attempt: this._reconnectAttempt, delay: delayMs });

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        this._state = CLOSED; // Reset for connect
        await this._connectInternal();
      } catch {
        if (
          this._reconnectAttempt < this._options.maxReconnects &&
          this._options.reconnect
        ) {
          this._scheduleReconnect();
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
