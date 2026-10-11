import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoggerLike } from "../types/logger.js";
import type { OCPPPlugin } from "../types/plugins.js";
import type { AnyOCPPProtocol } from "../types/protocol.js";
import type {
  HealthEndpointOptions,
  OCPPServerStats,
} from "../types/server.js";
import { assertHealthEndpointAuth, checkHealthAuth } from "./health-auth.js";
import {
  METRICS_PLUGIN_TIMEOUT_MS,
  reportPluginError,
  withTimeout,
} from "./plugin-hooks.js";

/** What the health endpoint reads from the server, through getters. */
export interface HealthContext<P extends AnyOCPPProtocol> {
  readonly logger: LoggerLike | null;
  /** Their getCustomMetrics() lines are appended to /metrics. */
  readonly plugins: readonly OCPPPlugin<P>[];
  readonly state: "OPEN" | "CLOSING" | "CLOSED";
  stats(): OCPPServerStats;
}

/** A "request" listener on an HTTP server. */
export type HealthRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;

/**
 * The "request" listener serving /health and /metrics. On a server listen()
 * created (`ownsServer`) it answers 404 to anything else; on the
 * application's own server it leaves other requests alone.
 */
export function createHealthHandler<P extends AnyOCPPProtocol>(
  server: HealthContext<P>,
  healthEndpoint: true | HealthEndpointOptions,
  ownsServer: boolean,
): HealthRequestHandler {
  // Re-checked here because reconfigure() can replace the option.
  assertHealthEndpointAuth(healthEndpoint);
  const heOpts: HealthEndpointOptions | undefined =
    typeof healthEndpoint === "object" ? healthEndpoint : undefined;
  if (!heOpts?.auth) {
    server.logger?.warn?.(
      "healthEndpoint has no auth: /health and /metrics answer anyone who can reach this port. Set healthEndpoint: { auth: { bearer } } or { auth: { username, password } }.",
    );
  }

  const serveHealth = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    if (res.headersSent || res.writableEnded) return;
    const url = req.url ?? "";

    if (
      (url === "/health" || url === "/metrics") &&
      heOpts?.auth &&
      !checkHealthAuth(req, heOpts.auth)
    ) {
      res.writeHead(401, {
        "Content-Type": "text/plain",
        "WWW-Authenticate":
          "bearer" in heOpts.auth
            ? 'Bearer realm="ocpp-ws-io"'
            : 'Basic realm="ocpp-ws-io", charset="UTF-8"',
      });
      res.end("Unauthorized");
      return;
    }

    if (url === "/health") {
      const s = server.stats();
      const body = JSON.stringify({
        status: server.state === "OPEN" ? "ok" : "degraded",
        state: server.state,
        connectedClients: s.connectedClients,
        activeSessions: s.activeSessions,
        uptimeSeconds: Math.round(s.uptimeSeconds),
        pid: s.pid,
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(body);
      return;
    }

    if (url === "/metrics") {
      const s = server.stats();
      const lines = [
        "# HELP ocpp_connected_clients Number of currently connected OCPP clients",
        "# TYPE ocpp_connected_clients gauge",
        `ocpp_connected_clients ${s.connectedClients}`,
        "",
        "# HELP ocpp_active_sessions Number of active in-memory sessions",
        "# TYPE ocpp_active_sessions gauge",
        `ocpp_active_sessions ${s.activeSessions}`,
        "",
        "# HELP ocpp_uptime_seconds Process uptime in seconds",
        "# TYPE ocpp_uptime_seconds gauge",
        `ocpp_uptime_seconds ${Math.round(s.uptimeSeconds)}`,
        "",
        "# HELP ocpp_memory_rss_bytes Resident set size in bytes",
        "# TYPE ocpp_memory_rss_bytes gauge",
        `ocpp_memory_rss_bytes ${s.memoryUsage.rss}`,
        "",
        "# HELP ocpp_memory_heap_used_bytes V8 heap used in bytes",
        "# TYPE ocpp_memory_heap_used_bytes gauge",
        `ocpp_memory_heap_used_bytes ${s.memoryUsage.heapUsed}`,
        "",
        "# HELP ocpp_memory_heap_total_bytes V8 heap total in bytes",
        "# TYPE ocpp_memory_heap_total_bytes gauge",
        `ocpp_memory_heap_total_bytes ${s.memoryUsage.heapTotal}`,
        "",
        "# HELP ocpp_ws_buffered_bytes Total buffered WebSocket bytes",
        "# TYPE ocpp_ws_buffered_bytes gauge",
        `ocpp_ws_buffered_bytes ${s.webSockets?.bufferedAmount ?? 0}`,
        "",
      ];
      // Plugin: getCustomMetrics — append plugin-contributed Prometheus lines.
      //
      // Collected before the response starts. Writing the header first and
      // then awaiting meant a slow plugin left the scrape holding an open
      // connection with a 200 and no body, and there was no way back to an
      // error status once the header had gone. Prometheus scrapes on an
      // interval, so each hung scrape stacked another held connection.
      for (const plugin of server.plugins) {
        if (plugin.getCustomMetrics) {
          try {
            // The hook may be sync or async; normalise before bounding it.
            const custom = await withTimeout(
              Promise.resolve(plugin.getCustomMetrics()),
              METRICS_PLUGIN_TIMEOUT_MS,
            );
            if (custom?.length) {
              lines.push("");
              lines.push(...custom);
            }
          } catch (err) {
            // A plugin that is slow or broken costs its own metrics, not
            // the scrape — the rest of the output still goes out.
            reportPluginError(
              server.logger,
              plugin.name,
              "getCustomMetrics",
              err,
            );
          }
        }
      }

      res.writeHead(200, {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(lines.join("\n"));
      return;
    }

    // Only 404 unknown routes on servers we created. On a user-provided
    // server the application's own handlers must keep working (report H7).
    if (ownsServer) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  };
  // The "request" listener ignores the returned promise, so a throw inside
  // serveHealth would otherwise be an unhandled rejection.
  return (req, res) => {
    serveHealth(req, res).catch((err: Error) => {
      server.logger?.error?.("Health endpoint request failed", {
        error: err?.message ?? String(err),
      });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      } else {
        res.destroy();
      }
    });
  };
}
