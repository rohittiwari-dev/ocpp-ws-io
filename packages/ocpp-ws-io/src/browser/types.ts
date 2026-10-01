/// <reference lib="dom" />

import type {
  AllMethodNames as _AllMethodNames,
  OCPPRequestType as _OCPPRequestType,
  OCPPResponseType as _OCPPResponseType,
  OCPPSendRequestType as _OCPPSendRequestType,
  SendMethodNames as _SendMethodNames,
} from "../generated/index.js";
/**
 * Browser-compatible types for ocpp-ws-io/browser.
 *
 * Re-exports shared OCPP types from the main package and defines
 * browser-specific options and event types.
 */
import type {
  AnyOCPPProtocol as _AnyOCPPProtocol,
  CallHandler as _CallHandler,
  CallOptions as _CallOptions,
  CloseOptions as _CloseOptions,
  HandlerContext as _HandlerContext,
  LoggerLike as _LoggerLike,
  LoggerLikeNotOptional as _LoggerLikeNotOptional,
  LoggingConfig as _LoggingConfig,
  OCPPCall as _OCPPCall,
  OCPPCallError as _OCPPCallError,
  OCPPCallResult as _OCPPCallResult,
  OCPPCallResultError as _OCPPCallResultError,
  OCPPMessage as _OCPPMessage,
  OCPPProtocol as _OCPPProtocol,
  OCPPSend as _OCPPSend,
  WildcardHandler as _WildcardHandler,
} from "../types.js";

// Re-export shared types
export type OCPPProtocol = _OCPPProtocol;
export type AnyOCPPProtocol = _AnyOCPPProtocol;
export type OCPPCall<T = unknown> = _OCPPCall<T>;
export type OCPPCallResult<T = unknown> = _OCPPCallResult<T>;
export type OCPPCallError = _OCPPCallError;
export type OCPPCallResultError = _OCPPCallResultError;
export type OCPPSend<T = unknown> = _OCPPSend<T>;
export type OCPPMessage<T = unknown> = _OCPPMessage<T>;
export type HandlerContext<T = unknown> = _HandlerContext<T>;
export type CallHandler<TParams = unknown, TResult = unknown> = _CallHandler<
  TParams,
  TResult
>;
export type WildcardHandler = _WildcardHandler;
export type CallOptions = _CallOptions;
export type CloseOptions = _CloseOptions;
export type LoggerLike = _LoggerLike;
export type LoggerLikeNotOptional = _LoggerLikeNotOptional;
export type LoggingConfig = _LoggingConfig;
export type AllMethodNames<V extends OCPPProtocol> = _AllMethodNames<V>;
export type OCPPRequestType<
  V extends OCPPProtocol,
  M extends AllMethodNames<V>,
> = _OCPPRequestType<V, M>;
export type OCPPResponseType<
  V extends OCPPProtocol,
  M extends AllMethodNames<V>,
> = _OCPPResponseType<V, M>;
export type SendMethodNames<V extends OCPPProtocol> = _SendMethodNames<V>;
export type OCPPSendRequestType<
  V extends OCPPProtocol,
  M extends string,
> = _OCPPSendRequestType<V, M>;

// Re-export value types from the main package (these are browser-safe constants)
export { ConnectionState, MessageType, NOREPLY } from "../types.js";

// ─── Browser Client Options ─────────────────────────────────────

export interface BrowserClientOptions {
  /** Unique identity for this client (charging station ID) */
  identity: string;
  /** WebSocket endpoint URL (ws:// or wss://) */
  endpoint: string;
  /** OCPP subprotocols to negotiate */
  protocols?: string[];
  /** Additional query parameters */
  query?: Record<string, string>;
  /** Enable automatic reconnection (default: true) */
  reconnect?: boolean;
  /** Maximum reconnection attempts (default: Infinity) */
  maxReconnects?: number;
  /**
   * Reconnect back-off before the first attempt, in ms (default: 1000). It
   * doubles after every failed attempt, up to `backoffMax`, and every wait
   * gets a new random addition of up to 25%, so it never drops below this.
   */
  backoffMin?: number;
  /**
   * Where the doubling back-off stops growing, in ms (default: 30000). The
   * random addition of up to 25% still applies on top of it.
   */
  backoffMax?: number;
  /** Call timeout in ms (default: 30000) */
  callTimeoutMs?: number;
  /** Maximum concurrent outbound calls (default: 1) */
  callConcurrency?: number;
  /**
   * Bad messages in a row before closing (default: 50). A valid message resets the count.
   * @see Node `ClientOptions.maxBadMessages` for full documentation.
   */
  maxBadMessages?: number;
  /**
   * Counting window in ms for a run of bad messages (default: undefined = no time limit).
   * @see Node `ClientOptions.badMessageWindowMs` for full documentation.
   */
  badMessageWindowMs?: number;
  /** Include error details in responses (default: false) */
  respondWithDetailedErrors?: boolean;
  /**
   * Logging configuration.
   * - `undefined` / not set → uses `console` as default logger
   * - `false` → logging disabled entirely
   * - `LoggingConfig` → custom configuration (use `handler` for custom logger)
   */
  logging?: LoggingConfig | false;
}

// ─── Browser Client Events ──────────────────────────────────────

export interface BrowserClientEvents {
  open: [Event];
  close: [{ code: number; reason: string }];
  disconnect: [{ code: number; reason: string }];
  error: [Event | Error];
  connecting: [{ url: string }];
  reconnect: [{ attempt: number; delay: number }];
  message: [OCPPMessage];
  call: [OCPPCall];
  callResult: [OCPPCallResult];
  callError: [OCPPCallError];
  /** OCPP 2.1: the peer could not process a CALLRESULT this side sent. */
  callResultError: [OCPPCallResultError];
  badMessage: [{ message: string; error: Error }];
  [key: string]: unknown[];
}
