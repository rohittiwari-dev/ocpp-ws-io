/// <reference lib="dom" />

/**
 * Browser-compatible types for ocpp-ws-io/browser.
 *
 * Re-exports shared OCPP types from the main package and defines
 * browser-specific options and event types.
 */
import type {
  OCPPProtocol as _OCPPProtocol,
  AnyOCPPProtocol as _AnyOCPPProtocol,
  OCPPCall as _OCPPCall,
  OCPPCallResult as _OCPPCallResult,
  OCPPCallError as _OCPPCallError,
  OCPPMessage as _OCPPMessage,
  HandlerContext as _HandlerContext,
  CallHandler as _CallHandler,
  WildcardHandler as _WildcardHandler,
  CallOptions as _CallOptions,
  CloseOptions as _CloseOptions,
} from "../types.js";

import type {
  AllMethodNames as _AllMethodNames,
  OCPPRequestType as _OCPPRequestType,
  OCPPResponseType as _OCPPResponseType,
} from "../generated/index.js";

// Re-export shared types
export type OCPPProtocol = _OCPPProtocol;
export type AnyOCPPProtocol = _AnyOCPPProtocol;
export type OCPPCall<T = unknown> = _OCPPCall<T>;
export type OCPPCallResult<T = unknown> = _OCPPCallResult<T>;
export type OCPPCallError = _OCPPCallError;
export type OCPPMessage<T = unknown> = _OCPPMessage<T>;
export type HandlerContext<T = unknown> = _HandlerContext<T>;
export type CallHandler<TParams = unknown, TResult = unknown> = _CallHandler<
  TParams,
  TResult
>;
export type WildcardHandler = _WildcardHandler;
export type CallOptions = _CallOptions;
export type CloseOptions = _CloseOptions;
export type AllMethodNames<V extends OCPPProtocol> = _AllMethodNames<V>;
export type OCPPRequestType<
  V extends OCPPProtocol,
  M extends AllMethodNames<V>,
> = _OCPPRequestType<V, M>;
export type OCPPResponseType<
  V extends OCPPProtocol,
  M extends AllMethodNames<V>,
> = _OCPPResponseType<V, M>;

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
  /** Back-off base delay in ms (default: 1000) */
  backoffMin?: number;
  /** Back-off max delay in ms (default: 30000) */
  backoffMax?: number;
  /** Call timeout in ms (default: 30000) */
  callTimeoutMs?: number;
  /** Maximum concurrent outbound calls (default: 1) */
  callConcurrency?: number;
  /** Max number of bad messages before closing (default: Infinity) */
  maxBadMessages?: number;
  /** Include error details in responses (default: false) */
  respondWithDetailedErrors?: boolean;
}

// ─── Browser Client Events ──────────────────────────────────────

export interface BrowserClientEvents {
  open: [Event];
  close: [{ code: number; reason: string }];
  error: [Event | Error];
  connecting: [{ url: string }];
  reconnect: [{ attempt: number; delay: number }];
  message: [OCPPMessage];
  call: [OCPPCall];
  callResult: [OCPPCallResult];
  callError: [OCPPCallError];
  badMessage: [{ message: string; error: Error }];
  [key: string]: unknown[];
}
