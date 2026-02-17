import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { setTimeout as setTimeoutCb } from "node:timers";
import WebSocket from "ws";

import {
  ConnectionState,
  SecurityProfile,
  MessageType,
  NOREPLY,
  type ClientOptions,
  type CloseOptions,
  type CallOptions,
  type CallHandler,
  type WildcardHandler,
  type HandlerContext,
  type OCPPCall,
  type OCPPCallResult,
  type OCPPCallError,
  type OCPPMessage,
} from "./types.js";
import {
  TimeoutError,
  UnexpectedHttpResponse,
  RPCGenericError,
  RPCMessageTypeNotSupportedError,
  type RPCError,
} from "./errors.js";
import {
  createRPCError,
  getErrorPlainObject,
  getPackageIdent,
} from "./util.js";
import { Queue } from "./queue.js";
import type { Validator } from "./validator.js";
import { standardValidators } from "./standard-validators.js";

const { CONNECTING, OPEN, CLOSING, CLOSED } = ConnectionState;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeoutCb>;
  abortHandler?: () => void;
}

/**
 * OCPPClient — A typed WebSocket RPC client for OCPP communication.
 *
 * Supports all 3 OCPP Security Profiles:
 * - Profile 1: Basic Auth over unsecured WS
 * - Profile 2: TLS + Basic Auth
 * - Profile 3: Mutual TLS (client certificates)
 */
export class OCPPClient extends EventEmitter {
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
  private _pingTimer: ReturnType<typeof setTimeoutCb> | null = null;
  private _closePromise: Promise<{ code: number; reason: string }> | null =
    null;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeoutCb> | null = null;
  private _badMessageCount = 0;
  private _lastActivity = 0;
  private _validators: Validator[] = [];
  private _strictProtocols: string[] | null = null;
  protected _handshake: unknown = null;

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

    // Set up strict mode validators
    if (this._options.strictMode) {
      this._setupValidators();
    }
  }

  // ─── Getters ─────────────────────────────────────────────────

  get identity(): string {
    return this._identity;
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
        this._attachWebsocket(ws);
        this._startPing();

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
        this._ws.close(code, reason);
      }
    });
  }

  // ─── Handle ──────────────────────────────────────────────────

  handle<TParams = unknown, TResult = unknown>(
    methodOrHandler: string | WildcardHandler,
    handler?: CallHandler<TParams, TResult>,
  ): void {
    if (typeof methodOrHandler === "function") {
      this._wildcardHandler = methodOrHandler;
    } else if (typeof methodOrHandler === "string" && handler) {
      this._handlers.set(methodOrHandler, handler as CallHandler);
    } else {
      throw new Error(
        "Invalid arguments: provide (method, handler) or (wildcardHandler)",
      );
    }
  }

  removeHandler(method?: string): void {
    if (method) {
      this._handlers.delete(method);
    } else {
      this._wildcardHandler = null;
    }
  }

  removeAllHandlers(): void {
    this._handlers.clear();
    this._wildcardHandler = null;
  }

  // ─── Call ────────────────────────────────────────────────────

  async call<TResult = unknown>(
    method: string,
    params: unknown = {},
    options: CallOptions = {},
  ): Promise<TResult> {
    if (this._state !== OPEN) {
      throw new Error(`Cannot call: client is in state ${this._state}`);
    }

    return this._callQueue.push(() =>
      this._sendCall<TResult>(method, params, options),
    );
  }

  private async _sendCall<TResult>(
    method: string,
    params: unknown,
    options: CallOptions,
  ): Promise<TResult> {
    const msgId = randomUUID();
    const timeoutMs = options.timeoutMs ?? this._options.callTimeoutMs;

    // Strict mode: validate outbound call
    if (this._options.strictMode && this._protocol) {
      this._validateOutbound(method, params, "req");
    }

    const message: OCPPCall = [MessageType.CALL, msgId, method, params];
    const messageStr = JSON.stringify(message);

    return new Promise<TResult>((resolve, reject) => {
      const timeoutHandle = setTimeoutCb(() => {
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

      let handler = this._handlers.get(method);
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

      // Strict mode: validate inbound call params
      if (this._options.strictMode && this._protocol) {
        this._validateInbound(method, params, "req");
      }

      this._pendingResponses.add(msgId);

      const ac = new AbortController();
      const context: HandlerContext = {
        messageId: msgId,
        method,
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

      // Strict mode: validate outbound response
      if (this._options.strictMode && this._protocol) {
        this._validateOutbound(method, result, "conf");
      }

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
    if (pending.abortHandler) {
      // Remove abort listener
    }
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

    if (this._badMessageCount >= this._options.maxBadMessages) {
      this.close({ code: 1002, reason: "Too many bad messages" }).catch(
        () => {},
      );
    }
  }

  // ─── Internal: Close handling ────────────────────────────────

  private _onClose(code: number, reason: Buffer): void {
    this._stopPing();
    const reasonStr = reason.toString();

    // Reject all pending calls
    for (const [, pending] of this._pendingCalls) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error(`Connection closed (${code}: ${reasonStr})`));
    }
    this._pendingCalls.clear();
    this._pendingResponses.clear();

    if (this._state !== CLOSING) {
      // Unexpected close — attempt reconnect
      this._state = CLOSED;
      this.emit("close", { code, reason: reasonStr });

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

    this._reconnectTimer = setTimeoutCb(async () => {
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

  // ─── Internal: Ping/Pong ─────────────────────────────────────

  private _startPing(): void {
    if (this._options.pingIntervalMs <= 0) return;

    const doPing = () => {
      if (this._state !== OPEN || !this._ws) return;

      if (this._options.deferPingsOnActivity) {
        const elapsed = Date.now() - this._lastActivity;
        if (elapsed < this._options.pingIntervalMs) {
          this._pingTimer = setTimeoutCb(
            doPing,
            this._options.pingIntervalMs - elapsed,
          );
          return;
        }
      }

      this._ws.ping();
      this._pingTimer = setTimeoutCb(doPing, this._options.pingIntervalMs);
    };

    this._pingTimer = setTimeoutCb(doPing, this._options.pingIntervalMs);
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
      opts.headers!["Authorization"] = `Basic ${credentials}`;
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
    this._closePromise = null;
    this._ws = null;
  }
}
