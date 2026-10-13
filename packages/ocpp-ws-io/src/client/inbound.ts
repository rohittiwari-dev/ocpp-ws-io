import type WebSocket from "ws";
import {
  type RPCError,
  RPCFormatViolationError,
  RPCMessageTypeNotSupportedError,
  RPCNotImplementedError,
  TimeoutError,
} from "../core/errors.js";
import { runHandler } from "../core/handler-run.js";
import { createRPCError } from "../core/util.js";
import { isEmptyFrame } from "../core/ws-util.js";
import type { CallHandler, HandlerContext } from "../types/handlers.js";
import type { JsonValue } from "../types/json.js";
import type { MiddlewareContext } from "../types/middleware.js";
import {
  ConnectionState,
  MessageType,
  NOREPLY,
  type OCPPCall,
  type OCPPCallError,
  type OCPPCallResult,
  type OCPPCallResultError,
  type OCPPMessage,
  type OCPPSend,
} from "../types/protocol.js";
import type { InboundContext } from "./context.js";
import {
  type BadMessageReply,
  callErrorFor,
  errorCodeForProtocol,
  fitErrorDescription,
  frameworkErrorCode,
  isKnownMessageType,
  MIN_FRAME_LENGTH,
  messageIdError,
  PAYLOAD_INDEX,
  replyTo,
  UNREADABLE_ID_REPLY,
} from "./frames.js";

const { OPEN } = ConnectionState;

/**
 * Check an incoming frame and pass it to the handler for its message type. A
 * frame that fails a check is counted, reported, and answered where the spec
 * says it is. `preParsed` is the frame the worker pool already parsed.
 */
