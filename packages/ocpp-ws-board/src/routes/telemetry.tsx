import { useState } from "react";
import {
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
  PageHeading,
  Refresh,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { duration } from "@/lib/export";
import { useSSELatest } from "@/lib/sse";
import type { TelemetrySnapshot } from "@/types";
export default function TelemetryPage() {
  const resource = useResource<TelemetrySnapshot>("/telemetry", 10000);
  const history = useResource<Array<TelemetrySnapshot & { time: string }>>(
    "/telemetry/history",
    5000,
  );
  const live = useSSELatest<TelemetrySnapshot>("/telemetry/stream");
  const [metric, setMetric] = useState("messagesPerSecond");
  const snapshot = live.connected && live.data ? live.data : resource.data;
  const labels: Record<string, string> = {
    messagesPerSecond: "Messages / second",
    avgLatencyMs: "Response latency (ms)",
    errorRate: "Error frames (%)",
    connectionCount: "Online connections",
  };
  return (
    <>
      <PageHeading
        title="Server telemetry"
        description="Throughput, response times, and process resource usage."
      >
        <Status tone={live.connected ? "mint" : "yellow"}>
          {live.connected ? "Live telemetry" : "Polling fallback"}
        </Status>
        <Refresh
          onClick={() => {
            resource.refresh();
            history.refresh();
          }}
        />
        <Export data={{ snapshot, history: history.data }} name="telemetry" />
      </PageHeading>
      <Feedback {...resource} retry={resource.refresh} />
      <div className="metric-strip">
        <div className="metric">
          <span>Throughput</span>
          <strong>{snapshot?.messagesPerSecond ?? "\u2014"}</strong>
          <small>frames / second</small>
        </div>
        <div className="metric">
          <span>Response latency</span>
          <strong>{snapshot?.avgLatencyMs ?? "\u2014"}</strong>
          <small>milliseconds</small>
        </div>
        <div className="metric">
          <span>Error frames</span>
          <strong>{snapshot?.errorRate ?? "\u2014"}%</strong>
          <small>OCPP error frames / all frames</small>
        </div>
        <div className="metric">
          <span>Total traffic</span>
          <strong>
            {snapshot?.totalMessages.toLocaleString() ?? "\u2014"}
          </strong>
          <small>observed frames</small>
        </div>
      </div>
      <div className="section-heading">
        <h2>{labels[metric]}</h2>
        <Select
          items={labels}
          value={metric}
          onValueChange={(val) => {
            if (val) setMetric(val);
          }}
        >
          <SelectTrigger className="w-[210px]" aria-label="Chart metric">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(labels).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Feedback {...history} retry={history.refresh} />
      <div
        className="chart-panel"
        role="img"
        aria-label={`${labels[metric]} over the last 60 retained samples`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={history.data ?? []}
            margin={{ top: 10, right: 15, bottom: 10, left: 0 }}
          >
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11 }}
              minTickGap={45}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              width={48}
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip />
            <Line
              type="monotone"
              dataKey={metric}
              name={labels[metric]}
              stroke="var(--blue)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="table-note">
        Up to 60 samples. Throughput uses a 10-second window; latency and error
        rates cover the board lifetime.
      </p>
      <div className="section-heading">
        <h2>Process resources</h2>
      </div>
      <dl className="detail-list">
        <div>
          <dt>Resident memory</dt>
          <dd>
            {snapshot
              ? `${(snapshot.memoryUsage.rss / 1048576).toFixed(1)} MB`
              : "\u2014"}
          </dd>
        </div>
        <div>
          <dt>Heap used / allocated</dt>
          <dd>
            {snapshot
              ? `${(snapshot.memoryUsage.heapUsed / 1048576).toFixed(1)} / ${(snapshot.memoryUsage.heapTotal / 1048576).toFixed(1)} MB`
              : "\u2014"}
          </dd>
        </div>
        <div>
          <dt>Connections / peak</dt>
          <dd>
            {snapshot
              ? `${snapshot.connectionCount} / ${snapshot.peakConnections}`
              : "\u2014"}
          </dd>
        </div>
        <div>
          <dt>Board uptime</dt>
          <dd>{snapshot ? duration(snapshot.uptimeSeconds) : "\u2014"}</dd>
        </div>
      </dl>
      <details className="payload-details">
        <summary>Accessible sample table</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Frames / s</th>
                <th>Latency (ms)</th>
                <th>Error %</th>
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((sample, index) => (
                <tr key={`${sample.time}-${index}`}>
                  <td>{sample.time}</td>
                  <td>{sample.messagesPerSecond}</td>
                  <td>{sample.avgLatencyMs}</td>
                  <td>{sample.errorRate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
