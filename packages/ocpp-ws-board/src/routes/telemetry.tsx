import {
  IconActivity,
  IconAlertCircle,
  IconChartArea,
  IconChartLine,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconCopy,
  IconCpu,
  IconPlayerPause,
  IconPlayerPlay,
  IconServer,
  IconSparkles,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Export,
  Feedback,
  JsonView,
  PageHeading,
  Pagination,
  Refresh,
  Search,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { duration } from "@/lib/export";
import { useSSELatest } from "@/lib/sse";
import type { TelemetrySnapshot } from "@/types";

type MetricKey =
  | "messagesPerSecond"
  | "avgLatencyMs"
  | "errorRate"
  | "connectionCount";

interface MetricConfig {
  key: MetricKey;
  label: string;
  unit: string;
  description: string;
  color: string;
  gradientId: string;
}

const METRIC_CONFIGS: Record<MetricKey, MetricConfig> = {
  messagesPerSecond: {
    key: "messagesPerSecond",
    label: "Messages / second",
    unit: "req/s",
    description:
      "WebSocket frames processed per second across rolling 10s windows",
    color: "var(--blue)",
    gradientId: "gradMessagesPerSec",
  },
  avgLatencyMs: {
    key: "avgLatencyMs",
    label: "Response latency",
    unit: "ms",
    description: "Average round-trip response latency for charger RPC calls",
    color: "var(--teal)",
    gradientId: "gradAvgLatencyMs",
  },
  errorRate: {
    key: "errorRate",
    label: "Error frame rate",
    unit: "%",
    description:
      "Proportion of OCPP error frames relative to total observed frames",
    color: "var(--rose)",
    gradientId: "gradErrorRate",
  },
  connectionCount: {
    key: "connectionCount",
    label: "Online chargers",
    unit: "chargers",
    description: "Active concurrent WebSocket connections currently maintained",
    color: "var(--mint)",
    gradientId: "gradConnectionCount",
  },
};

type HistorySample = TelemetrySnapshot & { time: string };

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    value?: number | string;
    payload: HistorySample;
  }>;
  metricConfig: MetricConfig;
}

