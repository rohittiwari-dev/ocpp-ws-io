import type { OCPPPlugin, OCPPServerStats } from "../types.js";

/**
 * Options for the OpenTelemetry plugin.
 */
export interface OtelPluginOptions {
  /** Service name for the tracer (default: "ocpp-server") */
  serviceName?: string;
  /**
   * Custom OpenTelemetry Tracer instance.
   * If omitted, the plugin will attempt to get a tracer from the global
   * `@opentelemetry/api` module (must be installed as a peer dependency).
   */
  tracer?: {
    startSpan: (
      name: string,
      options?: Record<string, unknown>,
    ) => {
      setAttribute: (key: string, value: string | number | boolean) => void;
      setStatus: (status: { code: number; message?: string }) => void;
      addEvent: (name: string, attributes?: Record<string, unknown>) => void;
      recordException: (error: Error) => void;
      end: () => void;
    };
  };
}

interface SpanLike {
  setAttribute: (key: string, value: string | number | boolean) => void;
  setStatus: (status: { code: number; message?: string }) => void;
  addEvent: (name: string, attributes?: Record<string, unknown>) => void;
  recordException: (error: Error) => void;
  end: () => void;
}

interface TracerLike {
  startSpan: (name: string, options?: Record<string, unknown>) => SpanLike;
}

/**
 * OpenTelemetry integration — creates spans for connection lifecycle,
 * individual OCPP messages, errors, and security events.
 *
 * Requires `@opentelemetry/api` as an **optional peer dependency**.
 * If not installed or no tracer is provided, the plugin becomes a silent no-op.
 *
 * @example
 * ```ts
 * import { otelPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(otelPlugin({ serviceName: 'my-csms' }));
 * ```
 *
 * @example With custom tracer
 * ```ts
 * import { trace } from '@opentelemetry/api';
 * import { otelPlugin } from 'ocpp-ws-io/plugins';
 *
 * const tracer = trace.getTracer('ocpp');
 * server.plugin(otelPlugin({ tracer }));
 * ```
 */
