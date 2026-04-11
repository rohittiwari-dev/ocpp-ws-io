import type { MiddlewareFunction } from "../middleware.js";
import type { MiddlewareContext, OCPPPlugin } from "../types.js";

export interface PiiRedactorOptions {
  /**
   * List of object keys that should be redacted.
   * Matches ANY key in the payload recursively.
   * @default ["idTag", "authorizationKey", "token", "password", "securityCode"]
   */
  sensitiveKeys?: string[];

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
 * @example
 * ```ts
 * server.plugin(piiRedactorPlugin({
 *   sensitiveKeys: ['idTag', 'password', 'authorizationKey'],
 *   replacement: '[HIDDEN]'
 * }));
 * ```
 */
export function piiRedactorPlugin(
  options: PiiRedactorOptions = {},
): OCPPPlugin {
  const keys = new Set(
    options.sensitiveKeys ?? [
      "idTag",
      "authorizationKey",
      "token",
      "password",
      "securityCode",
    ],
  );
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
