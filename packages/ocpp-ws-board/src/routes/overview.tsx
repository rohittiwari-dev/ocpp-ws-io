import { Link } from "react-router-dom";
import { TrafficTable } from "@/components/traffic-table";
import {
  Export,
  Feedback,
  PageHeading,
  Refresh,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { duration } from "@/lib/export";
import type { ConnectionRecord, OverviewStats } from "@/types";
export default function OverviewPage() {
  const resource = useResource<OverviewStats>("/overview", 5000);
  const stations = useResource<ConnectionRecord[]>("/connections", 5000);
  const data = resource.data;
  const attention = (stations.data ?? []).filter(
    (station) => station.errorCount || station.status !== "online",
  );
  return (
    <>
      <PageHeading
        title="Network overview"
        description="A clear view of your stations, traffic, and operational health."
      >
        <Refresh onClick={resource.refresh} />
        <Export data={data} name="overview" />
      </PageHeading>
      <Feedback {...resource} retry={resource.refresh} />
      <div className="metric-strip">
        <div className="metric">
          <span>Online stations</span>
          <strong>{data?.connectedClients ?? "\u2014"}</strong>
          <small>{data?.totalConnections ?? 0} observed stations</small>
        </div>
        <div className="metric">
          <span>Message throughput</span>
          <strong>
            {data?.messagesPerSecond ?? "\u2014"}
            <small>frames / second / last 10 seconds</small>
          </strong>
        </div>
        <div className="metric">
          <span>Average response</span>
          <strong>
            {data?.avgLatencyMs ?? "\u2014"}
            <small>milliseconds / recorded responses</small>
          </strong>
        </div>
        <div className="metric">
          <span>Board uptime</span>
          <strong>{data ? duration(data.uptimeSeconds) : "\u2014"}</strong>
          <small>Since this board started</small>
        </div>
      </div>
      <div className="section-heading">
        <h2>Needs attention</h2>
        <Link to="/connections?view=attention">Open station workspace</Link>
      </div>
      <div className="table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Station</th>
                <th>Connection</th>
                <th>Observed errors</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {attention.slice(0, 5).map((station) => (
                <tr key={station.identity}>
                  <td>{station.identity}</td>
                  <td>
                    <Status
                      tone={station.status === "online" ? "mint" : "yellow"}
                    >
                      {station.status}
                    </Status>
                  </td>
                  <td>{station.errorCount ?? 0}</td>
                  <td>
                    <Link
                      className="button"
                      to={`/connection/view/${encodeURIComponent(station.identity)}`}
                    >
                      Inspect station
                    </Link>
                  </td>
                </tr>
              ))}
              {!attention.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    {stations.data?.length
                      ? "No station issues in the current records."
                      : "Station health appears after a connection is observed."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="section-heading">
        <h2>Recent traffic</h2>
        <Link to="/messages">View all messages</Link>
      </div>
      <TrafficTable messages={data?.recentMessages.slice(0, 6) ?? []} />
      <div className="section-heading">
        <h2>Diagnostics at a glance</h2>
      </div>
      <div className="inline-actions">
        <Link className="button" to="/security">
          {data?.securityEventCount ?? 0} security events
        </Link>
        <Link className="button" to="/diagnostics">
          {data?.errorCount ?? 0} errors
        </Link>
        <Link className="button" to="/diagnostics?tab=system">
          {data?.systemEventCount ?? 0} lifecycle events
        </Link>
      </div>
    </>
  );
}
