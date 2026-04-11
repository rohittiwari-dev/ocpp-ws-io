import {
  IconActivity,
  IconAlertTriangle,
  IconCircleCheckFilled,
  IconClock,
  IconGauge,
  IconMessage,
  IconPlug,
  IconServer,
  IconShieldExclamation,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageRow } from "@/components/message-row";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { useSSE, useSSELatest } from "@/lib/sse";

export interface OverviewData {
  connectedClients: number;
  totalConnections: number;
  messagesPerSecond: number;
  avgLatencyMs: number;
  errorRate: number;
  uptimeSeconds: number;
  totalMessages: number;
  recentMessages: any[];
  securityEventCount: number;
  errorCount: number;
  systemEventCount: number;
}

export interface TelemetryData {
  messagesPerSecond: number;
  avgLatencyMs: number;
  errorRate: number;
  connectionCount: number;
  uptimeSeconds: number;
  totalMessages: number;
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function OverviewPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const { data: liveTelemetry } = useSSELatest<TelemetryData>(
    "/telemetry/stream",
    "telemetry",
  );
  const { data: liveMessages } = useSSE<any>("/messages/stream", "message");

  useEffect(() => {
    api.get<OverviewData>("/overview").then(setOverview);
  }, []);

  const tele: TelemetryData | null =
    liveTelemetry ?? (overview as unknown as TelemetryData) ?? null;
  const recentMsgs =
    liveMessages.length > 0
      ? liveMessages.slice(0, 10)
      : (overview?.recentMessages ?? []);

  const securityCount = overview?.securityEventCount ?? 0;
  const errorCount = overview?.errorCount ?? 0;
  const heapPercent =
    tele?.memoryUsage?.heapTotal && tele?.memoryUsage?.heapUsed
      ? Math.round(
          (tele.memoryUsage.heapUsed / tele.memoryUsage.heapTotal) * 100,
        )
      : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <IconGauge className="size-5 text-primary" />
            </div>
            <h1 className="text-2xl font-heading font-bold tracking-tight">
              Overview
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {securityCount > 0 && (
              <Link to="/security">
                <Badge variant="destructive" className="gap-1.5 cursor-pointer">
                  <IconShieldExclamation className="size-3" />
                  {securityCount} Security{" "}
                  {securityCount === 1 ? "Event" : "Events"}
                </Badge>
              </Link>
            )}
            <Badge
              variant="outline"
              className="gap-1.5 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/8"
            >
              <IconCircleCheckFilled className="size-3" />
              Healthy
            </Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground ml-12">
          Real-time observability for your OCPP infrastructure.
        </p>
      </div>

      <Separator className="opacity-50" />

      {/* Primary metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Connections"
          value={tele?.connectionCount ?? overview?.connectedClients ?? 0}
          subtitle={`${overview?.totalConnections ?? 0} lifetime`}
          icon={<IconPlug className="size-4" />}
        />
        <StatCard
          title="Throughput"
          value={`${tele?.messagesPerSecond ?? 0} msg/s`}
          subtitle={`${
            tele?.totalMessages ?? overview?.totalMessages ?? 0
          } total processed`}
          icon={<IconMessage className="size-4" />}
        />
        <StatCard
          title="Avg Latency"
          value={`${tele?.avgLatencyMs ?? 0}ms`}
          subtitle={
            (tele?.avgLatencyMs ?? 0) < 100
              ? "Optimal"
              : (tele?.avgLatencyMs ?? 0) < 500
                ? "Moderate"
                : "High"
          }
          trend={
            (tele?.avgLatencyMs ?? 0) < 100
              ? "up"
              : (tele?.avgLatencyMs ?? 0) < 500
                ? "neutral"
                : "down"
          }
          icon={<IconGauge className="size-4" />}
        />
        <StatCard
          title="Error Rate"
          value={`${tele?.errorRate ?? 0}%`}
          subtitle={
            (tele?.errorRate ?? 0) < 1
              ? "Normal"
              : (tele?.errorRate ?? 0) < 5
                ? "Acceptable"
                : "Critical"
          }
          trend={
            (tele?.errorRate ?? 0) < 1
              ? "up"
              : (tele?.errorRate ?? 0) < 5
                ? "neutral"
                : "down"
          }
          icon={<IconAlertTriangle className="size-4" />}
        />
      </div>

      {/* Secondary metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Uptime"
          value={formatUptime(tele?.uptimeSeconds ?? 0)}
          icon={<IconClock className="size-4" />}
        />
        <StatCard
          title="Heap Memory"
          value={formatBytes(tele?.memoryUsage?.heapUsed ?? 0)}
          subtitle={`${heapPercent}% of ${formatBytes(
            tele?.memoryUsage?.heapTotal ?? 0,
          )}`}
          trend={
            heapPercent < 70 ? "up" : heapPercent < 90 ? "neutral" : "down"
          }
          icon={<IconServer className="size-4" />}
        />
        <StatCard
          title="RSS Memory"
          value={formatBytes(tele?.memoryUsage?.rss ?? 0)}
          subtitle="Resident Set Size"
          icon={<IconActivity className="size-4" />}
        />
        <StatCard
          title="Security Events"
          value={securityCount}
          subtitle={
            errorCount > 0 ? `${errorCount} errors tracked` : "All clear"
          }
          trend={
            securityCount === 0 ? "up" : securityCount < 5 ? "neutral" : "down"
          }
          icon={<IconShieldExclamation className="size-4" />}
        />
      </div>

      {/* Live message stream */}
      <Card className="glass-card overflow-hidden relative group">
        <div className="accent-line-top opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <div className="absolute inset-x-0 -top-8 h-24 bg-mesh-gradient pointer-events-none" />
        <CardHeader className="flex flex-row items-center justify-between py-5 px-6 relative">
          <div className="space-y-0.5">
            <CardTitle className="text-base font-heading">
              Live Message Stream
            </CardTitle>
            <CardDescription>Latest 10 events</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {liveMessages.length > 0 && (
              <Badge
                variant="outline"
                className="gap-1.5 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/8 text-[10px] uppercase tracking-wider font-mono"
              >
                <span className="relative flex size-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full size-1.5 bg-emerald-500" />
                </span>
                Live
              </Badge>
            )}
            <Link to="/messages">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all"
              >
                View All
              </Button>
            </Link>
          </div>
        </CardHeader>
        <Separator className="opacity-30" />
        <CardContent className="p-0">
          {recentMsgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <div className="size-14 rounded-2xl bg-primary/8 flex items-center justify-center mb-3">
                <IconActivity className="size-6 text-primary/50 animate-pulse" />
              </div>
              <p className="text-sm font-medium">Awaiting messages…</p>
              <p className="text-xs text-muted-foreground mt-1">
                Data streams automatically on connection
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {recentMsgs.map((msg: any) => (
                <div key={msg.id}>
                  <MessageRow message={msg} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
