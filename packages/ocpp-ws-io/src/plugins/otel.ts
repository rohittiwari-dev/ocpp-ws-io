import type { OCPPPlugin } from "../types.js";

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
      setAttribute: (key: string, value: string | number) => void;
      setStatus: (status: { code: number; message?: string }) => void;
      end: () => void;
    };
  };
}

interface SpanLike {
  setAttribute: (key: string, value: string | number) => void;
  setStatus: (status: { code: number; message?: string }) => void;
  end: () => void;
}

interface TracerLike {
  startSpan: (name: string, options?: Record<string, unknown>) => SpanLike;
}

/**
 * OpenTelemetry integration — creates spans for connection lifecycle events.
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
  const spans = new Map<string, { span: SpanLike; startTime: number }>();

  return {
    name: "otel",

    onInit(server) {
      if (!tracer) {
        // Attempt to load @opentelemetry/api dynamically
        try {
          // Use createRequire to prevent tsup from bundling the optional dep
          const { createRequire } = require("node:module");
          const dynamicRequire = createRequire(__filename);
          const otelApi = dynamicRequire("@opentelemetry/api") as {
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

    onConnection(client) {
      if (!tracer) return;

      const span = tracer.startSpan("ocpp.connection", {
        kind: 1, // SpanKind.SERVER
      });

      span.setAttribute("ocpp.identity", client.identity);
      span.setAttribute("ocpp.protocol", client.protocol ?? "unknown");
      span.setAttribute("net.peer.ip", client.handshake.remoteAddress);

      spans.set(client.identity, { span, startTime: Date.now() });
    },

    onDisconnect(client, code) {
      const entry = spans.get(client.identity);
      if (!entry) return;

      const durationMs = Date.now() - entry.startTime;
      entry.span.setAttribute("ocpp.close_code", code);
      entry.span.setAttribute("ocpp.duration_ms", durationMs);
      entry.span.setStatus({ code: 1 }); // SpanStatusCode.OK
      entry.span.end();

      spans.delete(client.identity);
    },

    onClose() {
      // End all open spans
      for (const [, entry] of spans) {
        entry.span.setStatus({ code: 2, message: "Server shutdown" }); // ERROR
        entry.span.end();
      }
      spans.clear();
    },
  };
}
