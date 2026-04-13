import {
  IconDotsVertical,
  IconExternalLink,
  IconPlug,
  IconPlugOff,
  IconRefresh,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConnectionBadge, ProtocolBadge } from "@/components/connection-badge";
import { DataTable } from "@/components/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Connection {
  identity: string;
  remoteAddress: string;
  protocol: string;
  connectedAt: string;
  disconnectedAt?: string;
  status: "online" | "offline" | "evicted";
  securityProfile: number;
  errorCount?: number;
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    "all" | "online" | "offline" | "evicted" | "errors"
  >("all");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [actionDialog, setActionDialog] = useState<{
    type: "disconnect" | "purge";
    identity: string;
  } | null>(null);

  const fetchConnections = () => {
    setLoading(true);
    api
      .get<Connection[]>("/connections")
      .then(setConnections)
      .finally(() => setLoading(false));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: needed
  useEffect(() => {
    fetchConnections();
    const interval = setInterval(fetchConnections, 5000);
    return () => clearInterval(interval);
  }, []);

  const filtered = connections.filter((c) => {
    if (filter === "errors" && (c.errorCount ?? 0) === 0) return false;
    if (filter !== "all" && filter !== "errors" && c.status !== filter)
      return false;
    if (search && !c.identity.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const onlineCount = connections.filter((c) => c.status === "online").length;
  const offlineCount = connections.filter((c) => c.status === "offline").length;
  const evictedCount = connections.filter((c) => c.status === "evicted").length;
  const errorCount = connections.filter((c) => (c.errorCount ?? 0) > 0).length;

  const handleReconnect = async (identity: string) => {
    await api.post(`/connections/${encodeURIComponent(identity)}/reconnect`);
    fetchConnections();
  };

  const handleActionConfirm = async () => {
    if (!actionDialog) return;
    const { type, identity } = actionDialog;
    setActionDialog(null);
    if (type === "disconnect") {
      await api.post(`/connections/${encodeURIComponent(identity)}/disconnect`);
    } else if (type === "purge") {
      await api.post(`/connections/${encodeURIComponent(identity)}/purge`);
    }
    fetchConnections();
  };

  const formatDuration = (connectedAt: string, disconnectedAt?: string) => {
    const start = new Date(connectedAt).getTime();
    const end = disconnectedAt
      ? new Date(disconnectedAt).getTime()
      : Date.now();
    const seconds = Math.floor((end - start) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const pageCount = Math.ceil(filtered.length / pageSize);
  const paginatedData = filtered.slice((page - 1) * pageSize, page * pageSize);

  const columns = [
    {
      header: "Station ID",
      accessorKey: "identity" as keyof Connection,
      cell: (conn: Connection) => (
        <Link
          to={`/connection/view/${encodeURIComponent(conn.identity)}`}
          className="font-bold tracking-tight text-foreground hover:text-primary transition-colors inline-flex items-center gap-2 group/link"
        >
          {conn.identity}
          <IconExternalLink className="size-3.5 opacity-0 -translate-x-2 group-hover/link:opacity-100 group-hover/link:translate-x-0 transition-all text-primary" />
        </Link>
      ),
    },
    {
      header: "Status",
      accessorKey: "status" as keyof Connection,
      cell: (conn: Connection) => <ConnectionBadge status={conn.status} />,
    },
    {
      header: "IP Address",
      accessorKey: "remoteAddress" as keyof Connection,
      cell: (conn: Connection) => (
        <span className="font-mono text-xs text-muted-foreground">
          {conn.remoteAddress || "—"}
        </span>
      ),
    },
    {
      header: "Protocol",
      accessorKey: "protocol" as keyof Connection,
      cell: (conn: Connection) => <ProtocolBadge protocol={conn.protocol} />,
    },
    {
      header: "Security",
      accessorKey: "securityProfile" as keyof Connection,
      cell: (conn: Connection) => (
        <Badge
          variant="outline"
          className="text-[10px] font-mono tracking-wider bg-background/40"
        >
          SP{conn.securityProfile}
        </Badge>
      ),
    },
    {
      header: "Errors",
      accessorKey: "errorCount" as keyof Connection,
      cell: (conn: Connection) => (
        <Badge
          variant={
            conn.errorCount && conn.errorCount > 0 ? "destructive" : "secondary"
          }
          className="text-[10px] font-mono tracking-wider"
        >
          {conn.errorCount || 0} Error{conn.errorCount !== 1 ? "s" : ""}
        </Badge>
      ),
    },
    {
      header: "Duration",
      cell: (conn: Connection) => (
        <span className="font-mono text-xs text-muted-foreground tabular-nums font-medium">
          {formatDuration(conn.connectedAt, conn.disconnectedAt)}
        </span>
      ),
    },
    {
      header: "",
      className: "text-right w-12",
      cell: (conn: Connection) => (
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <IconDotsVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48 glass rounded-xl border-border/30"
          >
            {conn.status === "online" && (
              <DropdownMenuItem
                onClick={() =>
                  setActionDialog({
                    type: "disconnect",
                    identity: conn.identity,
                  })
                }
                className="text-amber-500 hover:text-amber-400 focus:text-amber-400 cursor-pointer font-medium"
              >
                <IconPlugOff className="size-4 mr-2" />
                Disconnect
              </DropdownMenuItem>
            )}
            {conn.status === "offline" && (
              <DropdownMenuItem
                onClick={() => handleReconnect(conn.identity)}
                className="text-emerald-500 hover:text-emerald-400 focus:text-emerald-400 cursor-pointer font-medium"
              >
                <IconRefresh className="size-4 mr-2" />
                Reconnect
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() =>
                setActionDialog({ type: "purge", identity: conn.identity })
              }
              className="text-destructive hover:text-destructive focus:text-destructive cursor-pointer font-medium"
            >
              <IconTrash className="size-4 mr-2" />
              Purge Record
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <IconPlug className="size-5 text-primary" />
            </div>
            <h1 className="text-2xl font-heading font-bold tracking-tight">
              Station Connections
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 ml-12 text-sm">
            Manage and monitor connected EV chargers
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchConnections}
          className="h-10 px-4 rounded-xl border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/30 text-primary transition-all"
        >
          <IconRefresh
            className={cn("size-4 mr-2", loading && "animate-spin")}
          />
          <span className="font-semibold">Refresh</span>
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap p-1.5 glass rounded-2xl">
        <div className="relative flex-1 max-w-sm">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground opacity-50" />
          <Input
            placeholder="Search by identity label..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 h-11 bg-background/50 border border-border/40 dark:border-white/10 shadow-none rounded-xl hover:bg-background/80 transition-colors focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </div>
        <div className="flex gap-1 p-1 bg-background/40 rounded-xl border border-border/30 dark:border-white/6">
          {(
            [
              { key: "all", label: "All", count: connections.length },
              { key: "online", label: "Online", count: onlineCount },
              { key: "offline", label: "Offline", count: offlineCount },
              { key: "evicted", label: "Evicted", count: evictedCount },
            ] as const
          ).map((f) => (
            <Button
              key={f.key}
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={cn(
                "px-3 py-1.5 h-auto rounded-lg text-sm font-medium transition-all select-none",
                filter === f.key
                  ? "bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary shadow-sm"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {f.label}
              <span
                className={cn(
                  "ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums min-w-5",
                  filter === f.key
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {f.count}
              </span>
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilter("errors");
              setPage(1);
            }}
            className={cn(
              "px-3 py-1.5 h-auto rounded-lg text-sm font-medium transition-all select-none",
              filter === "errors"
                ? "bg-destructive/15 text-destructive dark:bg-destructive/20 shadow-sm"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            Errors
            <span
              className={cn(
                "ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums min-w-5",
                filter === "errors"
                  ? "bg-destructive/20 text-destructive"
                  : errorCount > 0
                    ? "bg-destructive/20 text-destructive"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {errorCount}
            </span>
          </Button>
        </div>
      </div>

      <DataTable
        data={paginatedData}
        columns={columns}
        pageCount={pageCount}
        currentPage={page}
        onPageChange={setPage}
        isLoading={loading && connections.length === 0}
      />

      <AlertDialog
        open={!!actionDialog}
        onOpenChange={(open) => !open && setActionDialog(null)}
      >
        <AlertDialogContent className="glass-card border-border/40">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionDialog?.type === "disconnect"
                ? `Disconnect "${actionDialog.identity}"?`
                : `Purge all data for "${actionDialog?.identity}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionDialog?.type === "disconnect"
                ? "This will close the WebSocket connection for this station immediately."
                : "This will disconnect the station and delete all messages, security events, and error logs. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "rounded-lg",
                actionDialog?.type === "purge"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-amber-500 text-primary-foreground hover:bg-amber-600",
              )}
              onClick={handleActionConfirm}
            >
              {actionDialog?.type === "disconnect" ? "Disconnect" : "Purge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
