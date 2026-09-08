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
   * Redact inbound payloads. (default: true)
   *
   * The redacted value is what your handlers receive, since they read the same
   * payload — see the caveat on the plugin itself.
   */
  incoming?: boolean;

  /**
   * Redact outbound payloads. (default: **false**)
   *
   * ⚠️ **This changes what is transmitted to the charge point, not just what is
   * logged.** The wire message is built from the payload after middleware has
   * run — deliberately, since a middleware transforming outbound calls is a
   * supported feature — so redacting here sends the replacement string to the
   * charger. With `idTag` among `sensitiveKeys`, a `RemoteStartTransaction`
   * arrives carrying `"***REDACTED***"` as the tag and the charge point tries
   * to authorize that, which is not a logging problem but a broken command.
   *
   * It defaulted to `true` up to and including v2.3.1, which silently broke
   * remote start for anyone redacting `idTag` — the very key the examples used.
   *
   * Leave it off and redact at the sink instead: a broker plugin's
   * `includePayload`, or your logger. Enable it only when every key in
   * `sensitiveKeys` is one the charge point does not need to act on.
   */
  outgoing?: boolean;
}

/**
 * Redacts sensitive Personally Identifiable Information (PII) from message payloads.
 *
 * As a Level 4 (Middleware) plugin, this executes directly in the message processing chain.
 * It recursively scans and masks sensitive fields (e.g., `idTag`, `password`), replacing
 * the context payload with a redacted deep clone. Handlers, downstream plugins and
 * observability tools all read that clone, so the real value stops there.
 *
 * ⚠️ **This redacts the payload itself, not a copy taken for logging.** Whatever
 * reads the payload after the redactor sees the replacement, which is the point on
 * the way in and a hazard on the way out:
 *
 * - **Inbound** — your handlers receive the redacted value. Redacting `idTag` means
 *   an `Authorize` handler cannot see the tag it is meant to authorize, so either
 *   set `incoming: false` or leave such keys out of `sensitiveKeys`.
 * - **Outbound** — `outgoing` is off by default because enabling it changes what is
 *   *transmitted*: the wire message is built after middleware runs, so a redacted
 *   `idTag` is sent to the charge point as `"***REDACTED***"` and the command fails.
 *   This applies to responses as well as commands — a redacted `idTagInfo` in an
 *   `Authorize` result tells the charger the wrong thing about the driver.
 *
 * ⚠️ **Coverage:** redaction reaches the payload-bearing phases of the middleware
 * chain — inbound and outbound CALL, inbound CALLRESULT / CALLERROR, and outbound
 * CALLRESULT. A CALLERROR this server sends is **not** covered: its `details` object
 * is not part of the middleware context, so a broker plugin running `includePayload`
 * receives those verbatim. Redact them at the sink.
 *
 * @example
 * ```ts
 * // Keys the charge point never needs to act on.
 * server.plugin(piiRedactorPlugin({
 *   sensitiveKeys: ['password', 'authorizationKey'],
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
  // Off by default: redacting here alters what reaches the charge point, not
  // just what is logged. See the option's documentation.
  const outgoing = options.outgoing ?? false;

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
      } else if (ctx.type === "incoming_error" && ctx.error) {
        // A CALLERROR carries its detail object in the last slot, which is
        // where a peer would echo back whatever it objected to.
        const [kind, id, code, description, details] = ctx.error;
        ctx.error = [
          kind,
          id,
          code,
          description,
          redact(details) as Record<string, unknown>,
        ];
      }
    }

    // 2. Redact Outgoing Before Processing
    if (outgoing) {
      if (ctx.type === "outgoing_call" && ctx.params) {
        ctx.params = redact(ctx.params);
      } else if (ctx.type === "outgoing_result" && ctx.payload) {
        // Reached since outgoing_result was wired into the chain. Like the
        // outbound CALL above, this redacts the response *on the wire*, not a
        // logging copy — which is why `outgoing` defaults to false.
        //
        // outgoing_error is deliberately absent: its context carries only
        // errorCode and errorDescription, both protocol-defined strings with
        // nothing to redact. The `details` object, which could carry PII, is
        // not part of the context.
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