export function otelPlugin(options?: OtelPluginOptions): OCPPPlugin {
  let tracer: TracerLike | null = options?.tracer ?? null;
  const connectionSpans = new Map<
    string,
    { span: SpanLike; startTime: number }
  >();

  return {
    name: "otel",

    async onInit(server) {
      if (!tracer) {
        // ESM-safe dynamic import — no require() or __filename needed
        try {
          // Use string indirection to prevent tsc from resolving this optional peer dep
          const otelModuleName = "@opentelemetry/api";
          const otelApi = (await import(
            /* webpackIgnore: true */ otelModuleName
          )) as {
            trace: {
              getTracer: (name: string, version?: string) => TracerLike;
            };
          };
          tracer = otelApi.trace.getTracer(
            options?.serviceName ?? "ocpp-server",
            "1.0.0",
          );
        } catch {
          server.log.warn?.(
            "otelPlugin: @opentelemetry/api not found — plugin disabled. Install it as a peer dependency.",
          );
          tracer = null;
        }
      }
    },

    // ─── Connection Lifecycle ──────────────────────────────────────

    onConnection(client) {
      if (!tracer) return;

      const span = tracer.startSpan("ocpp.connection", {
        kind: 1, // SpanKind.SERVER
      });

      span.setAttribute("ocpp.identity", client.identity);
      span.setAttribute("ocpp.protocol", client.protocol ?? "unknown");
      span.setAttribute("net.peer.ip", client.handshake.remoteAddress);

      connectionSpans.set(client.identity, { span, startTime: Date.now() });
    },

    onDisconnect(client, code) {
      const entry = connectionSpans.get(client.identity);
      if (!entry) return;

      const durationMs = Date.now() - entry.startTime;
      entry.span.setAttribute("ocpp.close_code", code);
      entry.span.setAttribute("ocpp.duration_ms", durationMs);
      entry.span.setStatus({ code: 1 }); // SpanStatusCode.OK
      entry.span.end();

      connectionSpans.delete(client.identity);
    },

    // ─── Message-Level Spans ───────────────────────────────────────

    onMessage(client, payload) {
      if (!tracer) return;

      const msgType = payload.message[0];
      // Only create spans for CALL messages (type 2) to avoid excessive spans
      if (msgType !== 2) {
        // For CALLRESULT/CALLERROR, add as event to connection span
        const entry = connectionSpans.get(client.identity);
        if (entry) {
          entry.span.addEvent(
            msgType === 3 ? "ocpp.call_result" : "ocpp.call_error",
            {
              direction: payload.direction,
              "ocpp.message_id": String(payload.message[1]),
              ...(payload.ctx.latencyMs !== undefined && {
                "ocpp.latency_ms": payload.ctx.latencyMs,
              }),
            },
          );
        }
        return;
      }

      const method = String(payload.message[2] ?? "unknown");
      const span = tracer.startSpan(`ocpp.call.${method}`, {
        kind: payload.direction === "IN" ? 1 : 2, // SERVER for IN, CLIENT for OUT
      });

      span.setAttribute("ocpp.identity", client.identity);
      span.setAttribute("ocpp.method", method);
      span.setAttribute("ocpp.direction", payload.direction);
      span.setAttribute("ocpp.message_id", String(payload.message[1]));

      if (payload.ctx.latencyMs !== undefined) {
        span.setAttribute("ocpp.latency_ms", payload.ctx.latencyMs);
      }

      span.setStatus({ code: 1 }); // OK
      span.end(); // Instant span — CALLs are fire-and-forget from the plugin's perspective
    },

    // ─── Error Recording ───────────────────────────────────────────

    onError(client, error) {
      const entry = connectionSpans.get(client.identity);
      if (!entry) return;

      entry.span.recordException(error);
      entry.span.addEvent("ocpp.error", {
        "error.message": error.message,
      });
    },

    onHandlerError(client, method, error) {
      const entry = connectionSpans.get(client.identity);
      if (!entry) return;

      entry.span.recordException(error);
      entry.span.addEvent("ocpp.handler_error", {
        "ocpp.method": method,
        "error.message": error.message,
      });
    },

    onBadMessage(client, rawMessage, error) {
      const entry = connectionSpans.get(client.identity);
      if (!entry) return;

      entry.span.recordException(error);
      entry.span.addEvent("ocpp.bad_message", {
        "raw.preview":
          typeof rawMessage === "string"
            ? rawMessage.slice(0, 200)
            : "<buffer>",
        "error.message": error.message,
      });
    },

    onValidationFailure(client, _message, error) {
      const entry = connectionSpans.get(client.identity);
      if (!entry) return;

      entry.span.recordException(error);
      entry.span.addEvent("ocpp.validation_failure", {
        "error.message": error.message,
      });
    },

    onRateLimitExceeded(client) {
      const entry = connectionSpans.get(client.identity);
      if (!entry) return;

      entry.span.addEvent("ocpp.rate_limit_exceeded");
    },

    // ─── Lifecycle & Performance Events ────────────────────────────

    onPongTimeout(client) {
      const entry = connectionSpans.get(client.identity);
      if (!entry) return;

      entry.span.addEvent("ocpp.pong_timeout");
    },

    onBackpressure(client, bufferedAmount) {
      const entry = connectionSpans.get(client.identity);
      if (!entry) return;

      entry.span.addEvent("ocpp.backpressure", {
        "ocpp.buffered_bytes": bufferedAmount,
      });
    },

    onEviction(evictedClient, newClient) {
      const entry = connectionSpans.get(evictedClient.identity);
      if (!entry) return;

      entry.span.addEvent("ocpp.evicted", {
        "net.peer.ip.new": newClient.handshake.remoteAddress,
      });
    },

    // ─── Telemetry (Periodic Server Stats → OTel Gauges) ──────────

    onTelemetry(stats: OCPPServerStats) {
      if (!tracer) return;

      const span = tracer.startSpan("ocpp.telemetry_push", {
        kind: 0, // SpanKind.INTERNAL
      });

      span.setAttribute("ocpp.connected_clients", stats.connectedClients);
      span.setAttribute("ocpp.active_sessions", stats.activeSessions);
      span.setAttribute("ocpp.uptime_seconds", stats.uptimeSeconds);
      span.setAttribute("ocpp.memory_rss", stats.memoryUsage.rss);
      span.setAttribute("ocpp.memory_heap_used", stats.memoryUsage.heapUsed);
      span.setAttribute("ocpp.pid", stats.pid);

      if (stats.webSockets) {
        span.setAttribute("ocpp.ws_total", stats.webSockets.total);
        span.setAttribute(
          "ocpp.ws_buffered_amount",
          stats.webSockets.bufferedAmount,
        );
      }

      span.setStatus({ code: 1 }); // OK
      span.end();
    },

    // ─── Security Events ───────────────────────────────────────────

    onSecurityEvent(event) {
      if (!tracer) return;

      const span = tracer.startSpan("ocpp.security_event", {
        kind: 0, // SpanKind.INTERNAL
      });

      span.setAttribute("security.event_type", event.type);
      if (event.identity) span.setAttribute("ocpp.identity", event.identity);
      if (event.ip) span.setAttribute("net.peer.ip", event.ip);
      span.setStatus({ code: 2, message: event.type }); // ERROR — security events are notable
      span.end();
    },

    onAuthFailed(handshake, code, reason) {
      if (!tracer) return;

      const span = tracer.startSpan("ocpp.auth_failed", {
        kind: 1, // SERVER
      });

      span.setAttribute("ocpp.identity", handshake.identity);
      span.setAttribute("net.peer.ip", handshake.remoteAddress);
      span.setAttribute("ocpp.close_code", code);
      span.setAttribute("ocpp.close_reason", reason);
      span.setStatus({ code: 2, message: "Auth failed" }); // ERROR
      span.end();
    },

    // ─── Shutdown ─────────────────────────────────────────────────

    onClosing() {
      // Record shutdown-initiated event on all open connection spans
      for (const [, entry] of connectionSpans) {
        entry.span.addEvent("ocpp.server_closing");
      }
    },

    onClose() {
      // End all open spans
      for (const [, entry] of connectionSpans) {
        entry.span.setStatus({ code: 2, message: "Server shutdown" }); // ERROR
        entry.span.end();
      }
      connectionSpans.clear();
    },
  };
}