export function handleMessage(
  client: InboundContext,
  rawData: WebSocket.RawData,
  preParsed?: unknown,
): void {
  client.recordActivity();

  // Some charge points send empty frames. They carry nothing to answer, and
  // counting them as bad messages would disconnect an otherwise working
  // charger.
  if (preParsed === undefined && isEmptyFrame(rawData)) return;

  const rawText = () =>
    typeof rawData === "string" ? rawData : (rawData as Buffer).toString();

  // Until the message ID has been read, a bad frame is answered under ID
  // "-1" (2.0.1 / 2.1 §4.2.3: "When also the MessageId cannot be read").
  let message: OCPPMessage;
  try {
    message =
      preParsed !== undefined
        ? // Worker pool already parsed — skip JSON.parse entirely
          (preParsed as OCPPMessage)
        : // JSON.parse accepts a Buffer directly (implicit utf8 toString).
          (JSON.parse(rawData as unknown as string) as OCPPMessage);
  } catch {
    onBadMessage(
      client,
      rawText(),
      createRPCError(
        frameworkErrorCode(client.protocol),
        "Message must be a JSON structure",
      ),
      UNREADABLE_ID_REPLY,
    );
    return;
  }
  if (!Array.isArray(message)) {
    onBadMessage(
      client,
      rawText(),
      createRPCError(
        frameworkErrorCode(client.protocol),
        "Message must be an array",
      ),
      UNREADABLE_ID_REPLY,
    );
    return;
  }

  // Typed as parsed JSON: the frame is untrusted until checked below.
  const messageType: JsonValue = message[0];
  const messageId: JsonValue = message[1];

  if (typeof messageType !== "number") {
    onBadMessage(
      client,
      rawText(),
      createRPCError(
        frameworkErrorCode(client.protocol),
        "Message type must be a number",
      ),
      UNREADABLE_ID_REPLY,
    );
    return;
  }

  // A type number this protocol does not define is a bad message, answered
  // with MessageTypeNotSupported (2.0.1 §4.4) under ID "-1": the frame's own
  // ID is not read for a type the protocol does not define.
  if (!isKnownMessageType(client.protocol, messageType)) {
    onBadMessage(
      client,
      rawText(),
      new RPCMessageTypeNotSupportedError(
        `Unknown message type: ${messageType}`,
      ),
      UNREADABLE_ID_REPLY,
    );
    return;
  }

  if (typeof messageId !== "string") {
    onBadMessage(
      client,
      rawText(),
      createRPCError(
        frameworkErrorCode(client.protocol),
        "Message ID must be a string",
      ),
      UNREADABLE_ID_REPLY,
    );
    return;
  }

  // A rejected request ID is answered like an unreadable one, under "-1";
  // a SEND is never answered (2.1 Part 2 FR.07).
  if (messageType === MessageType.CALL || messageType === MessageType.SEND) {
    const idError = messageIdError(client, messageId);
    if (idError) {
      onBadMessage(
        client,
        rawText(),
        idError,
        messageType === MessageType.CALL ? UNREADABLE_ID_REPLY : undefined,
      );
      return;
    }
  }

  if (message.length < MIN_FRAME_LENGTH[messageType]) {
    onBadMessage(
      client,
      JSON.stringify(message),
      new RPCFormatViolationError(
        `Missing payload elements for message type ${messageType}`,
      ),
      replyTo(client.protocol, messageType, messageId),
    );
    return;
  }

  // Payload MUST be a JSON object (not array or primitive)
  const payloadIndex = PAYLOAD_INDEX[messageType];
  // Every OCPP-J version allows an absent payload to be sent as null
  // (1.6J §4.2.1, 2.0.1/2.1 §4.1.5); it means the same as {}.
  if (
    (messageType === MessageType.CALL || messageType === MessageType.SEND) &&
    message[3] === null
  ) {
    (message as OCPPCall)[3] = {};
  } else if (messageType === MessageType.CALLRESULT && message[2] === null) {
    (message as OCPPCallResult)[2] = {};
  }
  const payload = message[payloadIndex];
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    onBadMessage(
      client,
      JSON.stringify(message),
      new RPCFormatViolationError(
        `Payload must be a JSON object, got ${
          payload === null
            ? "null"
            : Array.isArray(payload)
              ? "array"
              : typeof payload
        }`,
      ),
      replyTo(client.protocol, messageType, messageId),
    );
    return;
  }

  resetBadMessageCount(client);

  switch (messageType) {
    case MessageType.CALL: {
      // Tracked until answered, so close() with awaitPending lets the answer
      // out. handleIncomingCall settles every error itself and never rejects.
      const answering = handleIncomingCall(client, message as OCPPCall);
      client.answering.add(answering);
      const forget = () => client.answering.delete(answering);
      answering.then(forget, forget);
      break;
    }
    case MessageType.SEND:
      handleIncomingSend(client, message as OCPPSend);
      break;
    case MessageType.CALLRESULTERROR:
      handleCallResultError(client, message as OCPPCallResultError);
      break;
    case MessageType.CALLRESULT:
      // Async with no await: an error escaping it (a throwing middleware or
      // response listener) became an unhandled rejection and took the
      // process down. The message is already dispatched, so log and carry on.
      handleCallResult(client, message as OCPPCallResult).catch((err) => {
        client.logger?.error?.("Error handling CALLRESULT", {
          identity: client.identity,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      break;
    case MessageType.CALLERROR:
      handleCallError(client, message as OCPPCallError).catch((err) => {
        client.logger?.error?.("Error handling CALLERROR", {
          identity: client.identity,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      break;
  }
}

function findHandler(
  client: InboundContext,
  method: string,
): CallHandler | undefined {
  return (
    (client.protocol
      ? client.handlers.get(`${client.protocol}:${method}`)
      : undefined) ?? client.handlers.get(method)
  );
}

/**
 * OCPP 2.1 SEND: routed to the action's handler like a CALL, but nothing is
 * ever sent back, neither a result nor an error (Part 4 §4.2.4, Part 2
 * FR.07). Failures are logged and surfaced as events only.
 */
async function handleIncomingSend(
  client: InboundContext,
  message: OCPPSend,
): Promise<void> {
  const [, msgId, method, params] = message;
  const ctx: MiddlewareContext = {
    type: "incoming_call",
    messageId: msgId,
    method,
    params,
    protocol: client.protocol,
    unconfirmed: true,
  };

  try {
    await client.middleware.execute(ctx, async (c) => {
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "incoming_call" }
      >;
      const observed: OCPPSend = [
        MessageType.SEND,
        ctxvals.messageId,
        ctxvals.method,
        ctxvals.params,
      ];
      client.emitMessageEvent(observed, "IN", ctxvals);

      if (client.state !== OPEN) return;

      let handler = findHandler(client, ctxvals.method);
      if (!handler && !client.wildcardHandler) {
        await client.awaitHandlerGrace();
        handler = findHandler(client, ctxvals.method);
      }
      if (!handler && !client.wildcardHandler) {
        client.logger?.debug?.("No handler for SEND message", {
          method: ctxvals.method,
        });
        return;
      }

      if (client.strictMode && client.protocol) {
        try {
          client.validateInbound(ctxvals.method, ctxvals.params, "send");
        } catch {
          // strictValidationFailure was emitted; there is nobody to tell.
          return;
        }
      }

      try {
        await runHandler(
          client.runningHandlers,
          client.handlerTimeoutMs,
          () => handlerTimeoutError(client, ctxvals.method),
          (signal) => {
            const context: HandlerContext = {
              messageId: ctxvals.messageId,
              method: ctxvals.method,
              protocol: client.protocol,
              params: ctxvals.params,
              signal,
              unconfirmed: true,
            };
            return handler
              ? handler(context)
              : client.wildcardHandler?.(context);
          },
          () => logLateHandler(client, ctxvals.method, ctxvals.messageId),
        );
      } catch (err) {
        client.logger?.warn?.("Handler failed for SEND message", {
          method: ctxvals.method,
          error: (err as Error)?.message ?? String(err),
        });
        client.emitter.emit("handlerError", {
          method: ctxvals.method,
          error: err as Error,
        });
      }
    });
  } catch (err) {
    client.logger?.error?.("Middleware failed on SEND message", {
      method,
      error: (err as Error)?.message ?? String(err),
    });
  }
}

/** OCPP 2.1: the peer could not process a CALLRESULT we sent. Never answered. */
function handleCallResultError(
  client: InboundContext,
  message: OCPPCallResultError,
): void {
  const [, msgId, errorCode, errorDescription] = message;
  client.logger?.warn?.("Peer could not process a CALLRESULT", {
    messageId: msgId,
    errorCode,
    errorDescription,
  });
  client.emitter.emit("callResultError", message);
}

/**
 * What a handler past handlerTimeoutMs fails with. Not an RPC error, so the
 * call is answered InternalError with the code's standard text.
 */
function handlerTimeoutError(
  client: InboundContext,
  method: string,
): TimeoutError {
  return new TimeoutError(
    `Handler for "${method}" did not settle within ${client.handlerTimeoutMs}ms`,
  );
}

/**
 * The socket a call came in on has closed, or a reconnect replaced it. Its
 * answer cannot reach the caller, and on the new connection it would answer
 * a call that connection never made: under message IDs counted per
 * connection, another call with the same ID. The socket, not the client's
 * state: while close() waits for pending calls the client is CLOSING, and
 * the socket still carries answers.
 */
function connectionGone(client: InboundContext, ws: WebSocket | null): boolean {
  return ws === null || client.ws !== ws || ws.readyState !== ws.OPEN;
}

/** An answer whose connection is gone is dropped; nothing reports it sent. */
function logDroppedAnswer(
  client: InboundContext,
  method: string,
  messageId: string,
): void {
  client.logger?.debug?.(
    "Answer dropped: the connection the call came in on has closed",
    { method, messageId },
  );
}

/** A handler past its time limit has settled; what it returned answers nothing. */
function logLateHandler(
  client: InboundContext,
  method: string,
  messageId: string,
): void {
  client.logger?.debug?.(
    "Handler settled after handlerTimeoutMs; its result was dropped",
    { method, messageId },
  );
}

async function handleIncomingCall(
  client: InboundContext,
  message: OCPPCall,
): Promise<void> {
  const [, msgId, method, params] = message;
  // The socket this call came in on: its answer goes there or nowhere.
  const ws = client.ws;

  const ctx: MiddlewareContext = {
    type: "incoming_call",
    messageId: msgId,
    method,
    params,
    protocol: client.protocol,
  };

  // Whether the chain reached the handler step, which answers the CALL
  // itself, with a CALLRESULT or a CALLERROR.
  let reachedHandler = false;
  try {
    await client.middleware.execute(ctx, async (c) => {
      reachedHandler = true;
      const ctxvals = c as Extract<
        MiddlewareContext,
        { type: "incoming_call" }
      >;

      const modifiedMessage: OCPPCall = [
        MessageType.CALL,
        ctxvals.messageId,
        ctxvals.method,
        ctxvals.params,
      ];

      // Emit enriched message event (replaces old "call" event)
      client.emitMessageEvent(modifiedMessage, "IN", ctxvals);
      // Keep backward-compatible "call" event
      client.emitter.emit("call", modifiedMessage);

      if (client.state !== OPEN) {
        return;
      }

      try {
        if (client.pendingResponses.has(ctxvals.messageId)) {
          // 1.6J Table 7 has no RpcFrameworkError; GenericError covers
          // "any other error not covered by the previous ones".
          throw createRPCError(
            client.protocol === "ocpp1.6"
              ? "GenericError"
              : "RpcFrameworkError",
            `Already processing call with ID: ${ctxvals.messageId}`,
          );
        }

        let specificHandler = findHandler(client, ctxvals.method);

        // Startup grace. The socket dispatches as soon as it opens, so a CALL
        // can arrive before the application has finished registering its
        // handlers — and rejecting it would tell the peer this charger does
        // not support an action it does support. Wait briefly instead; see
        // ClientOptions.handlerGraceMs.
        if (!specificHandler && !client.wildcardHandler) {
          await client.awaitHandlerGrace();
          specificHandler = findHandler(client, ctxvals.method);
        }

        if (!specificHandler && !client.wildcardHandler) {
          throw new RPCNotImplementedError(
            `Method "${ctxvals.method}" not implemented`,
          );
        }

        if (client.strictMode && client.protocol) {
          client.validateInbound(ctxvals.method, ctxvals.params, "req");
        }

        client.pendingResponses.add(ctxvals.messageId);

        const result: unknown = await runHandler(
          client.runningHandlers,
          client.handlerTimeoutMs,
          () => handlerTimeoutError(client, ctxvals.method),
          (signal) => {
            const context: HandlerContext = {
              messageId: ctxvals.messageId,
              method: ctxvals.method,
              protocol: client.protocol,
              params: ctxvals.params,
              signal,
            };
            if (specificHandler) return specificHandler(context);
            return client.wildcardHandler?.(context);
          },
          () => logLateHandler(client, ctxvals.method, ctxvals.messageId),
        );

        client.pendingResponses.delete(ctxvals.messageId);

        if (result === NOREPLY) return;

        if (client.strictMode && client.protocol) {
          try {
            client.validateOutbound(ctxvals.method, result, "conf");
          } catch (validationError) {
            // OCPP-J's error codes describe the payload received: a schema
            // code here would tell the peer its request was malformed. Not an
            // RPC error, so the peer gets InternalError with the standard
            // text; strictValidationFailure and handlerError keep the cause.
            throw new Error(
              `The answer to ${ctxvals.method} does not match its schema: ${(validationError as Error).message}`,
              { cause: validationError },
            );
          }
        }

        // Run the response through the middleware chain before sending it.
        //
        // `outgoing_result` was declared as a context type and consumed by
        // schemaVersioningPlugin — which transforms a response *down* for an
        // older charge point — but the chain never executed for it, so that
        // branch could not run.
        //
        // `onBeforeSend` sees this response too, but a CALLRESULT is
        // `[3, messageId, payload]` and carries no action name, so a plugin
        // there cannot tell which request it answers without correlating
        // against pending state. Carrying `method` is why this context type
        // exists.
        //
        // Validation above deliberately stays ahead of this: a handler's
        // result is checked against the current schema, and only then adapted
        // for whatever the peer speaks.
        let payload = result;
        try {
          const outCtx: MiddlewareContext = {
            type: "outgoing_result",
            messageId: ctxvals.messageId,
            method: ctxvals.method,
            payload: result,
          };
          let wrap: Extract<
            MiddlewareContext,
            { type: "outgoing_result" }
          >["wrap"];
          await client.middleware.execute(outCtx, async (c) => {
            const out = c as Extract<
              MiddlewareContext,
              { type: "outgoing_result" }
            >;
            payload = out.payload;
            wrap = out.wrap;
          });
          // An envelope (a signature) goes around the reply every
          // middleware has finished with. If it fails, the reply goes
          // without it, like a failed middleware's.
          if (wrap) payload = await wrap(payload as JsonValue);
        } catch (err) {
          // Fail open with what the handler produced. A middleware that
          // throws must not cost the charge point its response — it would
          // sit waiting for a CALLRESULT that never arrives.
          client.logger?.error?.("Middleware failed on outgoing result", {
            method: ctxvals.method,
            error: (err as Error)?.message ?? String(err),
          });
        }

        const response: OCPPCallResult = [
          MessageType.CALLRESULT,
          ctxvals.messageId,
          payload,
        ];

        const allowSend = client.invokeBeforeSend(response);
        if (allowSend instanceof Promise) {
          if ((await allowSend) === false) return result;
        } else if (allowSend === false) {
          return result;
        }

        if (connectionGone(client, ws)) {
          logDroppedAnswer(client, ctxvals.method, ctxvals.messageId);
          return result;
        }
        client.safeSend(ws, JSON.stringify(response));
        // Emit outbound CALLRESULT message event for observability
        client.emitMessageEvent(response, "OUT", {
          type: "outgoing_result",
          messageId: ctxvals.messageId,
          method: ctxvals.method,
          // What was sent, not what the handler returned — they differ once
          // a middleware has transformed the response.
          payload,
        });
        client.emitter.emit("callResult", response);

        return result;
      } catch (err) {
        client.pendingResponses.delete(ctxvals.messageId);

        // Never ship stack traces to remote peers (report M13)
        const answer = callErrorFor(
          err as Error,
          client.respondWithDetailedErrors,
        );
        const details = answer.details;

        // Same treatment as the CALLRESULT path above: a CALLERROR on the
        // wire carries no action name either, so this context is the only
        // place a plugin can make an action-specific decision about one.
        // The declared context exposes the code and description; `details`
        // is not part of it and is sent as produced.
        let errorCode = errorCodeForProtocol(client.protocol, answer.code);
        let errorDescription = answer.description;
        try {
          const outCtx: MiddlewareContext = {
            type: "outgoing_error",
            messageId: ctxvals.messageId,
            method: ctxvals.method,
            errorCode,
            errorDescription,
          };
          await client.middleware.execute(outCtx, async (c) => {
            const out = c as Extract<
              MiddlewareContext,
              { type: "outgoing_error" }
            >;
            errorCode = out.errorCode;
            errorDescription = out.errorDescription;
          });
        } catch (mwErr) {
          // Fail open. A middleware that throws while an error is being
          // reported must not swallow the error report itself.
          client.logger?.error?.("Middleware failed on outgoing error", {
            method: ctxvals.method,
            error: (mwErr as Error)?.message ?? String(mwErr),
          });
        }
        errorDescription = fitErrorDescription(
          client.protocol,
          errorDescription,
        );

        const errorResponse: OCPPCallError = [
          MessageType.CALLERROR,
          ctxvals.messageId,
          errorCode,
          errorDescription,
          details,
        ];

        const allowSend = client.invokeBeforeSend(errorResponse);
        if (allowSend instanceof Promise) {
          if ((await allowSend) === false) throw err;
        } else if (allowSend === false) {
          throw err;
        }

        if (connectionGone(client, ws)) {
          logDroppedAnswer(client, ctxvals.method, ctxvals.messageId);
          client.emitter.emit("handlerError", {
            method: ctxvals.method,
            error: err as Error,
          });
          throw err;
        }
        client.safeSend(ws, JSON.stringify(errorResponse));
        // Emit outbound CALLERROR message event for observability
        client.emitMessageEvent(errorResponse, "OUT", {
          type: "outgoing_error",
          messageId: ctxvals.messageId,
          method: ctxvals.method,
          // What was sent, not what was thrown — they differ once a
          // middleware has rewritten the code or description.
          errorCode,
          errorDescription,
        });
        client.emitter.emit("callError", errorResponse);
        // Emit handler error event for plugin observability
        client.emitter.emit("handlerError", {
          method: ctxvals.method,
          error: err as Error,
        });

        throw err;
      }
    });
  } catch (err) {
    // Past the handler step, the error was already sent as a CALLERROR to
    // the peer, and logged explicitly by the createLoggingMiddleware. It is
    // swallowed here to prevent an UnhandledPromiseRejection, since
    // _handleIncomingCall is executed synchronously by _onMessage.
    if (reachedHandler) return;

    // A middleware threw before the handler step (rejecting the call, or
    // failing). Nothing answered the CALL, and OCPP-J requires an answer:
    // without one the peer only learns of it from its own timeout.
    client.logger?.error?.("Middleware failed on incoming call", {
      method,
      error: (err as Error)?.message ?? String(err),
    });
    if (client.state !== OPEN) return;
    if (connectionGone(client, ws)) {
      logDroppedAnswer(client, method, msgId);
      return;
    }
    const answer = callErrorFor(err as Error, client.respondWithDetailedErrors);
    sendRpcError(client, [
      MessageType.CALLERROR,
      msgId,
      errorCodeForProtocol(client.protocol, answer.code),
      answer.description,
      answer.details,
    ]);
  }
}

async function handleCallResult(
  client: InboundContext,
  message: OCPPCallResult,
): Promise<void> {
  const [, msgId, payload] = message;

  if (!client.pendingCalls.has(msgId)) {
    if (takeNoReplyAnswer(client, msgId)) return;
    client.logger?.warn?.("Received CallResult for unknown messageId", {
      messageId: msgId,
    });
    return;
  }

  const pending = client.pendingCalls.get(msgId)!;

  const ctx: MiddlewareContext = {
    type: "incoming_result",
    messageId: msgId,
    payload,
    method: pending.method,
  };

  try {
    await runIncomingResult(client, ctx);
  } catch (err) {
    failPendingCall(client, msgId, err as Error);
  }
}

/**
 * A middleware rejected a reply (CALLRESULT or CALLERROR), or failed on it.
 * The caller is waiting on this call, and without this it only saw its
 * timeout. Once the call is settled, the error is only logged.
 */
function failPendingCall(
  client: InboundContext,
  msgId: string,
  err: Error | RPCError,
): void {
  const pendingCtx = client.pendingCalls.get(msgId);
  if (!pendingCtx) {
    client.logger?.error?.("Middleware failed on a reply", {
      messageId: msgId,
      error: err.message,
    });
    return;
  }
  clearTimeout(pendingCtx.timeoutHandle);
  pendingCtx.removeAbortListener?.();
  client.pendingCalls.delete(msgId);
  pendingCtx.reject(err);
}

async function runIncomingResult(
  client: InboundContext,
  ctx: MiddlewareContext,
): Promise<void> {
  await client.middleware.execute(ctx, async (c) => {
    const ctxvals = c as Extract<
      MiddlewareContext,
      { type: "incoming_result" }
    >;
    const pendingCtx = client.pendingCalls.get(ctxvals.messageId);
    if (!pendingCtx) return;

    // Handled by createLoggingMiddleware
    const latencyMs = Date.now() - pendingCtx.sentAt;

    // Rebuild from the post-middleware context, the way the inbound CALL
    // path does. Emitting the raw frame handed observers the payload as it
    // arrived, so a middleware that rewrote it — piiRedactorPlugin returns a
    // redacted clone rather than mutating in place — was bypassed, and
    // unredacted payloads reached broker plugins running includePayload.
    const observedResult: OCPPCallResult = [
      MessageType.CALLRESULT,
      ctxvals.messageId,
      ctxvals.payload,
    ];

    // Emit enriched message event (replaces old "callResult" event)
    client.emitMessageEvent(observedResult, "IN", ctxvals, latencyMs);
    // Keep backward-compatible "callResult" event
    client.emitter.emit("callResult", observedResult);

    // Strict mode: validate the inbound response payload against the
    // method's .conf schema (report M6).
    if (client.strictMode && client.protocol) {
      try {
        client.validateInbound(pendingCtx.method, ctxvals.payload, "conf");
      } catch (err) {
        clearTimeout(pendingCtx.timeoutHandle);
        pendingCtx.removeAbortListener?.();
        client.pendingCalls.delete(ctxvals.messageId);
        pendingCtx.reject(err);
        // 2.1 Part 2 FR.06: a response that fails the schema is answered
        // with CALLRESULTERROR so the sender learns it was not processed.
        if (client.protocol === "ocpp2.1") {
          sendRpcError(client, [
            MessageType.CALLRESULTERROR,
            ctxvals.messageId,
            (err as RPCError).rpcErrorCode ?? "FormatViolation",
            (err as Error).message ?? "",
            {},
          ]);
        }
        return;
      }
    }

    clearTimeout(pendingCtx.timeoutHandle);
    pendingCtx.removeAbortListener?.();
    client.pendingCalls.delete(ctxvals.messageId);
    pendingCtx.resolve(ctxvals.payload);
  });
}

async function handleCallError(
  client: InboundContext,
  message: OCPPCallError,
): Promise<void> {
  const [, msgId] = message;

  const pending = client.pendingCalls.get(msgId);
  if (!pending) {
    if (takeNoReplyAnswer(client, msgId)) return;
    client.logger?.warn?.("Received CallError for unknown messageId", {
      messageId: msgId,
    });
    return;
  }

  const ctx: MiddlewareContext = {
    type: "incoming_error",
    messageId: msgId,
    error: message,
    method: pending.method,
  };

  const chain = client.middleware.execute(ctx, async (c) => {
    const ctxvals = c as Extract<MiddlewareContext, { type: "incoming_error" }>;
    const pendingCtx = client.pendingCalls.get(ctxvals.messageId);
    if (!pendingCtx) return;

    const latencyMs = Date.now() - pendingCtx.sentAt;

    // Same rebuild as the CALLRESULT path above: observers must see what
    // middleware produced, not what arrived on the wire.
    const observedError = ctxvals.error as OCPPCallError;

    // Emit enriched message event (replaces old "callError" event)
    client.emitMessageEvent(observedError, "IN", ctxvals, latencyMs);
    // Keep backward-compatible "callError" event
    client.emitter.emit("callError", observedError);

    const [, , code, msg, details] = ctxvals.error;

    clearTimeout(pendingCtx.timeoutHandle);
    pendingCtx.removeAbortListener?.();
    client.pendingCalls.delete(ctxvals.messageId);

    const err = createRPCError(code, msg, details);
    pendingCtx.reject(err);
  });
  try {
    await chain;
  } catch (err) {
    failPendingCall(client, msgId, err as Error);
  }
}

/**
 * maxBadMessages counts bad messages in a row, so a valid frame ends the run.
 * Counting over the whole connection slowly disconnected working chargers
 * that send an occasional odd frame.
 */
function resetBadMessageCount(client: InboundContext): void {
  client.badMessageCount = 0;
  client.badMessageWindowStart = 0;
}

function onBadMessage(
  client: InboundContext,
  rawMessage: string,
  error: Error,
  reply?: BadMessageReply,
): void {
  const now = Date.now();
  const windowMs = client.badMessageWindowMs;

  if (windowMs && windowMs > 0 && client.badMessageWindowStart > 0) {
    if (now - client.badMessageWindowStart >= windowMs) {
      client.badMessageCount = 0;
      client.badMessageWindowStart = 0;
    }
  }

  client.badMessageCount++;
  if (client.badMessageWindowStart === 0) {
    client.badMessageWindowStart = now;
  }

  client.logger?.warn?.("Bad message", {
    error: error.message,
    count: client.badMessageCount,
  });
  client.emitter.emit("badMessage", { message: rawMessage, error });

  // The caller decides whether and how the frame is answered, so the sender
  // of a malformed request is not left waiting out its timeout.
  if (reply && client.ws) {
    // Report the error that actually occurred. This previously sent the
    // format-violation code whatever had gone wrong, so an unsupported
    // message type was reported to the peer as a malformed payload.
    const rpcCode = (error as { rpcErrorCode?: string }).rpcErrorCode;
    // OCPP 1.6J spells this error "FormationViolation" (report M7)
    const formatCode =
      client.protocol === "ocpp1.6" ? "FormationViolation" : "FormatViolation";
    // A format violation is spelled differently per version, so it is
    // resolved here rather than taken from the error as-is. GenericError
    // exists in every version and passes through.
    const code =
      !rpcCode || rpcCode === "FormatViolation" ? formatCode : rpcCode;
    const description = error.message || "Invalid message format";
    sendRpcError(client, [reply.frame, reply.messageId, code, description, {}]);
  }

  if (client.badMessageCount >= client.maxBadMessages) {
    client
      .close({ code: 1002, reason: "Too many bad messages" })
      .catch(() => {});
  }
}

/** Send a CALLERROR or CALLRESULTERROR, honouring an onBeforeSend veto. */
function sendRpcError(
  client: InboundContext,
  frame: OCPPCallError | OCPPCallResultError,
): void {
  frame[3] = fitErrorDescription(client.protocol, frame[3]);
  const send = () => {
    client.safeSend(client.ws, JSON.stringify(frame));
    if (frame[0] === MessageType.CALLERROR)
      client.emitter.emit("callError", frame);
  };
  const allowSend = client.invokeBeforeSend(frame);
  if (allowSend instanceof Promise) {
    allowSend
      .then((allowed) => {
        if (allowed !== false) send();
      })
      .catch(() => {});
  } else if (allowSend !== false) {
    send();
  }
}

/** The answer to a noReply call: dropped quietly. False if it was not one. */
function takeNoReplyAnswer(client: InboundContext, msgId: string): boolean {
  const forget = client.noReplyCalls.get(msgId);
  if (forget === undefined) return false;
  clearTimeout(forget);
  client.noReplyCalls.delete(msgId);
  client.logger?.debug?.("Dropped the answer to a noReply call", {
    messageId: msgId,
  });
  return true;
}