function TelemetryChartTooltip({
  active,
  payload,
  metricConfig,
}: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const sample = payload[0].payload;
  const value = payload[0].value;

  return (
    <div className="telemetry-chart-tooltip">
      <div className="telemetry-tooltip-header">
        <span className="telemetry-tooltip-time">{sample.time}</span>
        <span className="telemetry-tooltip-badge">Snapshot</span>
      </div>
      <div className="telemetry-tooltip-body">
        <div className="telemetry-tooltip-main-val">
          <span
            className="telemetry-tooltip-dot"
            style={{ backgroundColor: metricConfig.color }}
          />
          <span className="telemetry-tooltip-label">{metricConfig.label}:</span>
          <strong className="telemetry-tooltip-number">
            {value} {metricConfig.unit}
          </strong>
        </div>
        <div className="telemetry-tooltip-grid">
          <div className="telemetry-tooltip-stat">
            <span className="telemetry-tooltip-stat-label">Throughput:</span>
            <span className="telemetry-tooltip-stat-val">
              {sample.messagesPerSecond} req/s
            </span>
          </div>
          <div className="telemetry-tooltip-stat">
            <span className="telemetry-tooltip-stat-label">Latency:</span>
            <span className="telemetry-tooltip-stat-val">
              {sample.avgLatencyMs} ms
            </span>
          </div>
          <div className="telemetry-tooltip-stat">
            <span className="telemetry-tooltip-stat-label">Errors:</span>
            <span className="telemetry-tooltip-stat-val">
              {sample.errorRate}%
            </span>
          </div>
          <div className="telemetry-tooltip-stat">
            <span className="telemetry-tooltip-stat-label">Online:</span>
            <span className="telemetry-tooltip-stat-val">
              {sample.connectionCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TelemetryPage() {
  const [isLiveStreaming, setIsLiveStreaming] = useState(true);
  const resource = useResource<TelemetrySnapshot>("/telemetry", 10000);
  const history = useResource<HistorySample[]>("/telemetry/history", 5000);
  const live = useSSELatest<TelemetrySnapshot>(
    "/telemetry/stream",
    "telemetry",
    isLiveStreaming,
  );

  const [metric, setMetric] = useState<MetricKey>("messagesPerSecond");
  const [windowLimit, setWindowLimit] = useState<number>(60);
  const [chartType, setChartType] = useState<"area" | "line">("area");
  const [search, setSearch] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [samplePage, setSamplePage] = useState(0);
  const [samplePageSize, setSamplePageSize] = useState(6);

  const snapshot = live.connected && live.data ? live.data : resource.data;
  const currentMetricConfig = METRIC_CONFIGS[metric];

  // Slice time window for the chart
  const chartData = useMemo(() => {
    const list = history.data ?? [];
    if (windowLimit >= list.length) return list;
    return list.slice(list.length - windowLimit);
  }, [history.data, windowLimit]);

  // Filter sample table
  const filteredSamples = useMemo(() => {
    const raw = (history.data ?? []).slice().reverse();
    if (!search.trim()) return raw;
    const query = search.trim().toLowerCase();
    return raw.filter((sample) =>
      `${sample.time} ${sample.messagesPerSecond} ${sample.avgLatencyMs} ${sample.errorRate}`
        .toLowerCase()
        .includes(query),
    );
  }, [history.data, search]);

  const currentSamplePage = Math.min(
    samplePage,
    Math.max(0, Math.ceil(filteredSamples.length / samplePageSize) - 1),
  );

  const pagedSamples = useMemo(() => {
    const start = currentSamplePage * samplePageSize;
    return filteredSamples.slice(start, start + samplePageSize);
  }, [filteredSamples, currentSamplePage, samplePageSize]);

  const handleCopyJson = (sample: HistorySample, index: number) => {
    navigator.clipboard.writeText(JSON.stringify(sample, null, 2));
    setCopiedIndex(index);
    setTimeout(() => {
      setCopiedIndex((prev) => (prev === index ? null : prev));
    }, 2000);
  };

  // Process resources calculations
  const heapUsedMb = snapshot
    ? (snapshot.memoryUsage.heapUsed / 1048576).toFixed(1)
    : "—";
  const heapTotalMb = snapshot
    ? (snapshot.memoryUsage.heapTotal / 1048576).toFixed(1)
    : "—";
  const rssMb = snapshot
    ? (snapshot.memoryUsage.rss / 1048576).toFixed(1)
    : "—";

  const heapRatio = snapshot
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(
            (snapshot.memoryUsage.heapUsed /
              Math.max(1, snapshot.memoryUsage.heapTotal)) *
              100,
          ),
        ),
      )
    : 0;

  const connectionRatio = snapshot
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(
            (snapshot.connectionCount / Math.max(1, snapshot.peakConnections)) *
              100,
          ),
        ),
      )
    : 0;

  const bootDate = useMemo(() => {
    if (!snapshot) return "—";
    const bootTime = Date.now() - snapshot.uptimeSeconds * 1000;
    return new Date(bootTime).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [snapshot]);

  return (
    <>
      <PageHeading
        title="Server telemetry & observability"
        description="Real-time socket throughput, response latencies, memory footprint, and connection health."
      >
        <div className="telemetry-header-actions">
          <Status tone={live.connected ? "mint" : "yellow"}>
            <span
              className={`telemetry-live-dot ${live.connected ? "is-live" : ""}`}
            />
            {live.connected
              ? isLiveStreaming
                ? "Live telemetry (SSE)"
                : "Stream paused"
              : "Polling fallback"}
          </Status>
          <button
            type="button"
            className="button secondary"
            onClick={() => setIsLiveStreaming((prev) => !prev)}
            title={
              isLiveStreaming ? "Pause live streaming" : "Resume live streaming"
            }
          >
            {isLiveStreaming ? (
              <>
                <IconPlayerPause size={14} /> Pause
              </>
            ) : (
              <>
                <IconPlayerPlay size={14} /> Resume
              </>
            )}
          </button>
          <Refresh
            onClick={() => {
              resource.refresh();
              history.refresh();
            }}
          />
          <Export data={{ snapshot, history: history.data }} name="telemetry" />
        </div>
      </PageHeading>

      <Feedback {...resource} retry={resource.refresh} />

      {/* ── KPI Grid with Interactive Chart Metric Selection ──────── */}
      <div className="telemetry-metric-grid">
        {/* Card 1: Throughput */}
        <button
          type="button"
          className={`telemetry-kpi-card ${metric === "messagesPerSecond" ? "is-active" : ""}`}
          onClick={() => setMetric("messagesPerSecond")}
        >
          <div className="telemetry-kpi-card-header">
            <div className="telemetry-kpi-card-title">
              <IconActivity size={16} className="text-blue" />
              <span>Throughput</span>
            </div>
            <span className="telemetry-kpi-tag">10s window</span>
          </div>
          <div className="telemetry-kpi-card-body">
            <span className="telemetry-kpi-card-value">
              {snapshot?.messagesPerSecond ?? "—"}
            </span>
            <span className="telemetry-kpi-card-unit">req / s</span>
          </div>
          <div className="telemetry-kpi-card-footer">
            <span>
              Total observed:{" "}
              <strong>{snapshot?.totalMessages.toLocaleString() ?? "—"}</strong>
            </span>
            <span className="telemetry-kpi-action">
              {metric === "messagesPerSecond" ? "Viewing graph" : "View graph"}
            </span>
          </div>
        </button>

        {/* Card 2: Latency */}
        <button
          type="button"
          className={`telemetry-kpi-card ${metric === "avgLatencyMs" ? "is-active" : ""}`}
          onClick={() => setMetric("avgLatencyMs")}
        >
          <div className="telemetry-kpi-card-header">
            <div className="telemetry-kpi-card-title">
              <IconClock size={16} className="text-teal" />
              <span>Response latency</span>
            </div>
            <span
              className={`telemetry-kpi-tag ${(snapshot?.avgLatencyMs ?? 0) > 150 ? "tag-rose" : "tag-mint"}`}
            >
              {(snapshot?.avgLatencyMs ?? 0) <= 50
                ? "Optimal"
                : (snapshot?.avgLatencyMs ?? 0) <= 150
                  ? "Nominal"
                  : "Elevated"}
            </span>
          </div>
          <div className="telemetry-kpi-card-body">
            <span className="telemetry-kpi-card-value">
              {snapshot?.avgLatencyMs ?? "—"}
            </span>
            <span className="telemetry-kpi-card-unit">ms</span>
          </div>
          <div className="telemetry-kpi-card-footer">
            <span>Server round-trip average</span>
            <span className="telemetry-kpi-action">
              {metric === "avgLatencyMs" ? "Viewing graph" : "View graph"}
            </span>
          </div>
        </button>

        {/* Card 3: Error Frame Rate */}
        <button
          type="button"
          className={`telemetry-kpi-card ${metric === "errorRate" ? "is-active" : ""}`}
          onClick={() => setMetric("errorRate")}
        >
          <div className="telemetry-kpi-card-header">
            <div className="telemetry-kpi-card-title">
              <IconAlertCircle size={16} className="text-rose" />
              <span>Error frames</span>
            </div>
            <span
              className={`telemetry-kpi-tag ${(snapshot?.errorRate ?? 0) > 0 ? "tag-rose" : "tag-mint"}`}
            >
              {(snapshot?.errorRate ?? 0) === 0 ? "0% errors" : "Errors seen"}
            </span>
          </div>
          <div className="telemetry-kpi-card-body">
            <span className="telemetry-kpi-card-value">
              {snapshot?.errorRate ?? "—"}
            </span>
            <span className="telemetry-kpi-card-unit">%</span>
          </div>
          <div className="telemetry-kpi-card-footer">
            <span>OCPP error frame percentage</span>
            <span className="telemetry-kpi-action">
              {metric === "errorRate" ? "Viewing graph" : "View graph"}
            </span>
          </div>
        </button>

        {/* Card 4: Online Chargers */}
        <button
          type="button"
          className={`telemetry-kpi-card ${metric === "connectionCount" ? "is-active" : ""}`}
          onClick={() => setMetric("connectionCount")}
        >
          <div className="telemetry-kpi-card-header">
            <div className="telemetry-kpi-card-title">
              <IconServer size={16} className="text-mint" />
              <span>Online chargers</span>
            </div>
            <span className="telemetry-kpi-tag tag-mint">
              {snapshot?.connectionCount ?? 0} active
            </span>
          </div>
          <div className="telemetry-kpi-card-body">
            <span className="telemetry-kpi-card-value">
              {snapshot?.connectionCount ?? "—"}
            </span>
            <span className="telemetry-kpi-card-unit">
              / {snapshot?.peakConnections ?? "—"} peak
            </span>
          </div>
          <div className="telemetry-kpi-card-footer">
            <span>Active socket concurrency</span>
            <span className="telemetry-kpi-action">
              {metric === "connectionCount" ? "Viewing graph" : "View graph"}
            </span>
          </div>
        </button>
      </div>

      {/* ── Time-Series Observability Studio ─────────────────────── */}
      <div className="telemetry-chart-studio">
        <div className="telemetry-chart-studio-header">
          <div className="telemetry-chart-title-area">
            <h3>{currentMetricConfig.label}</h3>
            <p className="telemetry-chart-description">
              {currentMetricConfig.description}
            </p>
          </div>

          <div className="telemetry-chart-controls">
            {/* Window selector */}
            <div className="telemetry-control-group">
              <span className="telemetry-control-label">Window:</span>
              <div className="telemetry-window-pills">
                <button
                  type="button"
                  className={windowLimit === 15 ? "is-active" : ""}
                  onClick={() => setWindowLimit(15)}
                >
                  15
                </button>
                <button
                  type="button"
                  className={windowLimit === 30 ? "is-active" : ""}
                  onClick={() => setWindowLimit(30)}
                >
                  30
                </button>
                <button
                  type="button"
                  className={windowLimit === 60 ? "is-active" : ""}
                  onClick={() => setWindowLimit(60)}
                >
                  60 (All)
                </button>
              </div>
            </div>

            {/* Type selector */}
            <div className="telemetry-control-group">
              <span className="telemetry-control-label">Style:</span>
              <div className="telemetry-type-pills">
                <button
                  type="button"
                  className={chartType === "area" ? "is-active" : ""}
                  onClick={() => setChartType("area")}
                  title="Area chart"
                >
                  <IconChartArea size={14} /> Area
                </button>
                <button
                  type="button"
                  className={chartType === "line" ? "is-active" : ""}
                  onClick={() => setChartType("line")}
                  title="Line chart"
                >
                  <IconChartLine size={14} /> Line
                </button>
              </div>
            </div>

            {/* Metric Dropdown Select fallback */}
            <Select
              value={metric}
              onValueChange={(val) => {
                if (val) setMetric(val as MetricKey);
              }}
            >
              <SelectTrigger
                className="w-48 text-xs"
                aria-label="Chart metric selector"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(METRIC_CONFIGS).map(([k, cfg]) => (
                  <SelectItem key={k} value={k}>
                    {cfg.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Feedback {...history} retry={history.refresh} />

        <div
          className="telemetry-chart-container"
          role="img"
          aria-label={`${currentMetricConfig.label} over recent retained samples`}
        >
          <ResponsiveContainer width="100%" height={300}>
            {chartType === "area" ? (
              <AreaChart
                data={chartData}
                margin={{ top: 15, right: 15, bottom: 5, left: -10 }}
              >
                <defs>
                  <linearGradient
                    id={currentMetricConfig.gradientId}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={currentMetricConfig.color}
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="95%"
                      stopColor={currentMetricConfig.color}
                      stopOpacity={0.0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  minTickGap={40}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  width={46}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={
                    <TelemetryChartTooltip metricConfig={currentMetricConfig} />
                  }
                />
                <Area
                  type="monotone"
                  dataKey={metric}
                  name={currentMetricConfig.label}
                  stroke={currentMetricConfig.color}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill={`url(#${currentMetricConfig.gradientId})`}
                  dot={false}
                  activeDot={{
                    r: 5,
                    strokeWidth: 2,
                    stroke: "var(--background)",
                    fill: currentMetricConfig.color,
                  }}
                  isAnimationActive={false}
                />
              </AreaChart>
            ) : (
              <LineChart
                data={chartData}
                margin={{ top: 15, right: 15, bottom: 5, left: -10 }}
              >
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  minTickGap={40}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  width={46}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={
                    <TelemetryChartTooltip metricConfig={currentMetricConfig} />
                  }
                />
                <Line
                  type="monotone"
                  dataKey={metric}
                  name={currentMetricConfig.label}
                  stroke={currentMetricConfig.color}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{
                    r: 5,
                    strokeWidth: 2,
                    stroke: "var(--background)",
                    fill: currentMetricConfig.color,
                  }}
                  isAnimationActive={false}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>

        <div className="telemetry-chart-legend-strip">
          <span className="telemetry-legend-item">
            <span
              className="telemetry-legend-dot"
              style={{ backgroundColor: currentMetricConfig.color }}
            />
            {currentMetricConfig.label} ({chartData.length} samples shown)
          </span>
          <span className="telemetry-legend-note">
            Rolling samples emitted every ~2s • Max 60 samples retained in
            memory
          </span>
        </div>
      </div>

      {/* ── Process Resources & Health Meters ────────────────────── */}
      <div className="section-heading">
        <h2>Process resources & capacity</h2>
        <span className="text-xs text-muted-foreground">
          System telemetry sampled at host runtime
        </span>
      </div>

      <div className="telemetry-system-grid">
        {/* Card 1: Memory */}
        <div className="telemetry-system-card">
          <div className="telemetry-system-card-header">
            <div className="telemetry-system-card-title">
              <IconCpu size={18} className="text-teal" />
              <div>
                <strong>Memory footprint</strong>
                <p>Node.js heap & resident memory</p>
              </div>
            </div>
            <span
              className={`telemetry-kpi-tag ${heapRatio > 85 ? "tag-rose" : heapRatio > 70 ? "tag-amber" : "tag-mint"}`}
            >
              {heapRatio}% heap
            </span>
          </div>

          <div className="telemetry-progress-track">
            <div
              className={`telemetry-progress-bar ${heapRatio > 85 ? "bar-rose" : heapRatio > 70 ? "bar-amber" : "bar-teal"}`}
              style={{ width: `${heapRatio}%` }}
            />
          </div>

          <div className="telemetry-system-metrics">
            <div className="telemetry-system-metric-row">
              <span className="metric-label">Heap used</span>
              <strong className="metric-value">{heapUsedMb} MB</strong>
            </div>
            <div className="telemetry-system-metric-row">
              <span className="metric-label">Heap allocated</span>
              <strong className="metric-value">{heapTotalMb} MB</strong>
            </div>
            <div className="telemetry-system-metric-row">
              <span className="metric-label">Resident set (RSS)</span>
              <strong className="metric-value">{rssMb} MB</strong>
            </div>
          </div>
        </div>

        {/* Card 2: Socket Concurrency */}
        <div className="telemetry-system-card">
          <div className="telemetry-system-card-header">
            <div className="telemetry-system-card-title">
              <IconServer size={18} className="text-mint" />
              <div>
                <strong>Socket concurrency</strong>
                <p>WebSocket connections & capacity</p>
              </div>
            </div>
            <span className="telemetry-kpi-tag tag-mint">
              {connectionRatio}% of peak
            </span>
          </div>

          <div className="telemetry-progress-track">
            <div
              className="telemetry-progress-bar bar-mint"
              style={{ width: `${connectionRatio}%` }}
            />
          </div>

          <div className="telemetry-system-metrics">
            <div className="telemetry-system-metric-row">
              <span className="metric-label">Online chargers</span>
              <strong className="metric-value">
                {snapshot?.connectionCount ?? 0}
              </strong>
            </div>
            <div className="telemetry-system-metric-row">
              <span className="metric-label">Peak concurrent</span>
              <strong className="metric-value">
                {snapshot?.peakConnections ?? 0}
              </strong>
            </div>
            <div className="telemetry-system-metric-row">
              <span className="metric-label">Total observed frames</span>
              <strong className="metric-value">
                {snapshot?.totalMessages.toLocaleString() ?? "—"}
              </strong>
            </div>
          </div>
        </div>

        {/* Card 3: System Stability */}
        <div className="telemetry-system-card">
          <div className="telemetry-system-card-header">
            <div className="telemetry-system-card-title">
              <IconClock size={18} className="text-blue" />
              <div>
                <strong>Server runtime</strong>
                <p>Continuous uptime & stability</p>
              </div>
            </div>
            <span className="telemetry-kpi-tag tag-mint">Operational</span>
          </div>

          <div className="telemetry-system-uptime-box">
            <span className="uptime-label">Board uptime</span>
            <strong className="uptime-display">
              {snapshot ? duration(snapshot.uptimeSeconds) : "—"}
            </strong>
          </div>

          <div className="telemetry-system-metrics">
            <div className="telemetry-system-metric-row">
              <span className="metric-label">Boot timestamp</span>
              <strong className="metric-value">{bootDate}</strong>
            </div>
            <div className="telemetry-system-metric-row">
              <span className="metric-label">Sampling window</span>
              <strong className="metric-value">10s sliding throughput</strong>
            </div>
            <div className="telemetry-system-metric-row">
              <span className="metric-label">Transport mode</span>
              <strong className="metric-value">
                {live.connected ? "Server-Sent Events" : "HTTP Polling"}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* ── Retained Telemetry Sample Logs Table ─────────────────── */}
      <div className="section-heading">
        <div className="flex items-center gap-2">
          <h2>Retained telemetry snapshots</h2>
          <span className="telemetry-sample-count-badge">
            {filteredSamples.length} samples
          </span>
        </div>
      </div>

      <div className="telemetry-table-panel">
        <div className="telemetry-table-toolbar">
          <Search
            value={search}
            onChange={(val) => {
              setSearch(val);
              setSamplePage(0);
            }}
            placeholder="Filter by timestamp or value..."
          />
          {search && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setSearch("");
                setSamplePage(0);
              }}
            >
              Clear filter
            </button>
          )}
        </div>

        <div className="table-scroll">
          <table className="telemetry-sample-table">
            <thead>
              <tr>
                <th className="w-10" aria-label="Expand" />
                <th>Timestamp</th>
                <th>Throughput</th>
                <th>Latency</th>
                <th>Error %</th>
                <th>Chargers</th>
                <th>Memory (RSS)</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedSamples.map((sample, index) => {
                const globalIndex = currentSamplePage * samplePageSize + index;
                const isExpanded = expandedIndex === globalIndex;
                const isLatest = globalIndex === 0 && !search;

                return (
                  <tr
                    key={`${sample.time}-${globalIndex}`}
                    className={`telemetry-sample-row ${isExpanded ? "is-expanded" : ""}`}
                    onClick={() =>
                      setExpandedIndex(isExpanded ? null : globalIndex)
                    }
                  >
                    <td className="w-10 text-muted-foreground">
                      {isExpanded ? (
                        <IconChevronUp size={16} />
                      ) : (
                        <IconChevronDown size={16} />
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        {isLatest && (
                          <span
                            className="telemetry-live-dot is-live"
                            title="Latest snapshot"
                          />
                        )}
                        <strong className="font-mono text-xs">
                          {sample.time}
                        </strong>
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-xs">
                        {sample.messagesPerSecond} req/s
                      </span>
                    </td>
                    <td>
                      <Status
                        tone={
                          sample.avgLatencyMs <= 50
                            ? "mint"
                            : sample.avgLatencyMs <= 150
                              ? "yellow"
                              : "rose"
                        }
                      >
                        {sample.avgLatencyMs} ms
                      </Status>
                    </td>
                    <td>
                      <Status tone={sample.errorRate === 0 ? "mint" : "rose"}>
                        {sample.errorRate}%
                      </Status>
                    </td>
                    <td>
                      <span className="font-mono text-xs">
                        {sample.connectionCount} / {sample.peakConnections}
                      </span>
                    </td>
                    <td>
                      <span className="font-mono text-xs text-muted-foreground">
                        {(sample.memoryUsage.rss / 1048576).toFixed(1)} MB
                      </span>
                    </td>
                    <td
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="button secondary sm"
                        onClick={() => handleCopyJson(sample, globalIndex)}
                        title="Copy snapshot JSON"
                      >
                        {copiedIndex === globalIndex ? (
                          <>
                            <IconCheck size={13} className="text-mint" /> Copied
                          </>
                        ) : (
                          <>
                            <IconCopy size={13} /> Copy JSON
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {pagedSamples.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted text-center py-8">
                    {search
                      ? "No telemetry samples match the filter criteria."
                      : "Telemetry samples will accumulate as messages and connections are observed."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {expandedIndex !== null && filteredSamples[expandedIndex] && (
          <div className="telemetry-sample-expanded-card">
            <div className="telemetry-sample-expanded-header">
              <div className="flex items-center gap-2">
                <IconSparkles size={16} className="text-blue" />
                <strong>
                  Snapshot payload — {filteredSamples[expandedIndex].time}
                </strong>
              </div>
              <button
                type="button"
                className="button secondary sm"
                onClick={() =>
                  handleCopyJson(filteredSamples[expandedIndex], expandedIndex)
                }
              >
                {copiedIndex === expandedIndex ? (
                  <>
                    <IconCheck size={13} className="text-mint" /> Copied JSON
                  </>
                ) : (
                  <>
                    <IconCopy size={13} /> Copy full JSON
                  </>
                )}
              </button>
            </div>
            <JsonView value={filteredSamples[expandedIndex]} />
          </div>
        )}

        {filteredSamples.length > 0 && (
          <Pagination
            page={currentSamplePage}
            count={filteredSamples.length}
            size={samplePageSize}
            onChange={setSamplePage}
            onPageSizeChange={setSamplePageSize}
          />
        )}
      </div>
    </>
  );
}
