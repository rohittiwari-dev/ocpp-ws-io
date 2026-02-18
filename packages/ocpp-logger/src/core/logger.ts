/**
 * @module voltlog
 * @description Core Logger class — zero external dependencies (only cuid2), runtime-agnostic.
 *
 * @example Basic usage
 * ```ts
 * import { createLogger, consoleTransport } from 'voltlog';
 *
 * const logger = createLogger({
 *   level: 'INFO',
 *   transports: [consoleTransport()],
 * });
 *
 * logger.info('Server started', { port: 9000 });
 * ```
 *
 * @example Child logger with bound context
 * ```ts
 * const cpLogger = logger.child({ chargePointId: 'CP-101' });
 * cpLogger.info('BootNotification received');
 * // → auto-includes context: { chargePointId: 'CP-101' }
 * ```
 *
 * @example Error with stack trace
 * ```ts
 * logger.error('Connection failed', new Error('ETIMEDOUT'));
 * logger.error('Handler crashed', { action: 'BootNotification' }, new Error('null ref'));
 * ```
 *
 * @example With ocpp-ws-io (if user has both packages)
 * ```ts
 * import { createLogger } from 'ocpp-ws-io/logger'; // re-export
 * ```
 */

import { createId } from "@paralleldrive/cuid2";
import { resolveLevel, shouldLog, shouldIncludeStack } from "./levels.js";
import { composeMiddleware, fanOutToTransformers } from "./pipeline.js";
import type {
  LogEntry,
  LogError,
  Logger,
  LoggerOptions,
  LogLevelName,
  LogMiddleware,
  Transformer,
} from "./types.js";

// ─── Logger Implementation ──────────────────────────────────────

class LoggerImpl<TMeta = Record<string, unknown>> implements Logger<TMeta> {
  private _level: number;
  private _transports: Transformer<TMeta>[];
  private _middlewareList: LogMiddleware<TMeta>[];
  private _pipeline: (entry: LogEntry<TMeta>) => void;
  private _context: Record<string, unknown>;
  private _includeStack: boolean | LogLevelName;
  private _timestampFn: () => number;

  constructor(options: LoggerOptions<TMeta> = {}) {
    this._level = resolveLevel(options.level ?? "INFO");
    this._transports = [...(options.transports ?? [])];
    this._middlewareList = [...(options.middleware ?? [])];
    this._context = options.context ? { ...options.context } : {};
    this._includeStack = options.includeStack ?? "ERROR";
    this._timestampFn = options.timestamp ?? Date.now;
    this._pipeline = this._buildPipeline();
  }

  // ─── Log Methods ────────────────────────────────────────────

  trace(message: string, meta?: Partial<TMeta>): void {
    this._log(10, "TRACE", message, meta);
  }

  debug(message: string, meta?: Partial<TMeta>): void {
    this._log(20, "DEBUG", message, meta);
  }

  info(message: string, meta?: Partial<TMeta>): void {
    this._log(30, "INFO", message, meta);
  }

  warn(message: string, meta?: Partial<TMeta>): void {
    this._log(40, "WARN", message, meta);
  }

  error(
    message: string,
    metaOrError?: Partial<TMeta> | Error,
    error?: Error,
  ): void {
    if (metaOrError instanceof Error) {
      this._log(50, "ERROR", message, undefined, metaOrError);
    } else {
      this._log(50, "ERROR", message, metaOrError, error);
    }
  }

  fatal(
    message: string,
    metaOrError?: Partial<TMeta> | Error,
    error?: Error,
  ): void {
    if (metaOrError instanceof Error) {
      this._log(60, "FATAL", message, undefined, metaOrError);
    } else {
      this._log(60, "FATAL", message, metaOrError, error);
    }
  }

  // ─── Child Logger ───────────────────────────────────────────

  child(context: Record<string, unknown>): Logger<TMeta> {
    return new ChildLoggerImpl<TMeta>(this, { ...this._context, ...context });
  }

  // ─── Dynamic Configuration ─────────────────────────────────

  addTransformer(transformer: Transformer<TMeta>): void {
    this._transports.push(transformer);
  }

  removeTransformer(name: string): void {
    this._transports = this._transports.filter((t) => t.name !== name);
  }

