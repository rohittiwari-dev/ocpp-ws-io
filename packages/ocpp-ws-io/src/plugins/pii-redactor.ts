import type { MiddlewareFunction } from "../middleware.js";
import type { MiddlewareContext, OCPPPlugin } from "../types.js";

export interface PiiRedactorOptions {
  /**
   * **Required.** List of object keys to redact (matched recursively, at any
   * depth). There is no default — you must explicitly list every key to redact,
   * so nothing is ever scrubbed by accident.
   *
   * ⚠️ **Redaction mutates the live payload, not just logs.** If you list a key
   * here that your handlers need on an **incoming** message (e.g. `idTag` for
   * `Authorize` / `StartTransaction`), the handler will receive the redacted
   * placeholder and cannot use the real value. Either set `incoming: false`, or
   * don't include such keys, when you need the value at the handler.
   *
   * @example ["password", "authorizationKey", "token"]
   */
  sensitiveKeys: string[];

  /**
   * The replacement string to use for redacted values.
   * @default "***REDACTED***"
   */
  replacement?: string;

  /**
   * Enable/disable redaction for incoming messages.
   * @default true
   */
  incoming?: boolean;

  /**
   * Enable/disable redaction for outgoing messages.
   * @default true
   */
  outgoing?: boolean;
}

/**
 * Redacts sensitive Personally Identifiable Information (PII) from message payloads.
 *
 * As a Level 4 (Middleware) plugin, this executes directly in the message processing chain.
 * It recursively scans and masks sensitive fields (e.g., `idTag`, `password`) in both
 * incoming and outgoing payloads. Because it mutates the payload inline, the redacted
 * data will be what application handlers, downstream plugins, and observability tools see.
 *
 * ⚠️ **Caveat:** because it mutates the live payload (not a logging copy), redacting a
 * key on **incoming** messages also hides it from your handlers. The default
 * `sensitiveKeys` includes `idTag` — if your handlers authorize by `idTag`
 * (`Authorize`, `StartTransaction`), either pass `incoming: false` or drop `idTag`
 * from `sensitiveKeys` so the handler still receives the real value.
 *
 * @example
 * ```ts
 * server.plugin(piiRedactorPlugin({
 *   sensitiveKeys: ['idTag', 'password', 'authorizationKey'],
 *   replacement: '[HIDDEN]'
 * }));
 * ```
 */
export function piiRedactorPlugin(options: PiiRedactorOptions): OCPPPlugin {
  // Strict: callers must explicitly list the keys to redact. No defaults — this
  // prevents accidentally redacting a field your handlers rely on (e.g. idTag).
  if (
    !options ||
    !Array.isArray(options.sensitiveKeys) ||
    options.sensitiveKeys.length === 0
  ) {
    throw new Error(
      "piiRedactorPlugin requires a non-empty 'sensitiveKeys' array — explicitly " +
        "list the keys to redact, e.g. piiRedactorPlugin({ sensitiveKeys: ['password', 'authorizationKey'] }).",
    );
  }

  const keys = new Set(options.sensitiveKeys);
  const replacement = options.replacement ?? "***REDACTED***";
  const incoming = options.incoming ?? true;
  const outgoing = options.outgoing ?? true;

  /**
   * Recursively clones and redacts an object.
   * Uses deep cloning so original objects (if any) are protected,
   * but the middleware context will use this new redacted object.
   */
  function redact(obj: unknown): unknown {
    if (!obj || typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
      return obj.map(redact);
    }

    const redactedOutput: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (keys.has(k)) {
        redactedOutput[k] = replacement;
      } else if (v && typeof v === "object") {
        redactedOutput[k] = redact(v);
      } else {
        redactedOutput[k] = v;
      }
    }
    return redactedOutput;
  }

  const redactorMiddleware: MiddlewareFunction<MiddlewareContext> = async (
    ctx,
    next,
  ) => {
    // 1. Redact Incoming Before Processing
    if (incoming) {
      if (ctx.type === "incoming_call" && ctx.params) {
        ctx.params = redact(ctx.params);
      } else if (ctx.type === "incoming_result" && ctx.payload) {
        ctx.payload = redact(ctx.payload);
      }
    }

    // 2. Redact Outgoing Before Processing
    if (outgoing) {
      if (ctx.type === "outgoing_call" && ctx.params) {
        ctx.params = redact(ctx.params);
      } else if (ctx.type === "outgoing_result" && ctx.payload) {
        ctx.payload = redact(ctx.payload);
      }
    }

    // 3. Execute Next Handlers
    await next();
  };

  return {
    name: "pii-redactor",

    onConnection(client) {
      // Inject middleware directly into the client's processing stack
      client.use(redactorMiddleware);
    },
  };
}
