/**
 * @module voltlog
 *
 * OCPP-aware structured logger — lightweight, type-safe, framework-agnostic.
 *
 * Works as a standalone package or via `ocpp-ws-io/logger` re-export.
 *
 * @example Standalone
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
 * @example With ocpp-ws-io
 * ```ts
 * import { createLogger, prettyTransport } from 'ocpp-ws-io/logger';
 * ```
 *
 * @example OCPP exchange logging
 * ```ts
 * import { createLogger, prettyTransport, ocppMiddleware } from 'voltlog';
 * import type { OcppExchangeMeta } from 'voltlog';
 *
 * const logger = createLogger<OcppExchangeMeta>({
 *   transports: [prettyTransport()],
 *   middleware: [ocppMiddleware()],
 * });
 *
 * const cpLog = logger.child({ chargePointId: 'CP-101' });
 * cpLog.info('Message received', {
 *   action: 'BootNotification',
 *   messageType: 'CALL',
 *   direction: 'IN',
 * });
 * // ⚡ CP-101  →  BootNotification  [IN]  CALL
 * ```
 *
 * @example Alerting
 * ```ts
 * import { createLogger, consoleTransport, alertMiddleware } from 'voltlog';
 *
 * const logger = createLogger({
 *   transports: [consoleTransport()],
 *   middleware: [
 *     alertMiddleware([
 *       {
 *         name: 'error-spike',
 *         when: (e) => e.level >= 50,
 *         threshold: 10,
 *         windowMs: 60_000,
 *         onAlert: (entries) => sendEmail({ subject: `${entries.length} errors` }),
 *       },
 *     ]),
 *   ],
 * });
 * ```
 *
 * @example Webhook for AI/automation
 * ```ts
 * import { createLogger, webhookTransport } from 'voltlog';
 *
 * const logger = createLogger({
 *   transports: [
 *     webhookTransport({
 *       url: 'https://api.example.com/logs',
 *       batchSize: 50,
 *       flushIntervalMs: 5000,
 *     }),
 *   ],
 * });
 * ```
 *
 * @example Custom transformer (save to database)
 * ```ts
 * import { createLogger } from 'voltlog';
 * import type { Transformer } from 'voltlog';
 *
 * const dbTransformer: Transformer = {
 *   name: 'postgres',
 *   async transform(entry) {
 *     await db.insert('logs', entry);
 *   },
 * };
 *
 * const logger = createLogger({ transports: [dbTransformer] });
 * ```
 */

// ─── Core ────────────────────────────────────────────────────────
export { createLogger } from "./core/logger.js";

// ─── Types ───────────────────────────────────────────────────────
export {
  LogLevel,
  LogLevelNameMap,
  LogLevelValueMap,
  type LogLevelName,
  type LogLevelValue,
  type LogEntry,
  type LogError,
  type OcppExchangeMeta,
  type Transformer,
  type LogMiddleware,
  type AlertRule,
  type LoggerOptions,
  type Logger,
} from "./core/types.js";

// ─── Level Utilities ─────────────────────────────────────────────
export { resolveLevel, shouldLog, shouldIncludeStack } from "./core/levels.js";

// ─── Middleware ──────────────────────────────────────────────────
export {
  redactionMiddleware,
  type RedactionOptions,
} from "./middleware/redaction.js";
export {
  samplingMiddleware,
  type SamplingOptions,
} from "./middleware/sampling.js";
export {
  ocppMiddleware,
  type OcppMiddlewareOptions,
} from "./middleware/ocpp.js";
export { alertMiddleware } from "./middleware/alert.js";

// ─── Transformers ────────────────────────────────────────────────
export {
  consoleTransport,
  type ConsoleTransportOptions,
} from "./transformers/console.js";
export {
  prettyTransport,
  type PrettyTransportOptions,
} from "./transformers/pretty.js";
export {
  jsonStreamTransport,
  type JsonStreamTransportOptions,
} from "./transformers/json-stream.js";
export {
  webhookTransport,
  type WebhookTransportOptions,
} from "./transformers/webhook.js";
export {
  batchTransport,
  type BatchTransportOptions,
} from "./transformers/batch.js";
export {
  redisTransport,
  type RedisTransportOptions,
  type RedisClient,
} from "./transformers/redis.js";
