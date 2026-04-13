import {
  IconAlertTriangle,
  IconBolt,
  IconFilter,
  IconSearch,
  IconShield,
  IconShieldX,
  IconWifiOff,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useSSE } from "@/lib/sse";
import { cn } from "@/lib/utils";

interface SecurityEvent {
  id: string;
  category: string;
  identity: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  details?: Record<string, unknown>;
  timestamp: string;
}

const categoryIcons: Record<string, typeof IconShield> = {
  AUTH_FAILED: IconShieldX,
  RATE_LIMIT: IconBolt,
  ANOMALY: IconAlertTriangle,
  PROTOCOL_VIOLATION: IconAlertTriangle,
  POLICY_REJECTION: IconAlertTriangle,
};

const categoryLabels: Record<string, string> = {
  AUTH_FAILED: "Auth Failed",
  RATE_LIMIT: "Rate Limit",
  ANOMALY: "Anomaly",
  PROTOCOL_VIOLATION: "Protocol",
  POLICY_REJECTION: "Policy",
};

const severityClasses: Record<string, string> = {
  low: "severity-low",
  medium: "severity-medium",
  high: "severity-high",
  critical: "severity-critical",
};

export default function SecurityPage() {
  const [initialEvents, setInitialEvents] = useState<SecurityEvent[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data: liveEvents, connected } = useSSE<SecurityEvent>(
    "/security-events/stream",
    "security",
  );

  useEffect(() => {
    api
      .get<{ events: SecurityEvent[]; totalCount: number }>(
        "/security-events?limit=1000",
      )
      .then((res) => setInitialEvents(res.events ?? []));
  }, []);

  // Merge & deduplicate
  const allEvents = [...liveEvents, ...initialEvents];
  const seen = new Set<string>();
  const deduped = allEvents.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  // Apply filters
  const filtered = deduped.filter((e) => {
    if (search) {
      const s = search.toLowerCase();
      if (
        !e.identity.toLowerCase().includes(s) &&
        !e.message.toLowerCase().includes(s)
      )
        return false;
    }
    if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
    if (severityFilter !== "all" && e.severity !== severityFilter) return false;
    return true;
  });

  const categories = [...new Set(deduped.map((e) => e.category))].sort();

  // Stats
  const criticalCount = deduped.filter((e) => e.severity === "critical").length;
  const highCount = deduped.filter((e) => e.severity === "high").length;

  const pageCount = Math.ceil(filtered.length / pageSize);
  const paginatedData = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-chart-5/10">
              <IconAlertTriangle className="size-5 text-chart-5" />
            </div>
            <h1 className="text-2xl font-heading font-bold tracking-tight">
              Security Events
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 ml-12 text-sm">
            Real-time security monitoring and threat detection
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(criticalCount > 0 || highCount > 0) && (
            <Badge
              variant="outline"
              className="gap-2 px-3 py-1.5 severity-critical uppercase tracking-wider text-xs animate-glow-pulse"
            >
              <span className="relative flex size-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full size-2 bg-red-500" />
              </span>
              {criticalCount + highCount} Alerts
            </Badge>
          )}
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
            {connected ? "Monitoring" : "Disconnected"}
          </Badge>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap p-1.5 glass rounded-2xl">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground opacity-50" />
          <Input
            placeholder="Search identity or message..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 h-11 bg-background/50 border border-border/40 dark:border-white/10 shadow-none rounded-xl hover:bg-background/80 transition-colors focus-visible:ring-1 focus-visible:ring-primary/30"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 size-8 hover:bg-muted/50 rounded-lg text-muted-foreground"
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
            >
              <IconX className="size-4" />
            </Button>
          )}
        </div>

        <Select
          value={categoryFilter}
          onValueChange={(val) => {
            setCategoryFilter(val);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44 h-11 bg-background/50 border border-border/40 dark:border-white/10 shadow-none rounded-xl hover:bg-background/80 transition-colors focus:ring-1 focus:ring-primary/30">
            <IconFilter className="size-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent className="glass rounded-xl border-border/30">
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {categoryLabels[c] ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={severityFilter}
          onValueChange={(val) => {
            setSeverityFilter(val);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36 h-11 bg-background/50 border border-border/40 dark:border-white/10 shadow-none rounded-xl hover:bg-background/80 transition-colors focus:ring-1 focus:ring-primary/30">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent className="glass rounded-xl border-border/30">
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Badge
          variant="secondary"
          className="h-11 px-4 rounded-xl bg-background/50 border border-border/40 dark:border-white/10 text-muted-foreground font-medium flex items-center justify-center pointer-events-none text-sm tracking-wide"
        >
          <span className="text-foreground mr-1.5 font-bold tabular-nums">
            {filtered.length}
          </span>
          events
        </Badge>
      </div>

      {/* Events */}
      <Card className="glass-card overflow-hidden relative">
        <div className="accent-line-top opacity-40" />
        <CardContent className="p-0 relative z-10">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <div className="size-16 rounded-2xl bg-emerald-500/8 flex items-center justify-center mb-4">
                <IconShield className="size-8 text-emerald-500/50" />
              </div>
              <p className="text-sm font-medium tracking-wide">
                No security events
              </p>
              <p className="text-xs mt-2 opacity-60">
                {search || categoryFilter !== "all" || severityFilter !== "all"
                  ? "Try expanding your search criteria"
                  : "All clear — no threats detected"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {paginatedData.map((evt) => (
                <SecurityEventRow key={evt.id} event={evt} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="py-3 px-4 border border-border/30 dark:border-white/6 border-t-0 rounded-b-xl bg-muted/20 backdrop-blur-xl -mt-6">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setPage(page - 1)}
                  className={
                    page === 1
                      ? "pointer-events-none opacity-50 cursor-not-allowed"
                      : "cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                  }
                />
              </PaginationItem>
              <PaginationItem>
                <span className="text-sm font-medium text-muted-foreground px-4">
                  Page{" "}
                  <span className="text-foreground font-semibold">{page}</span>{" "}
                  of {pageCount}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={() => setPage(page + 1)}
                  className={
                    page === pageCount
                      ? "pointer-events-none opacity-50 cursor-not-allowed"
                      : "cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}

function SecurityEventRow({ event: evt }: { event: SecurityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = categoryIcons[evt.category] ?? IconShield;
  const time = new Date(evt.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      className={cn(
        "group hover:bg-primary/3 dark:hover:bg-white/2 transition-colors duration-150",
        evt.severity === "critical" &&
          "border-l-2 border-l-red-500/60 bg-red-500/4",
        evt.severity === "high" &&
          "border-l-2 border-l-orange-500/60 bg-orange-500/3",
      )}
    >
      <Button
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm h-auto rounded-none hover:bg-transparent"
      >
        <div
          className={cn(
            "size-8 rounded-lg flex items-center justify-center shrink-0",
            severityClasses[evt.severity],
          )}
        >
          <Icon className="size-4" />
        </div>
        <span className="font-mono text-xs text-muted-foreground w-20 shrink-0 tabular-nums">
          {time}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 font-mono shrink-0",
            severityClasses[evt.severity],
          )}
        >
          {evt.severity.toUpperCase()}
        </Badge>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 font-mono bg-muted/20 text-muted-foreground shrink-0"
        >
          {categoryLabels[evt.category] ?? evt.category}
        </Badge>
        <span className="font-medium truncate min-w-0 flex-1">
          {evt.message}
        </span>
        <span className="font-mono text-xs text-muted-foreground truncate max-w-32">
          {evt.identity}
        </span>
      </Button>
      {expanded && evt.details && (
        <div className="px-4 pb-3 pl-16 animate-in fade-in slide-in-from-top-1 duration-200">
          <pre className="text-xs font-mono bg-muted/40 dark:bg-black/20 rounded-lg p-3 overflow-x-auto max-h-64 text-muted-foreground border border-border/30">
            {JSON.stringify(evt.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
