/**
 * @module voltlog
 * @description Type definitions for the OCPP-aware structured logger.
 */

// ─── Log Levels ──────────────────────────────────────────────────

export const LogLevel = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60,
  SILENT: Infinity,
} as const;

export type LogLevelName = keyof typeof LogLevel;

/** Numeric log level value */
export type LogLevelValue = (typeof LogLevel)[LogLevelName];

/** Map from level name (lowercase) to numeric value */
export const LogLevelNameMap: Record<string, number> = Object.fromEntries(
  Object.entries(LogLevel).map(([k, v]) => [k.toLowerCase(), v]),
);

/** Map from numeric value to level name */
export const LogLevelValueMap: Record<number, LogLevelName> =
  Object.fromEntries(
    Object.entries(LogLevel)
      .filter(([, v]) => Number.isFinite(v))
      .map(([k, v]) => [v, k as LogLevelName]),
  ) as Record<number, LogLevelName>;

// ─── Log Entry ───────────────────────────────────────────────────

export interface LogEntry<TMeta = Record<string, unknown>> {
  /** Unique log ID (cuid2) */
  id: string;
  /** Numeric log level */
  level: number;
  /** Human-readable level name */
  levelName: LogLevelName;
  /** Log message */
  message: string;
  /** Unix epoch timestamp (ms) */
  timestamp: number;
  /** User-defined structured metadata (type-safe via generics) */
  meta: TMeta;
  /** Bound context from child logger (e.g. chargePointId, sessionId) */
  context?: Record<string, unknown>;
  /** Correlation ID for tracing across async operations */
  correlationId?: string;
  /** Error information */
  error?: LogError;
}

export interface LogError {
  message: string;
  stack?: string;
  code?: string;
  name?: string;
}

// ─── OCPP Exchange Meta ──────────────────────────────────────────

export interface OcppExchangeMeta {
  /** Charge point / station identity */
  chargePointId?: string;
  /** OCPP message type */
  messageType?: "CALL" | "CALLRESULT" | "CALLERROR";
  /** OCPP action name (e.g. BootNotification) */
  action?: string;
  /** Message direction */
  direction?: "IN" | "OUT";
  /** Correlation ID for request/response matching */
  correlationId?: string;
  /** Negotiated OCPP protocol version */
  protocol?: string;
  /** Serialized payload size in bytes */
  payloadSize?: number;
  /** Latency in milliseconds */
  latencyMs?: number;
  /** Response status (e.g. Accepted, Rejected) */
  status?: string;
}

// ─── Transformer ─────────────────────────────────────────────────

/**
 * A Transformer receives formatted log entries and delivers them
 * to a destination (console, file, webhook, database, etc.).
 *
 * Transformers are async-safe — `transform()` can return a Promise.
 */
export interface Transformer<TMeta = Record<string, unknown>> {
  /** Unique name for this transformer */
  name: string;
  /** Optional per-transformer level filter */
  level?: LogLevelName;
  /** Process a log entry */
  transform(entry: LogEntry<TMeta>): void | Promise<void>;
  /** Flush any buffered entries */
  flush?(): void | Promise<void>;
  /** Graceful shutdown */
  close?(): void | Promise<void>;
}

// ─── Middleware ───────────────────────────────────────────────────

/**
 * Middleware intercepts log entries before they reach transformers.
 * Used for redaction, sampling, enrichment, alerting, etc.
 *
 * Call `next(entry)` to continue the pipeline.
 * Omit `next()` to drop the entry (e.g. sampling).
 */
export type LogMiddleware<TMeta = Record<string, unknown>> = (
  entry: LogEntry<TMeta>,
  next: (entry: LogEntry<TMeta>) => void,
) => void;

// ─── Alert Rule ──────────────────────────────────────────────────

/**
 * Alert rules evaluate log entries and fire callbacks
 * when configurable conditions are met.
 */
export interface AlertRule<TMeta = Record<string, unknown>> {
  /** Alert name (for identification) */
  name: string;
  /** Condition — return true if this entry should count toward the alert */
  when: (entry: LogEntry<TMeta>) => boolean;
  /** Number of matching entries required to fire (default: 1) */
  threshold?: number;
  /** Time window in ms for threshold counting */
  windowMs?: number;
  /** Minimum cooldown in ms between alert firings (default: 0) */
  cooldownMs?: number;
  /** Callback fired when alert conditions are met */
  onAlert: (entries: LogEntry<TMeta>[]) => void | Promise<void>;
}

// ─── Logger Options ──────────────────────────────────────────────

export interface LoggerOptions<TMeta = Record<string, unknown>> {
  /** Minimum log level (default: INFO) */
  level?: LogLevelName;
  /** Transformers for log output */
  transports?: Transformer<TMeta>[];
  /** Middleware pipeline */
  middleware?: LogMiddleware<TMeta>[];
  /** Alert rules */
  alerts?: AlertRule<TMeta>[];
  /** Default bound context for all log entries */
  context?: Record<string, unknown>;
  /** Field paths to auto-redact (e.g. ['idToken', 'password']) */
  redact?: string[];
  /**
   * When to include error stack traces:
   * - `true` — always include
   * - `false` — never include
   * - `LogLevelName` — include at this level and above
   * Default: 'ERROR'
   */
  includeStack?: boolean | LogLevelName;
  /**
   * Exchange log mode:
   * - `true` — exchange logs alongside normal logs
   * - `'only'` — only exchange-formatted logs
   * - `false` — disabled (default)
   */
  exchangeLog?: boolean | "only";
  /** Custom timestamp function (default: Date.now) */
  timestamp?: () => number;
}

// ─── Logger Interface ────────────────────────────────────────────

export interface Logger<TMeta = Record<string, unknown>> {
  trace(message: string, meta?: Partial<TMeta>): void;
  debug(message: string, meta?: Partial<TMeta>): void;
  info(message: string, meta?: Partial<TMeta>): void;
  warn(message: string, meta?: Partial<TMeta>): void;
  error(
    message: string,
    metaOrError?: Partial<TMeta> | Error,
    error?: Error,
  ): void;
  fatal(
    message: string,
    metaOrError?: Partial<TMeta> | Error,
    error?: Error,
  ): void;

  /** Create a child logger with additional bound context */
  child(context: Record<string, unknown>): Logger<TMeta>;

  /** Add a transformer at runtime */
  addTransformer(transformer: Transformer<TMeta>): void;
  /** Remove a transformer by name */
  removeTransformer(name: string): void;
  /** Add middleware at runtime */
  addMiddleware(middleware: LogMiddleware<TMeta>): void;

  /** Flush all transformers */
  flush(): Promise<void>;
  /** Close all transformers gracefully */
  close(): Promise<void>;
}
