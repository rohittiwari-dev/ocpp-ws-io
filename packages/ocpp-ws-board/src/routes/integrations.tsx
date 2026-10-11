import {
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCode,
  IconCopy,
  IconCpu,
  IconRoute,
  IconServer,
} from "@tabler/icons-react";
import { useState } from "react";
import {
  Export,
  Feedback,
  JsonView,
  PageHeading,
  Refresh,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import type { ProxyState, SmartChargeState } from "@/types";
import type { ServerInfo } from "@/types/operations";

const SETUP_SNIPPETS = {
  plugin: `import { OCPPServer } from "ocpp-ws-io";
import { createBoard } from "ocpp-ws-board";

const server = new OCPPServer({ port: 9000 });
const board = createBoard({ port: 3000 });

// Attach board monitoring plugin to the OCPP server
server.registerPlugin(board.plugin);
await server.listen();`,
  smartCharge: `import { SmartChargingEngine } from "ocpp-ws-io/smart-charge";

const engine = new SmartChargingEngine({ maxGridKw: 150 });

// Bind smart-charge engine to board UI
board.connectSmartCharge(engine);`,
  proxy: `import { OCPPProxy } from "ocpp-ws-io/proxy";

const proxy = new OCPPProxy({ upstreamUrl: "wss://csms.example.com" });

// Bind proxy translation events to board UI
board.connectProxy(proxy);`,
};

export default function IntegrationsPage() {
  const server = useResource<ServerInfo>("/server", 10000);
  const smart = useResource<SmartChargeState>("/smart-charge", 5000);
  const proxy = useResource<ProxyState>("/proxy", 5000);

  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  const isServerAttached = server.data?.attached ?? false;
  const isSmartBound = smart.data?.connected ?? false;
  const isProxyBound = proxy.data?.connected ?? false;

  return (
    <>
      <PageHeading
        title="Subsystems & integrations"
        description="Inspect core server bindings, cluster adapters, smart charging engines, and protocol proxies."
      >
        <Refresh
          onClick={() => {
            server.refresh();
            smart.refresh();
            proxy.refresh();
          }}
        />
        <Export
          name="integrations"
          data={{
            server: server.data,
            smartCharge: smart.data,
            proxy: proxy.data,
          }}
        />
      </PageHeading>

      {/* ── Subsystems Overview Grid ─────────────────────────────── */}
      <div className="integrations-grid">
        {/* Subsystem 1: OCPP Core Server */}
        <div className="integration-card">
          <div className="integration-card-header">
            <div className="integration-card-title-group">
              <div className="integration-icon-box bg-blue/10 text-blue">
                <IconServer size={22} />
              </div>
              <div>
                <strong>OCPP Core Server</strong>
                <p>Public plugin interface binding</p>
              </div>
            </div>
            <Status tone={isServerAttached ? "mint" : "yellow"}>
              {server.data?.state ?? "Loading"}
            </Status>
          </div>

          <Feedback {...server} retry={server.refresh} />

          <p className="integration-card-desc">
            {isServerAttached
              ? "The board is attached through the public OCPP plugin interface. Commands and telemetry operate on live connections owned by this host node."
              : "Register board.plugin with your OCPPServer instance to enable server-level controls and live packet introspection."}
          </p>

          {server.data?.stats ? (
            <div className="integration-metrics-strip">
              <div className="integration-metric-pill">
                <span className="metric-label">Connected clients</span>
                <strong className="metric-val">
                  {server.data.stats.connectedClients}
                </strong>
              </div>
              <div className="integration-metric-pill">
                <span className="metric-label">Active sessions</span>
                <strong className="metric-val">
                  {server.data.stats.activeSessions}
                </strong>
              </div>
              <div className="integration-metric-pill">
                <span className="metric-label">Commands</span>
                <strong className="metric-val text-mint">
                  {server.data.commandsEnabled ? "Enabled" : "Read-only"}
                </strong>
              </div>
            </div>
          ) : (
            <div className="integration-metrics-strip">
              <span className="text-xs text-muted-foreground">
                No active server statistics available yet.
              </span>
            </div>
          )}

          {server.data?.protocols && server.data.protocols.length > 0 && (
            <div className="integration-protocols-row">
              <span className="text-xs text-muted-foreground font-medium">
                Negotiated protocols:
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {server.data.protocols.map((p) => (
                  <span key={p} className="protocol-badge">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="integration-card-actions">
            <button
              type="button"
              className="button secondary sm"
              onClick={() =>
                setExpandedSection(
                  expandedSection === "server" ? null : "server",
                )
              }
            >
              {expandedSection === "server" ? (
                <>
                  <IconChevronUp size={14} /> Hide statistics
                </>
              ) : (
                <>
                  <IconChevronDown size={14} /> Inspect server stats
                </>
              )}
            </button>
            <button
              type="button"
              className="button secondary sm"
              onClick={() =>
                handleCopy(
                  JSON.stringify(server.data?.stats ?? {}, null, 2),
                  "server-stats",
                )
              }
            >
              {copiedKey === "server-stats" ? (
                <>
                  <IconCheck size={13} className="text-mint" /> Copied
                </>
              ) : (
                <>
                  <IconCopy size={13} /> Copy stats
                </>
              )}
            </button>
          </div>

          {expandedSection === "server" && server.data?.stats && (
            <div className="integration-expanded-payload">
              <JsonView value={server.data.stats} />
            </div>
          )}
        </div>

        {/* Subsystem 2: Cluster & Scaling Adapter */}
        <div className="integration-card">
          <div className="integration-card-header">
            <div className="integration-card-title-group">
              <div className="integration-icon-box bg-teal/10 text-teal">
                <IconCpu size={22} />
              </div>
              <div>
                <strong>Cluster & Event Adapter</strong>
                <p>Distributed Redis & pub/sub scaling</p>
              </div>
            </div>
            <Status tone={server.data?.adapterMetrics ? "blue" : "neutral"}>
              {server.data?.adapterMetrics ? "Metrics active" : "Single node"}
            </Status>
          </div>

          <p className="integration-card-desc">
            {server.data?.adapterMetrics
              ? "Adapter metrics are actively reported by the event distribution adapter. Cross-node message brokering is functional."
              : "Running in single-process mode. Attach RedisAdapter or NatsAdapter to ocpp-ws-io to enable horizontal multi-node scaling."}
          </p>

          <div className="integration-metrics-strip">
            <div className="integration-metric-pill">
              <span className="metric-label">Adapter type</span>
              <strong className="metric-val">
                {server.data?.adapterMetrics
                  ? "Distributed pub/sub"
                  : "In-Memory"}
              </strong>
            </div>
            <div className="integration-metric-pill">
              <span className="metric-label">Clustering status</span>
              <strong className="metric-val text-teal">
                {server.data?.adapterMetrics ? "Cluster ready" : "Standalone"}
              </strong>
            </div>
          </div>

          <div className="integration-card-actions">
            <button
              type="button"
              className="button secondary sm"
              onClick={() =>
                setExpandedSection(
                  expandedSection === "adapter" ? null : "adapter",
                )
              }
            >
              {expandedSection === "adapter" ? (
                <>
                  <IconChevronUp size={14} /> Hide adapter metrics
                </>
              ) : (
                <>
                  <IconChevronDown size={14} /> Inspect metrics
                </>
              )}
            </button>
            {server.data?.adapterMetrics && (
              <button
                type="button"
                className="button secondary sm"
                onClick={() =>
                  handleCopy(
                    JSON.stringify(server.data?.adapterMetrics, null, 2),
                    "adapter-metrics",
                  )
                }
              >
                {copiedKey === "adapter-metrics" ? (
                  <>
                    <IconCheck size={13} className="text-mint" /> Copied
                  </>
                ) : (
                  <>
                    <IconCopy size={13} /> Copy JSON
                  </>
                )}
              </button>
            )}
          </div>

          {expandedSection === "adapter" && (
            <div className="integration-expanded-payload">
              <JsonView
                value={
                  server.data?.adapterMetrics ?? {
                    mode: "standalone-process",
                    clustering: "disabled",
                    notice: "Attach RedisAdapter to scale across nodes",
                  }
                }
              />
            </div>
          )}
        </div>

        {/* Subsystem 3: Smart Charging Engine */}
        <div className="integration-card">
          <div className="integration-card-header">
            <div className="integration-card-title-group">
              <div className="integration-icon-box bg-mint/10 text-mint">
                <IconBolt size={22} />
              </div>
              <div>
                <strong>Smart Charging Engine</strong>
                <p>Dynamic load balancing & profiles</p>
              </div>
            </div>
            <Status tone={isSmartBound ? "mint" : "neutral"}>
              {isSmartBound ? "Engine bound" : "Not bound"}
            </Status>
          </div>

          <Feedback {...smart} retry={smart.refresh} />

          <p className="integration-card-desc">
            {isSmartBound
              ? `${smart.data?.sessions.length ?? 0} active charging sessions managed by the load balancing engine.`
              : "Bind a smart charging engine via board.connectSmartCharge(engine) to inspect dynamic power allocation."}
          </p>

          <div className="integration-metrics-strip">
            <div className="integration-metric-pill">
              <span className="metric-label">Managed sessions</span>
              <strong className="metric-val text-mint">
                {smart.data?.sessions.length ?? 0}
              </strong>
            </div>
            <div className="integration-metric-pill">
              <span className="metric-label">Dispatch errors</span>
              <strong
                className={`metric-val ${(smart.data?.dispatchErrors.length ?? 0) > 0 ? "text-rose" : "text-muted-foreground"}`}
              >
                {smart.data?.dispatchErrors.length ?? 0}
              </strong>
            </div>
          </div>

          {isSmartBound &&
            smart.data?.sessions &&
            smart.data.sessions.length > 0 && (
              <div className="table-scroll max-h-48 my-2">
                <table className="telemetry-sample-table">
                  <thead>
                    <tr>
                      <th>Charger</th>
                      <th>Connector</th>
                      <th>Priority</th>
                      <th>Allocated kW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {smart.data.sessions.map((s, idx) => (
                      <tr key={`${s.clientId}-${s.connectorId}-${idx}`}>
                        <td className="font-mono text-xs">{s.clientId}</td>
                        <td>Connector #{s.connectorId}</td>
                        <td>
                          <span className="telemetry-kpi-tag">
                            Priority {s.priority}
                          </span>
                        </td>
                        <td>
                          <strong className="font-mono text-mint">
                            {s.allocatedKw ?? "—"} kW
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          <div className="integration-card-actions">
            <button
              type="button"
              className="button secondary sm"
              onClick={() =>
                setExpandedSection(expandedSection === "smart" ? null : "smart")
              }
            >
              {expandedSection === "smart" ? (
                <>
                  <IconChevronUp size={14} /> Hide config & errors
                </>
              ) : (
                <>
                  <IconChevronDown size={14} /> View engine config
                </>
              )}
            </button>
            {isSmartBound && (
              <button
                type="button"
                className="button secondary sm"
                onClick={() =>
                  handleCopy(
                    JSON.stringify(smart.data, null, 2),
                    "smart-config",
                  )
                }
              >
                {copiedKey === "smart-config" ? (
                  <>
                    <IconCheck size={13} className="text-mint" /> Copied
                  </>
                ) : (
                  <>
                    <IconCopy size={13} /> Copy data
                  </>
                )}
              </button>
            )}
          </div>

          {expandedSection === "smart" && (
            <div className="integration-expanded-payload">
              <JsonView
                value={
                  smart.data ?? {
                    status: "Engine not bound",
                    hint: "Call board.connectSmartCharge(engine)",
                  }
                }
              />
            </div>
          )}
        </div>

        {/* Subsystem 4: Protocol Proxy */}
        <div className="integration-card">
          <div className="integration-card-header">
            <div className="integration-card-title-group">
              <div className="integration-icon-box bg-lavender/10 text-lavender">
                <IconRoute size={22} />
              </div>
              <div>
                <strong>Protocol Proxy</strong>
                <p>OCPP 1.6 & 2.0.1 bidirectional translation</p>
              </div>
            </div>
            <Status tone={isProxyBound ? "mint" : "neutral"}>
              {isProxyBound ? "Proxy active" : "Direct mode"}
            </Status>
          </div>

          <Feedback {...proxy} retry={proxy.refresh} />

          <p className="integration-card-desc">
            {isProxyBound
              ? `${proxy.data?.totalTranslations ?? 0} translations recorded / ${proxy.data?.translationErrors ?? 0} translation errors.`
              : "Bind an OCPP Proxy via board.connectProxy(proxy) to trace frame translations between legacy chargers and modern backends."}
          </p>

          <div className="integration-metrics-strip">
            <div className="integration-metric-pill">
              <span className="metric-label">Total translations</span>
              <strong className="metric-val">
                {proxy.data?.totalTranslations ?? 0}
              </strong>
            </div>
            <div className="integration-metric-pill">
              <span className="metric-label">Translation errors</span>
              <strong
                className={`metric-val ${(proxy.data?.translationErrors ?? 0) > 0 ? "text-rose" : "text-mint"}`}
              >
                {proxy.data?.translationErrors ?? 0}
              </strong>
            </div>
          </div>

          <div className="integration-card-actions">
            <button
              type="button"
              className="button secondary sm"
              onClick={() =>
                setExpandedSection(expandedSection === "proxy" ? null : "proxy")
              }
            >
              {expandedSection === "proxy" ? (
                <>
                  <IconChevronUp size={14} /> Hide proxy events
                </>
              ) : (
                <>
                  <IconChevronDown size={14} /> Inspect proxy events
                </>
              )}
            </button>
            {isProxyBound && (
              <button
                type="button"
                className="button secondary sm"
                onClick={() =>
                  handleCopy(
                    JSON.stringify(proxy.data?.events ?? [], null, 2),
                    "proxy-events",
                  )
                }
              >
                {copiedKey === "proxy-events" ? (
                  <>
                    <IconCheck size={13} className="text-mint" /> Copied
                  </>
                ) : (
                  <>
                    <IconCopy size={13} /> Copy events
                  </>
                )}
              </button>
            )}
          </div>

          {expandedSection === "proxy" && (
            <div className="integration-expanded-payload">
              <JsonView
                value={
                  proxy.data?.events ?? {
                    status: "Proxy not bound",
                    hint: "Call board.connectProxy(proxy)",
                  }
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Integration Code Setup Guide ─────────────────────────── */}
      <div className="section-heading">
        <h2>Integration setup guide</h2>
        <span className="text-xs text-muted-foreground">
          TypeScript code snippets to attach core subsystems
        </span>
      </div>

      <div className="integration-snippets-grid">
        <div className="integration-snippet-card">
          <div className="snippet-card-header">
            <div className="flex items-center gap-2">
              <IconCode size={16} className="text-blue" />
              <strong>1. Attach OCPP Server Plugin</strong>
            </div>
            <button
              type="button"
              className="button secondary sm"
              onClick={() =>
                handleCopy(SETUP_SNIPPETS.plugin, "snippet-plugin")
              }
            >
              {copiedKey === "snippet-plugin" ? (
                <>
                  <IconCheck size={12} className="text-mint" /> Copied
                </>
              ) : (
                <>
                  <IconCopy size={12} /> Copy
                </>
              )}
            </button>
          </div>
          <pre className="snippet-code-box">{SETUP_SNIPPETS.plugin}</pre>
        </div>

        <div className="integration-snippet-card">
          <div className="snippet-card-header">
            <div className="flex items-center gap-2">
              <IconCode size={16} className="text-mint" />
              <strong>2. Connect Smart Charge Engine</strong>
            </div>
            <button
              type="button"
              className="button secondary sm"
              onClick={() =>
                handleCopy(SETUP_SNIPPETS.smartCharge, "snippet-smart")
              }
            >
              {copiedKey === "snippet-smart" ? (
                <>
                  <IconCheck size={12} className="text-mint" /> Copied
                </>
              ) : (
                <>
                  <IconCopy size={12} /> Copy
                </>
              )}
            </button>
          </div>
          <pre className="snippet-code-box">{SETUP_SNIPPETS.smartCharge}</pre>
        </div>

        <div className="integration-snippet-card">
          <div className="snippet-card-header">
            <div className="flex items-center gap-2">
              <IconCode size={16} className="text-lavender" />
              <strong>3. Connect Protocol Proxy</strong>
            </div>
            <button
              type="button"
              className="button secondary sm"
              onClick={() => handleCopy(SETUP_SNIPPETS.proxy, "snippet-proxy")}
            >
              {copiedKey === "snippet-proxy" ? (
                <>
                  <IconCheck size={12} className="text-mint" /> Copied
                </>
              ) : (
                <>
                  <IconCopy size={12} /> Copy
                </>
              )}
            </button>
          </div>
          <pre className="snippet-code-box">{SETUP_SNIPPETS.proxy}</pre>
        </div>
      </div>
    </>
  );
}
