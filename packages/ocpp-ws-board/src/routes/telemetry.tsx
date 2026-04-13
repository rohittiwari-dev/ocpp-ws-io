import {
  IconActivity,
  IconAlertTriangle,
  IconCpu,
  IconDeviceDesktop,
  IconGauge,
  IconPlug,
  IconServer,
  IconWifiOff,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { api } from "@/lib/api";
import { useSSELatest } from "@/lib/sse";

interface TelemetryData {
  messagesPerSecond: number;
  avgLatencyMs: number;
  errorRate: number;
  connectionCount: number;
  peakConnections: number;
  uptimeSeconds: number;
  totalMessages: number;
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
}

interface TimePoint {
  time: string;
  mps: number;
  latency: number;
  errors: number;
  connections: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

const throughputConfig: ChartConfig = {
  mps: { label: "Messages/sec", color: "var(--chart-1)" },
};

const latencyConfig: ChartConfig = {
  latency: { label: "Avg Latency (ms)", color: "var(--chart-2)" },
};

const errorConfig: ChartConfig = {
  errors: { label: "Error Rate (%)", color: "var(--chart-5)" },
};

const connectionConfig: ChartConfig = {
  connections: { label: "Connections", color: "var(--chart-3)" },
};

export default function TelemetryPage() {
  const { data: telemetry, connected } = useSSELatest<TelemetryData>(
    "/telemetry/stream",
    "telemetry",
  );
  const [history, setHistory] = useState<TimePoint[]>([]);
  const maxPoints = 60;

  // Fetch initial history
  useEffect(() => {
    api
      .get<Array<TelemetryData & { time: string }>>("/telemetry/history")
      .then((hist) => {
        setHistory(
          hist.map((p) => ({
            time: p.time,
            mps: p.messagesPerSecond,
            latency: p.avgLatencyMs,
            errors: p.errorRate,
            connections: p.connectionCount,
          })),
        );
      })
      .catch(console.error);
  }, []);

  // Accumulate live telemetry
  useEffect(() => {
    if (!telemetry) return;
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setHistory((prev) => {
      const next = [
        ...prev,
        {
          time,
          mps: telemetry.messagesPerSecond,
          latency: telemetry.avgLatencyMs,
          errors: telemetry.errorRate,
          connections: telemetry.connectionCount,
        },
      ];
      return next.slice(-maxPoints);
    });
  }, [telemetry]);

  const memHeapPercent = telemetry?.memoryUsage
    ? Math.round(
        (telemetry.memoryUsage.heapUsed / telemetry.memoryUsage.heapTotal) *
          100,
      )
    : 0;

  const gridStroke = "oklch(0.5 0 0 / 0.08)";
  const axisStroke = "oklch(0.5 0 0 / 0.4)";

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-chart-2/10">
              <IconActivity className="size-5 text-chart-2" />
            </div>
            <h1 className="text-2xl font-heading font-bold tracking-tight">
              System Telemetry
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 ml-12 text-sm">
            Hardware performance and resource consumption
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            connected
              ? "gap-2 px-3 py-1.5 bg-emerald-500/8 text-emerald-500 border-emerald-500/20 uppercase tracking-wider text-xs"
              : "gap-2 px-3 py-1.5 bg-destructive/8 text-destructive border-destructive/20 uppercase tracking-wider text-xs"
          }
        >
          {connected ? (
            <span className="relative flex size-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full size-2 bg-emerald-500" />
            </span>
          ) : (
            <IconWifiOff className="size-3" />
          )}
          {connected ? "Telemetry Active" : "Disconnected"}
        </Badge>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Throughput"
          value={telemetry?.messagesPerSecond ?? 0}
          subtitle={`${telemetry?.totalMessages ?? 0} lifetime msgs`}
          icon={<IconActivity className="size-5" />}
        />
        <StatCard
          title="Avg Latency"
          value={`${telemetry?.avgLatencyMs ?? 0}ms`}
          trend={
            (telemetry?.avgLatencyMs ?? 0) < 100
              ? "up"
              : (telemetry?.avgLatencyMs ?? 0) < 500
                ? "neutral"
                : "down"
          }
          icon={<IconGauge className="size-5" />}
        />
        <StatCard
          title="Error Factor"
          value={`${telemetry?.errorRate ?? 0}%`}
          trend={
            (telemetry?.errorRate ?? 0) < 1
              ? "up"
              : (telemetry?.errorRate ?? 0) < 5
                ? "neutral"
                : "down"
          }
          icon={<IconAlertTriangle className="size-5" />}
        />
        <StatCard
          title="Active Tunnels"
          value={telemetry?.connectionCount ?? 0}
          subtitle={`Peak capacity: ${telemetry?.peakConnections ?? 0}`}
          icon={<IconPlug className="size-5" />}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Throughput chart */}
        <Card className="glass-card overflow-hidden relative group">
          <div className="accent-line-top opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <CardHeader className="pb-4 border-b border-border/20 bg-muted/10">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-chart-1" />
              Message Throughput
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <ChartContainer config={throughputConfig} className="h-48 w-full">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="fillMps" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--chart-1)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--chart-1)"
                      stopOpacity={0.0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  stroke={gridStroke}
                />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  stroke={axisStroke}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  stroke={axisStroke}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="mps"
                  stroke="var(--chart-1)"
                  fill="url(#fillMps)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Latency chart */}
        <Card className="glass-card overflow-hidden relative group">
          <div className="accent-line-top opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <CardHeader className="pb-4 border-b border-border/20 bg-muted/10">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-chart-2" />
              System Latency
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <ChartContainer config={latencyConfig} className="h-48 w-full">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="fillLatency" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--chart-2)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--chart-2)"
                      stopOpacity={0.0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  stroke={gridStroke}
                />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  stroke={axisStroke}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  unit="ms"
                  stroke={axisStroke}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="latency"
                  stroke="var(--chart-2)"
                  fill="url(#fillLatency)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Error rate chart */}
        <Card className="glass-card overflow-hidden relative group">
          <div className="accent-line-top opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <CardHeader className="pb-4 border-b border-border/20 bg-muted/10">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-chart-5" />
              Error Fluctuation Rate
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <ChartContainer config={errorConfig} className="h-48 w-full">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="fillErrors" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--chart-5)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--chart-5)"
                      stopOpacity={0.0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  stroke={gridStroke}
                />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  stroke={axisStroke}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  unit="%"
                  stroke={axisStroke}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="errors"
                  stroke="var(--chart-5)"
                  fill="url(#fillErrors)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Connections chart */}
        <Card className="glass-card overflow-hidden relative group">
          <div className="accent-line-top opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <CardHeader className="pb-4 border-b border-border/20 bg-muted/10">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-chart-3" />
              Concurrent Streams
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <ChartContainer config={connectionConfig} className="h-48 w-full">
              <BarChart data={history}>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  stroke={gridStroke}
                />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  stroke={axisStroke}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  stroke={axisStroke}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="connections"
                  fill="var(--chart-3)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* System resources */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card group hover:shadow-glow-sm hover:border-primary/20 transition-all duration-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
              <div className="size-7 rounded-lg bg-chart-2/10 flex items-center justify-center">
                <IconCpu className="size-3.5 text-chart-2" />
              </div>
              Runtime
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-heading tabular-nums">
              {formatUptime(telemetry?.uptimeSeconds ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              Continuous Uptime
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card group hover:shadow-glow-sm hover:border-primary/20 transition-all duration-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
              <div className="size-7 rounded-lg bg-chart-4/10 flex items-center justify-center">
                <IconDeviceDesktop className="size-3.5 text-chart-4" />
              </div>
              Heap Allocation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-heading tabular-nums">
              {formatBytes(telemetry?.memoryUsage?.heapUsed ?? 0)}
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted/60 overflow-hidden border border-border/30">
              <div
                className="h-full rounded-full bg-linear-to-r from-chart-4 to-primary transition-all duration-700 ease-out"
                style={{ width: `${Math.min(memHeapPercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2 font-medium">
              {memHeapPercent}% of{" "}
              {formatBytes(telemetry?.memoryUsage?.heapTotal ?? 0)}
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card group hover:shadow-glow-sm hover:border-primary/20 transition-all duration-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
              <div className="size-7 rounded-lg bg-chart-3/10 flex items-center justify-center">
                <IconServer className="size-3.5 text-chart-3" />
              </div>
              RSS Memory
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-heading tabular-nums">
              {formatBytes(telemetry?.memoryUsage?.rss ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              Resident Set Size footprint
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
