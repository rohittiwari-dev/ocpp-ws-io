import {
  IconMessage,
  IconSearch,
  IconWifiOff,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { MessageRow } from "@/components/message-row";
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

export default function MessagesPage() {
  const [initialMessages, setInitialMessages] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data: liveMessages, connected } = useSSE<any>(
    "/messages/stream",
    "message",
  );

  useEffect(() => {
    // Initial fetch up to 1000 messages for exploring history
    api.get<any[]>("/messages?limit=1000").then(setInitialMessages);
  }, []);

  // Merge live + initial, deduplicate by id
  const allMessages = [...liveMessages, ...initialMessages];
  const seen = new Set<string>();
  const deduped = allMessages.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  // Apply filters
  const filtered = deduped.filter((m) => {
    if (search) {
      const s = search.toLowerCase();
      if (
        !m.identity.toLowerCase().includes(s) &&
        !m.method.toLowerCase().includes(s)
      )
        return false;
    }
    if (methodFilter !== "all" && m.method !== methodFilter) return false;
    if (directionFilter !== "all" && m.direction !== directionFilter)
      return false;
    if (typeFilter !== "all" && m.type !== typeFilter) return false;
    return true;
  });

  // Extract unique methods for filter dropdown
  const methods = [...new Set(deduped.map((m) => m.method))].sort();

  const pageCount = Math.ceil(filtered.length / pageSize);
  const paginatedData = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-chart-4/10">
              <IconMessage className="size-5 text-chart-4" />
            </div>
            <h1 className="text-2xl font-heading font-bold tracking-tight">
              Message Stream
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 ml-12 text-sm">
            Real-time deep packet inspection of OCPP payloads
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
          {connected ? "Stream Active" : "Stream Paused"}
        </Badge>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap p-1.5 glass rounded-2xl">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground opacity-50" />
          <Input
            placeholder="Search identity or method..."
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
              className="absolute right-1 top-1/2 -translate-y-1/2 size-8 hover:bg-muted/50 rounded-lg text-muted-foreground transition-colors"
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
          value={directionFilter}
          onValueChange={(val) => {
            setDirectionFilter(val);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-32 h-11 bg-background/50 border border-border/40 dark:border-white/10 shadow-none rounded-xl hover:bg-background/80 transition-colors focus:ring-1 focus:ring-primary/30">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent className="glass rounded-xl border-border/30">
            <SelectItem value="all">Direction</SelectItem>
            <SelectItem value="IN">Inbound</SelectItem>
            <SelectItem value="OUT">Outbound</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={typeFilter}
          onValueChange={(val) => {
            setTypeFilter(val);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36 h-11 bg-background/50 border border-border/40 dark:border-white/10 shadow-none rounded-xl hover:bg-background/80 transition-colors focus:ring-1 focus:ring-primary/30">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent className="glass rounded-xl border-border/30">
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="CALL">CALL</SelectItem>
            <SelectItem value="CALLRESULT">CALLRESULT</SelectItem>
            <SelectItem value="CALLERROR">CALLERROR</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={methodFilter}
          onValueChange={(val) => {
            setMethodFilter(val);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48 h-11 bg-background/50 border border-border/40 dark:border-white/10 shadow-none rounded-xl hover:bg-background/80 transition-colors focus:ring-1 focus:ring-primary/30">
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent className="glass rounded-xl border-border/30">
            <SelectItem value="all">All Methods</SelectItem>
            {methods.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Badge
          variant="secondary"
          className="h-11 px-4 rounded-xl bg-background/50 border border-border/40 dark:border-white/10 text-muted-foreground font-medium flex items-center justify-center pointer-events-none text-sm tracking-wide"
        >
          <span className="text-foreground mr-1.5 font-bold tabular-nums">
            {filtered.length}
          </span>
          packets
        </Badge>
      </div>

      {/* Messages */}
      <Card className="glass-card overflow-hidden relative">
        <div className="accent-line-top opacity-40" />
        <CardContent className="p-0 relative z-10">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <div className="size-16 rounded-2xl bg-primary/8 flex items-center justify-center mb-4">
                <IconMessage className="size-8 text-primary/40" />
              </div>
              <p className="text-sm font-medium tracking-wide">
                No packets match filter
              </p>
              <p className="text-xs mt-2 opacity-60">
                {search ||
                methodFilter !== "all" ||
                directionFilter !== "all" ||
                typeFilter !== "all"
                  ? "Try expanding your search criteria"
                  : "Awaiting incoming payloads"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {paginatedData.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    msg.type === "CALLERROR" &&
                      "border-l-2 border-l-destructive/60 bg-destructive/3",
                  )}
                >
                  <MessageRow message={msg} />
                </div>
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
