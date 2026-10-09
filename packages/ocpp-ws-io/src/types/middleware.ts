/** Message middleware contexts. */
import type { CallOptions } from "./calls.js";
import type { JsonValue } from "./json.js";
import type { OCPPCallError } from "./protocol.js";

// ─── Middleware ──────────────────────────────────────────────────

/**
 * What a message middleware is handed, one shape per phase of an exchange.
 *
 * Every one of these runs the chain, and a middleware selects the phases it
 * cares about by switching on `type`:
 *
 * ```ts
 * client.use(async (ctx, next) => {
 *   if (ctx.type === "outgoing_result") {
 *     ctx.payload = adapt(ctx.payload);
 *   }
 *   return next();
 * });
 * ```
 *
 * **Mutating the context changes the message.** For the four outbound-facing
 * phases the wire message is built from the context *after* the chain has run,
 * so this is transformation, not observation — which is the point for
 * something like `schemaVersioningPlugin`, and a hazard for anything meant
 * only to alter what is logged.
 *
 * **A server exchange nests.** Handling an inbound CALL runs the chain for
 * `incoming_call`, the handler runs inside it, and the response then runs the
 * chain again for `outgoing_result` (or `outgoing_error`) before being sent.
 * A middleware written in the wrapping style therefore sees:
 *
 * ```
 * in:incoming_call → in:outgoing_result → out:outgoing_result → out:incoming_call
 * ```
 *
 * so its own exchange still closes last. Keep per-invocation state on locals
 * rather than on the middleware, since one exchange enters the chain twice.
 *
 * **A middleware that throws fails open.** The message is sent as it stood and
 * the failure is logged — a broken middleware must not leave a charge point
 * waiting for a response that never arrives.
 *
 * These carry the action name, which the wire messages do not: a CALLRESULT is
 * `[3, id, payload]` and a CALLERROR is `[4, id, code, description, details]`.
 * A plugin needing to know *which* request is being answered has to work here,
 * not in `onBeforeSend`.
 */
export type MiddlewareContext =
  | {
      type: "incoming_call";
      messageId: string;
      method: string;
      params: unknown;
      protocol?: string;
      /** True for an OCPP 2.1 SEND, which is never answered. */
      unconfirmed?: boolean;
    }
  | {
      type: "outgoing_call";
      messageId: string;
      method: string;
      params: unknown;
      options: CallOptions;
      /** True for an OCPP 2.1 SEND, which expects no answer. */
      unconfirmed?: boolean;
      /**
       * Set by a middleware that puts the call in an envelope, such as a
       * signature (`signedMessagesPlugin`). It is called once every
       * middleware has run and strict mode has checked `method` and
       * `params`, and what it returns goes on the wire instead. To add an
       * envelope around one already set, call the previous `wrap` first.
       */
      wrap?: (call: WireCall) => WireCall | Promise<WireCall>;
    }
  | {
      type: "incoming_result";
      messageId: string;
      payload: unknown;
      method: string; // Correlated method name
    }
  | {
      type: "incoming_error";
      messageId: string;
      error: OCPPCallError;
      method: string; // Correlated method name
    }
  | {
      type: "outgoing_result";
      messageId: string;
      method: string;
      payload: unknown;
      /**
       * Set by a middleware that puts the reply in an envelope, such as a
       * signature (`signedMessagesPlugin`). It is called once every
       * middleware has run, with `payload` as it stands, and what it returns
       * goes on the wire instead. To add an envelope around one already set,
       * call the previous `wrap` first.
       */
      wrap?: (payload: JsonValue) => JsonValue | Promise<JsonValue>;
    }
  | {
      type: "outgoing_error";
      messageId: string;
      method: string;
      errorCode: string;
      errorDescription: string;
    };
/** An outgoing call's action and params, as `wrap` takes and returns them. */
export interface WireCall {
  method: string;
  params: JsonValue;
}
