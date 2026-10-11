import {
  IconActivity,
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowRight,
  IconCircleCheck,
  IconClock,
  IconHistory,
  IconPlug,
  IconServer,
  IconShieldCheck,
  IconShieldExclamation,
  IconTerminal2,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TrafficTable } from "@/components/traffic-table";
import {
  Export,
  Feedback,
  PageHeading,
  Pagination,
  Refresh,
  Search,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { duration } from "@/lib/export";
import type { ConnectionRecord, OverviewStats } from "@/types";

export default function OverviewPage() {
  const resource = useResource<OverviewStats>("/overview", 5000);
  const stations = useResource<ConnectionRecord[]>("/connections", 5000);
  const data = resource.data;

  const [attentionSearch, setAttentionSearch] = useState("");
  const [attentionPage, setAttentionPage] = useState(0);
  const [attentionPageSize, setAttentionPageSize] = useState(6);
  const [trafficLimit, setTrafficLimit] = useState(6);

  // Filter chargers needing attention (offline or has errorCount)
  const allAttention = useMemo(() => {
    return (stations.data ?? []).filter(
      (station) => (station.errorCount ?? 0) > 0 || station.status !== "online",
    );
  }, [stations.data]);

  const filteredAttention = useMemo(() => {
    if (!attentionSearch.trim()) return allAttention;
    const query = attentionSearch.trim().toLowerCase();
    return allAttention.filter((station) =>
      `${station.identity} ${station.protocol} ${station.status} ${station.remoteAddress}`
        .toLowerCase()
        .includes(query),
    );
  }, [allAttention, attentionSearch]);

  const currentAttentionPage = Math.min(
    attentionPage,
    Math.max(0, Math.ceil(filteredAttention.length / attentionPageSize) - 1),
  );

  const pagedAttention = useMemo(() => {
    const start = currentAttentionPage * attentionPageSize;
    return filteredAttention.slice(start, start + attentionPageSize);
  }, [filteredAttention, currentAttentionPage, attentionPageSize]);

  // Calculations for KPI cards
  const totalStations = data?.totalConnections ?? stations.data?.length ?? 0;
  const onlineCount =
    data?.connectedClients ??
    (stations.data ?? []).filter((s) => s.status === "online").length;
  const offlineCount = Math.max(0, totalStations - onlineCount);
  const onlineRatio =
    totalStations > 0
      ? Math.min(100, Math.round((onlineCount / totalStations) * 100))
      : 100;

  return (
    <>
      <PageHeading
        title="Network overview"
        description="Real-time network operational health, charger fleet status, live traffic, and incident triage."
      >
        <Status tone={allAttention.length === 0 ? "mint" : "yellow"}>
          {allAttention.length === 0
            ? "All systems nominal"
            : `${allAttention.length} ${allAttention.length === 1 ? "charger needs" : "chargers need"} attention`}
        </Status>
        <Refresh
          onClick={() => {
            resource.refresh();
            stations.refresh();
          }}
        />
        <Export data={data} name="overview" />
      </PageHeading>

      <Feedback {...resource} retry={resource.refresh} />

      {/* ── Fleet & Observability KPI Hero Cards ────────────────── */}
      <div className="overview-kpi-grid">
        {/* Card 1: Online Chargers */}
        <div className="overview-kpi-card">
          <div className="overview-kpi-card-header">
            <div className="overview-kpi-card-title">
              <IconPlug size={16} className="text-mint" />
              <span>Online chargers</span>
            </div>
            <span
              className={`telemetry-kpi-tag ${offlineCount > 0 ? "tag-amber" : "tag-mint"}`}
            >
              {onlineRatio}% online
            </span>
          </div>
          <div className="overview-kpi-card-body">
            <span className="overview-kpi-card-value">{onlineCount}</span>
            <span className="overview-kpi-card-unit">
              / {totalStations} observed
            </span>
          </div>
          <div className="overview-progress-track">
            <div
              className={`overview-progress-bar ${offlineCount > 0 ? "bar-amber" : "bar-mint"}`}
              style={{ width: `${onlineRatio}%` }}
            />
          </div>
          <div className="overview-kpi-card-footer">
            <span>
              {offlineCount > 0
                ? `${offlineCount} offline or evicted`
                : "Full fleet connected"}
            </span>
            <Link to="/connections" className="overview-kpi-link">
              Manage chargers <IconArrowRight size={13} />
            </Link>
          </div>
        </div>

        {/* Card 2: Message Throughput */}
        <div className="overview-kpi-card">
          <div className="overview-kpi-card-header">
            <div className="overview-kpi-card-title">
              <IconActivity size={16} className="text-blue" />
              <span>Message throughput</span>
            </div>
            <span className="telemetry-kpi-tag">10s window</span>
          </div>
          <div className="overview-kpi-card-body">
            <span className="overview-kpi-card-value">
              {data?.messagesPerSecond ?? "—"}
            </span>
            <span className="overview-kpi-card-unit">req / s</span>
          </div>
          <div className="overview-progress-track">
            <div
              className="overview-progress-bar bar-blue"
              style={{
                width: `${Math.min(100, Math.max(15, (data?.messagesPerSecond ?? 0) * 10))}%`,
              }}
            />
          </div>
          <div className="overview-kpi-card-footer">
            <span>Error rate: {data?.errorRate ?? 0}%</span>
            <Link to="/telemetry" className="overview-kpi-link">
              Open telemetry <IconArrowRight size={13} />
            </Link>
          </div>
        </div>

        {/* Card 3: Response Latency */}
        <div className="overview-kpi-card">
          <div className="overview-kpi-card-header">
            <div className="overview-kpi-card-title">
              <IconClock size={16} className="text-teal" />
              <span>Average response</span>
            </div>
            <span
              className={`telemetry-kpi-tag ${(data?.avgLatencyMs ?? 0) > 150 ? "tag-rose" : "tag-mint"}`}
            >
              {(data?.avgLatencyMs ?? 0) <= 50
                ? "Optimal"
                : (data?.avgLatencyMs ?? 0) <= 150
                  ? "Nominal"
                  : "Elevated"}
            </span>
          </div>
          <div className="overview-kpi-card-body">
            <span className="overview-kpi-card-value">
              {data?.avgLatencyMs ?? "—"}
            </span>
            <span className="overview-kpi-card-unit">ms</span>
          </div>
          <div className="overview-progress-track">
            <div
              className={`overview-progress-bar ${(data?.avgLatencyMs ?? 0) > 150 ? "bar-rose" : "bar-teal"}`}
              style={{
                width: `${Math.min(100, Math.max(10, ((data?.avgLatencyMs ?? 0) / 200) * 100))}%`,
              }}
            />
          </div>
          <div className="overview-kpi-card-footer">
            <span>Recorded RPC round-trip</span>
            <Link to="/telemetry" className="overview-kpi-link">
              Inspect latency <IconArrowRight size={13} />
            </Link>
          </div>
        </div>

        {/* Card 4: Board Stability */}
        <div className="overview-kpi-card">
          <div className="overview-kpi-card-header">
            <div className="overview-kpi-card-title">
              <IconServer size={16} className="text-lavender" />
              <span>Board uptime</span>
            </div>
            <span className="telemetry-kpi-tag tag-mint">Stable</span>
          </div>
          <div className="overview-kpi-card-body">
            <span className="overview-kpi-card-value text-xl">
              {data ? duration(data.uptimeSeconds) : "—"}
            </span>
          </div>
          <div className="overview-progress-track">
            <div
              className="overview-progress-bar bar-lavender"
              style={{ width: "100%" }}
            />
          </div>
          <div className="overview-kpi-card-footer">
            <span>Zero downtime recorded</span>
            <Link to="/diagnostics?tab=system" className="overview-kpi-link">
              View lifecycle <IconArrowRight size={13} />
            </Link>
          </div>
        </div>
      </div>

      {/* ── Operational Domain Triage Cards ──────────────────────── */}
      <div className="overview-domains-grid">
        <Link to="/security" className="overview-domain-card">
          <div className="overview-domain-icon-box">
            {(data?.securityEventCount ?? 0) > 0 ? (
              <IconShieldExclamation size={22} className="text-amber" />
            ) : (
              <IconShieldCheck size={22} className="text-mint" />
            )}
          </div>
          <div className="overview-domain-info">
            <div className="overview-domain-title-row">
              <strong>Security events</strong>
              <span
                className={`telemetry-kpi-tag ${(data?.securityEventCount ?? 0) > 0 ? "tag-amber" : "tag-mint"}`}
              >
                {data?.securityEventCount ?? 0}
              </span>
            </div>
            <p>
              Authentication attempts, certificates & security profile audit
            </p>
          </div>
        </Link>

        <Link to="/diagnostics" className="overview-domain-card">
          <div className="overview-domain-icon-box">
            {(data?.errorCount ?? 0) > 0 ? (
              <IconAlertTriangle size={22} className="text-rose" />
            ) : (
              <IconCircleCheck size={22} className="text-mint" />
            )}
          </div>
          <div className="overview-domain-info">
            <div className="overview-domain-title-row">
              <strong>Observed errors</strong>
              <span
                className={`telemetry-kpi-tag ${(data?.errorCount ?? 0) > 0 ? "tag-rose" : "tag-mint"}`}
              >
                {data?.errorCount ?? 0}
              </span>
            </div>
            <p>Protocol validation failures, network drops & RPC errors</p>
          </div>
        </Link>

        <Link to="/diagnostics?tab=system" className="overview-domain-card">
          <div className="overview-domain-icon-box">
            <IconHistory size={22} className="text-blue" />
          </div>
          <div className="overview-domain-info">
            <div className="overview-domain-title-row">
              <strong>System lifecycle</strong>
              <span className="telemetry-kpi-tag">
                {data?.systemEventCount ?? 0}
              </span>
            </div>
            <p>Server boot, broker connections & runtime reconfiguration</p>
          </div>
        </Link>
      </div>

      {/* ── Needs Attention: Fleet Incident Center ───────────────── */}
      <div className="section-heading">
        <div className="flex items-center gap-2">
          <h2>Needs attention</h2>
          {allAttention.length > 0 && (
            <span className="telemetry-sample-count-badge">
              {allAttention.length}
            </span>
          )}
        </div>
        <Link to="/connections?view=attention" className="text-xs">
          Open charger workspace →
        </Link>
      </div>

      {allAttention.length === 0 ? (
        <div className="overview-nominal-card">
          <div className="overview-nominal-icon-box">
            <IconCircleCheck size={28} className="text-mint" />
          </div>
          <div className="overview-nominal-content">
            <h3>All chargers healthy & nominal</h3>
            <p>
              {stations.data?.length
                ? `All ${stations.data.length} observed chargers are connected with zero reported protocol errors.`
                : "No active incidents detected. Charger health metrics will appear as chargers establish WebSocket connections."}
            </p>
          </div>
          <Link to="/connections" className="button secondary sm">
            View all chargers
          </Link>
        </div>
      ) : (
        <div className="overview-table-panel">
          <div className="overview-table-toolbar">
            <Search
              value={attentionSearch}
              onChange={(val) => {
                setAttentionSearch(val);
                setAttentionPage(0);
              }}
              placeholder="Search charger identity or protocol..."
            />
            {attentionSearch && (
              <button
                type="button"
                className="button secondary sm"
                onClick={() => {
                  setAttentionSearch("");
                  setAttentionPage(0);
                }}
              >
                Clear filter
              </button>
            )}
          </div>

          <div className="table-scroll">
            <table className="overview-attention-table">
              <thead>
                <tr>
                  <th>Charger</th>
                  <th>Protocol</th>
                  <th>Connection</th>
                  <th>Observed errors</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedAttention.map((station) => (
                  <tr key={station.identity}>
                    <td>
                      <div className="flex flex-col gap-0.5">
                        <strong className="font-mono text-xs text-foreground">
                          {station.identity}
                        </strong>
                        <span className="text-[11px] text-muted-foreground">
                          {station.remoteAddress}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="protocol-badge">{station.protocol}</span>
                    </td>
                    <td>
                      <Status
                        tone={
                          station.status === "online"
                            ? "mint"
                            : station.status === "offline"
                              ? "yellow"
                              : "rose"
                        }
                      >
                        {station.status}
                      </Status>
                    </td>
                    <td>
                      {(station.errorCount ?? 0) > 0 ? (
                        <span className="overview-error-badge">
                          <IconAlertCircle size={13} /> {station.errorCount}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          className="button secondary sm"
                          to={`/commands?target=${encodeURIComponent(station.identity)}`}
                          title="Send command to charger"
                        >
                          <IconTerminal2 size={13} /> Command
                        </Link>
                        <Link
                          className="button sm"
                          to={`/connection/view/${encodeURIComponent(station.identity)}`}
                        >
                          Inspect
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredAttention.length > 0 && (
            <Pagination
              page={currentAttentionPage}
              count={filteredAttention.length}
              size={attentionPageSize}
              onChange={setAttentionPage}
              onPageSizeChange={setAttentionPageSize}
            />
          )}
        </div>
      )}

      {/* ── Recent Traffic Live Stream ───────────────────────────── */}
      <div className="section-heading">
        <div className="flex items-center gap-3">
          <h2>Recent traffic stream</h2>
          <div className="overview-traffic-limit-pills">
            <button
              type="button"
              className={trafficLimit === 6 ? "is-active" : ""}
              onClick={() => setTrafficLimit(6)}
            >
              6
            </button>
            <button
              type="button"
              className={trafficLimit === 10 ? "is-active" : ""}
              onClick={() => setTrafficLimit(10)}
            >
              10
            </button>
            <button
              type="button"
              className={trafficLimit === 15 ? "is-active" : ""}
              onClick={() => setTrafficLimit(15)}
            >
              15
            </button>
          </div>
        </div>
        <Link to="/messages" className="text-xs">
          View full packet inspector →
        </Link>
      </div>

      <TrafficTable
        messages={data?.recentMessages.slice(0, trafficLimit) ?? []}
      />
    </>
  );
}
