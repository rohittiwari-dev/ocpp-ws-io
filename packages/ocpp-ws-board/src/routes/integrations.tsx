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
export default function IntegrationsPage() {
  const server = useResource<ServerInfo>("/server", 10000);
  const smart = useResource<SmartChargeState>("/smart-charge", 5000);
  const proxy = useResource<ProxyState>("/proxy", 5000);
  return (
    <>
      <PageHeading
        title="Integrations"
        description="Inspect your core bindings and optional subsystems."
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
      <section className="integration-section">
        <h2>
          OCPP server{" "}
          <Status tone={server.data?.attached ? "mint" : "yellow"}>
            {server.data?.state ?? "Loading"}
          </Status>
        </h2>
        <Feedback {...server} retry={server.refresh} />
        <p className="notice">
          {server.data?.attached
            ? "The board is attached through the public OCPP plugin interface. Controls operate on connections owned by this server node."
            : "Register board.plugin with your OCPPServer to enable server diagnostics and commands."}
        </p>
        {server.data?.stats && (
          <>
            <dl className="detail-list">
              <div>
                <dt>Connected clients</dt>
                <dd>{server.data.stats.connectedClients}</dd>
              </div>
              <div>
                <dt>Active sessions</dt>
                <dd>{server.data.stats.activeSessions}</dd>
              </div>
              <div>
                <dt>Observed protocols</dt>
                <dd>
                  {server.data.protocols.join(", ") ||
                    "No negotiated connections"}
                </dd>
              </div>
              <div>
                <dt>Commands</dt>
                <dd>{server.data.commandsEnabled ? "Enabled" : "Disabled"}</dd>
              </div>
            </dl>
            <details className="payload-details">
              <summary>Inspect server statistics</summary>
              <JsonView value={server.data.stats} />
            </details>
          </>
        )}
      </section>
      <section className="integration-section">
        <h2>
          Cluster adapter{" "}
          <Status tone={server.data?.adapterMetrics ? "blue" : "neutral"}>
            {server.data?.adapterMetrics ? "Metrics available" : "No metrics"}
          </Status>
        </h2>
        <p className="notice">
          Adapter diagnostics are reported by the core's active event adapter.
          An empty result can mean no adapter, no metrics support, or a metrics
          collection failure.
        </p>
        {server.data?.adapterMetrics && (
          <JsonView value={server.data.adapterMetrics} />
        )}
      </section>
      <section className="integration-section">
        <h2>
          Smart charging{" "}
          <Status tone={smart.data?.connected ? "mint" : "neutral"}>
            {smart.data?.connected ? "Bound" : "Not bound"}
          </Status>
        </h2>
        <Feedback {...smart} retry={smart.refresh} />
        <p className="notice">
          {smart.data?.connected
            ? `${smart.data.sessions.length} charging sessions reported by the integration.`
            : "Bind a smart-charge engine using board.connectSmartCharge(engine), or populate the optional storage fields."}
        </p>
        {smart.data?.connected && (
          <>
            <JsonView value={smart.data.sessions} />
            <details className="payload-details">
              <summary>Engine configuration and dispatch errors</summary>
              <JsonView
                value={{
                  config: smart.data.engineConfig,
                  errors: smart.data.dispatchErrors,
                }}
              />
            </details>
          </>
        )}
      </section>
      <section className="integration-section">
        <h2>
          Protocol proxy{" "}
          <Status tone={proxy.data?.connected ? "mint" : "neutral"}>
            {proxy.data?.connected ? "Bound" : "Not bound"}
          </Status>
        </h2>
        <Feedback {...proxy} retry={proxy.refresh} />
        <p className="notice">
          {proxy.data?.connected
            ? `${proxy.data.totalTranslations} retained translation events / ${proxy.data.translationErrors} errors`
            : "Bind an OCPP proxy using board.connectProxy(proxy) to inspect translations and failures."}
        </p>
        {proxy.data?.connected && <JsonView value={proxy.data.events} />}
      </section>
    </>
  );
}