  addMiddleware(middleware: LogMiddleware<TMeta>): void {
    this._middlewareList.push(middleware);
    this._pipeline = this._buildPipeline();
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  async flush(): Promise<void> {
    await Promise.all(this._transports.map((t) => t.flush?.()).filter(Boolean));
  }

  async close(): Promise<void> {
    await this.flush();
    await Promise.all(this._transports.map((t) => t.close?.()).filter(Boolean));
  }

  // ─── Internal ───────────────────────────────────────────────

  /** @internal */
  _log(
    level: number,
    levelName: string,
    message: string,
    meta?: Partial<TMeta>,
    error?: Error,
  ): void {
    this._logWithContext(level, levelName, message, this._context, meta, error);
  }

  /** @internal — used by child loggers to inject bound context */
  _logWithContext(
    level: number,
    levelName: string,
    message: string,
    context: Record<string, unknown>,
    meta?: Partial<TMeta>,
    error?: Error,
  ): void {
    if (!shouldLog(level, this._level)) return;

    const entry: LogEntry<TMeta> = {
      id: createId(),
      level,
      levelName: levelName as LogLevelName,
      message,
      timestamp: this._timestampFn(),
      meta: (meta ?? {}) as TMeta,
      context: Object.keys(context).length > 0 ? context : undefined,
    };

    if (error) {
      const logError: LogError = {
        message: error.message,
        name: error.name,
        code: (error as NodeJS.ErrnoException).code,
      };
      if (shouldIncludeStack(level, this._includeStack)) {
        logError.stack = error.stack;
      }
      entry.error = logError;
    }

    this._pipeline(entry);
  }

  private _buildPipeline(): (entry: LogEntry<TMeta>) => void {
    return composeMiddleware(this._middlewareList, (entry) => {
      fanOutToTransformers(entry, this._transports, this._level);
    });
  }
}

// ─── Child Logger ────────────────────────────────────────────────

class ChildLoggerImpl<
  TMeta = Record<string, unknown>,
> implements Logger<TMeta> {
  constructor(
    private _parent: LoggerImpl<TMeta>,
    private _context: Record<string, unknown>,
  ) {}

  trace(message: string, meta?: Partial<TMeta>): void {
    this._parent._logWithContext(10, "TRACE", message, this._context, meta);
  }
  debug(message: string, meta?: Partial<TMeta>): void {
    this._parent._logWithContext(20, "DEBUG", message, this._context, meta);
  }
  info(message: string, meta?: Partial<TMeta>): void {
    this._parent._logWithContext(30, "INFO", message, this._context, meta);
  }
  warn(message: string, meta?: Partial<TMeta>): void {
    this._parent._logWithContext(40, "WARN", message, this._context, meta);
  }
  error(
    message: string,
    metaOrError?: Partial<TMeta> | Error,
    error?: Error,
  ): void {
    if (metaOrError instanceof Error) {
      this._parent._logWithContext(
        50,
        "ERROR",
        message,
        this._context,
        undefined,
        metaOrError,
      );
    } else {
      this._parent._logWithContext(
        50,
        "ERROR",
        message,
        this._context,
        metaOrError,
        error,
      );
    }
  }
  fatal(
    message: string,
    metaOrError?: Partial<TMeta> | Error,
    error?: Error,
  ): void {
    if (metaOrError instanceof Error) {
      this._parent._logWithContext(
        60,
        "FATAL",
        message,
        this._context,
        undefined,
        metaOrError,
      );
    } else {
      this._parent._logWithContext(
        60,
        "FATAL",
        message,
        this._context,
        metaOrError,
        error,
      );
    }
  }

  child(context: Record<string, unknown>): Logger<TMeta> {
    return new ChildLoggerImpl<TMeta>(this._parent, {
      ...this._context,
      ...context,
    });
  }

  addTransformer(transformer: Transformer<TMeta>): void {
    this._parent.addTransformer(transformer);
  }
  removeTransformer(name: string): void {
    this._parent.removeTransformer(name);
  }
  addMiddleware(middleware: LogMiddleware<TMeta>): void {
    this._parent.addMiddleware(middleware);
  }
  flush(): Promise<void> {
    return this._parent.flush();
  }
  close(): Promise<void> {
    return this._parent.close();
  }
}

// ─── Factory ─────────────────────────────────────────────────────

/**
 * Create a new logger instance.
 *
 * @example Minimal
 * ```ts
 * const logger = createLogger();
 * logger.info('Hello');
 * ```
 *
 * @example Full options
 * ```ts
 * import { createLogger, consoleTransport, prettyTransport } from 'voltlog';
 *
 * const logger = createLogger({
 *   level: 'DEBUG',
 *   transports: [prettyTransport()],
 *   redact: ['password', 'idToken'],
 *   includeStack: 'ERROR',
 * });
 * ```
 *
 * @example OCPP-aware with child loggers
 * ```ts
 * import { createLogger, prettyTransport } from 'voltlog';
 * import type { OcppExchangeMeta } from 'voltlog';
 *
 * const logger = createLogger<OcppExchangeMeta>({
 *   level: 'INFO',
 *   transports: [prettyTransport()],
 * });
 *
 * // Per-connection child logger
 * const cpLog = logger.child({ chargePointId: 'CP-101' });
 * cpLog.info('OCPP message', {
 *   messageType: 'CALL',
 *   action: 'BootNotification',
 *   direction: 'IN',
 * });
 * ```
 */
export function createLogger<TMeta = Record<string, unknown>>(
  options?: LoggerOptions<TMeta>,
): Logger<TMeta> {
  return new LoggerImpl<TMeta>(options);
}
