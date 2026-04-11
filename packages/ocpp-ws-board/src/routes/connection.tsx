import {
  IconArrowLeft,
  IconClock,
  IconGlobe,
  IconLoader2,
  IconMessage,
  IconPlug,
  IconPlugOff,
  IconShield,
  IconShieldExclamation,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConnectionBadge, ProtocolBadge } from "@/components/connection-badge";
import { MessageRow } from "@/components/message-row";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ConnectionDetail {
  identity: string;
  remoteAddress: string;
  protocol: string;
  connectedAt: string;
  disconnectedAt?: string;
  status: "online" | "offline" | "evicted";
  sessionData: Record<string, unknown>;
  securityProfile: number;
  messages: any[];
}

interface SecurityEvent {
  id: string;
  category: string;
  identity: string;
  message: string;
  severity: string;
  timestamp: string;
}

interface ErrorRecord {
  id: string;
  category: string;
  identity: string;
  message: string;
  method?: string;
  timestamp: string;
}

export default function ConnectionPage() {
  const { identity } = useParams<{ identity: string }>();
  const navigate = useNavigate();
  const [conn, setConn] = useState<ConnectionDetail | null>(null);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [errors, setErrors] = useState<ErrorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<
    "disconnect" | "purge" | null
  >(null);
  const [actionDialog, setActionDialog] = useState<
    "disconnect" | "purge" | null
  >(null);

  const fetchData = useCallback(
    (isInitial = true) => {
      if (!identity) return;
      if (isInitial) setLoading(true);
      Promise.all([
        api
          .get<ConnectionDetail>(`/connections/${encodeURIComponent(identity)}`)
          .then(setConn)
          .catch((err) => setError(err.message)),
        api
          .get<{ events: SecurityEvent[]; totalCount: number }>(
            `/security-events?identity=${encodeURIComponent(
              identity,
            )}&limit=50`,
          )
          .then((res) => setSecurityEvents(res.events ?? []))
          .catch(() => {}),
        api
          .get<{ errors: ErrorRecord[]; totalCount: number }>(
            `/errors?identity=${encodeURIComponent(identity)}&limit=50`,
          )
          .then((res) => setErrors(res.errors ?? []))
          .catch(() => {}),
      ]).finally(() => {
        if (isInitial) setLoading(false);
      });
    },
    [identity],
  );

  useEffect(() => {
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleDisconnect = async () => {
    if (!conn) return;
    setActionDialog(null);
    setActionLoading("disconnect");
    try {
      await api.post<{ success: boolean; disconnected: boolean }>(
        `/connections/${encodeURIComponent(conn.identity)}/disconnect`,
      );
      // Refetch data to reflect new status
      fetchData();
    } catch (err: any) {
      setError(err.message ?? "Failed to disconnect");
    } finally {
      setActionLoading(null);
    }
  };

  const handlePurge = async () => {
    if (!conn) return;
    setActionDialog(null);
    setActionLoading("purge");
    try {
      await api.post(`/connections/${encodeURIComponent(conn.identity)}/purge`);
      navigate("/connections");
    } catch (err: any) {
      setError(err.message ?? "Failed to purge");
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
        <div className="size-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <span className="text-sm">Loading connection…</span>
      </div>
    );
  }

  if (error || !conn) {
    return (
      <div className="space-y-4 animate-in fade-in duration-500">
        <Link
          to="/connections"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <IconArrowLeft className="size-4" />
          Back to connections
        </Link>
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <div className="size-14 rounded-2xl bg-muted/30 flex items-center justify-center mb-3">
              <IconPlug className="size-6 opacity-40" />
            </div>
            <p className="text-sm font-medium">Connection not found</p>
            <p className="text-xs mt-1 opacity-60">
              {error || `No data for "${identity}"`}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const connectedAt = new Date(conn.connectedAt);
  const msgErrors = conn.messages.filter((m: any) => m.type === "CALLERROR");
  const totalErrors = errors.length + msgErrors.length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            to="/connections"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <IconArrowLeft className="size-4" />
            Back to connections
          </Link>
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <IconPlug className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-heading font-bold tracking-tight flex items-center gap-3">
                {conn.identity}
                <ConnectionBadge status={conn.status} />
              </h1>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {conn.status === "online"
                  ? `Connected since ${connectedAt.toLocaleString()}`
                  : conn.disconnectedAt
                    ? `Disconnected at ${new Date(
                        conn.disconnectedAt,
                      ).toLocaleString()}`
                    : `Last seen ${connectedAt.toLocaleString()}`}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {conn.status === "online" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionDialog("disconnect")}
              disabled={actionLoading !== null}
              className="rounded-lg border-amber-500/20 text-amber-500 hover:bg-amber-500/10 hover:text-amber-600 transition-all"
            >
              {actionLoading === "disconnect" ? (
                <IconLoader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <IconPlugOff className="size-4 mr-1.5" />
              )}
              Disconnect
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActionDialog("purge")}
            disabled={actionLoading !== null}
            className="rounded-lg border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive transition-all"
          >
            {actionLoading === "purge" ? (
              <IconLoader2 className="size-4 mr-1.5 animate-spin" />
            ) : (
              <IconTrash className="size-4 mr-1.5" />
            )}
            Purge All Data
          </Button>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card group hover:shadow-glow-sm hover:border-primary/20 transition-all duration-300">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
              <div className="size-6 rounded-lg bg-chart-1/10 flex items-center justify-center">
                <IconGlobe className="size-3 text-chart-1" />
              </div>
              IP Address
            </div>
            <div className="font-mono text-sm font-medium">
              {conn.remoteAddress || "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card group hover:shadow-glow-sm hover:border-primary/20 transition-all duration-300">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
              <div className="size-6 rounded-lg bg-chart-3/10 flex items-center justify-center">
                <IconPlug className="size-3 text-chart-3" />
              </div>
              Protocol
            </div>
            <ProtocolBadge protocol={conn.protocol} />
          </CardContent>
        </Card>
        <Card className="glass-card group hover:shadow-glow-sm hover:border-primary/20 transition-all duration-300">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
              <div className="size-6 rounded-lg bg-chart-5/10 flex items-center justify-center">
                <IconShield className="size-3 text-chart-5" />
              </div>
              Security Profile
            </div>
            <Badge variant="outline" className="font-mono">
              SP{conn.securityProfile}
            </Badge>
          </CardContent>
        </Card>
        <Card className="glass-card group hover:shadow-glow-sm hover:border-primary/20 transition-all duration-300">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
              <div className="size-6 rounded-lg bg-chart-2/10 flex items-center justify-center">
                <IconClock className="size-3 text-chart-2" />
              </div>
              Connected At
            </div>
            <div className="text-sm font-medium">
              {connectedAt.toLocaleTimeString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="messages">
        <TabsList className="bg-muted/30 backdrop-blur-xl border border-border/30 dark:border-white/6 p-1 rounded-xl">
          <TabsTrigger
            value="messages"
            className="gap-1.5 rounded-lg data-[state=active]:bg-background/80 data-[state=active]:shadow-sm"
          >
            <IconMessage className="size-3.5" />
            Messages
            <Badge variant="secondary" className="text-[10px] px-1.5 ml-1">
              {conn.messages.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="errors"
            className="gap-1.5 rounded-lg data-[state=active]:bg-background/80 data-[state=active]:shadow-sm"
          >
            Errors
            <Badge
              variant={totalErrors > 0 ? "destructive" : "secondary"}
              className="text-[10px] px-1.5 ml-1"
            >
              {totalErrors}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="security"
            className="gap-1.5 rounded-lg data-[state=active]:bg-background/80 data-[state=active]:shadow-sm"
          >
            <IconShieldExclamation className="size-3.5" />
            Security
            {securityEvents.length > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 ml-1">
                {securityEvents.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="session"
            className="rounded-lg data-[state=active]:bg-background/80 data-[state=active]:shadow-sm"
          >
            Session Data
          </TabsTrigger>
        </TabsList>

        <TabsContent value="messages" className="mt-4">
          <Card className="glass-card overflow-hidden relative">
            <div className="accent-line-top opacity-30" />
            <CardContent className="p-0">
              {conn.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <div className="size-14 rounded-2xl bg-primary/8 flex items-center justify-center mb-3">
                    <IconMessage className="size-6 text-primary/50" />
                  </div>
                  <p className="text-sm font-medium">No messages recorded</p>
                </div>
              ) : (
                <div className="divide-y divide-border/20">
                  {conn.messages.map((msg: any) => (
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
        </TabsContent>

        <TabsContent value="errors" className="mt-4">
          <Card className="glass-card overflow-hidden relative">
            <div className="accent-line-top opacity-30" />
            <CardContent className="p-0">
              {msgErrors.length === 0 && errors.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <div className="size-14 rounded-2xl bg-emerald-500/8 flex items-center justify-center mb-3">
                    <IconShield className="size-6 text-emerald-500/50" />
                  </div>
                  <p className="text-sm font-medium">
                    No errors — looking good!
                  </p>
                </div>
              ) : (
                <>
                  {errors.map((err) => (
                    <div
                      key={err.id}
                      className="px-4 py-3 border-b border-border/20 border-l-2 border-l-destructive/60 bg-destructive/3"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 font-mono severity-high"
                        >
                          {err.category}
                        </Badge>
                        {err.method && (
                          <span className="text-xs font-mono text-muted-foreground">
                            {err.method}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                          {new Date(err.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-foreground/80">
                        {err.message}
                      </p>
                    </div>
                  ))}
                  {msgErrors.map((msg: any) => (
                    <MessageRow key={msg.id} message={msg} />
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <Card className="glass-card overflow-hidden relative">
            <div className="accent-line-top opacity-30" />
            <CardContent className="p-0">
              {securityEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <div className="size-14 rounded-2xl bg-emerald-500/8 flex items-center justify-center mb-3">
                    <IconShield className="size-6 text-emerald-500/50" />
                  </div>
                  <p className="text-sm font-medium">
                    No security events for this station
                  </p>
                  <p className="text-xs mt-1 opacity-60">All clear</p>
                </div>
              ) : (
                <div className="divide-y divide-border/20">
                  {securityEvents.map((evt) => (
                    <div
                      key={evt.id}
                      className={cn(
                        "px-4 py-3",
                        evt.severity === "critical" &&
                          "border-l-2 border-l-red-500/60 bg-red-500/3",
                        evt.severity === "high" &&
                          "border-l-2 border-l-orange-500/60 bg-orange-500/3",
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 font-mono",
                            `severity-${evt.severity}`,
                          )}
                        >
                          {evt.severity.toUpperCase()}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 font-mono bg-muted/20 text-muted-foreground"
                        >
                          {evt.category}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                          {new Date(evt.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-foreground/80">
                        {evt.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="session" className="mt-4">
          <Card className="glass-card overflow-hidden relative">
            <div className="accent-line-top opacity-30" />
            <CardHeader>
              <CardTitle className="text-base font-heading">
                Session Data
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs font-mono bg-muted/40 dark:bg-black/20 rounded-lg p-4 overflow-x-auto border border-border/30">
                {JSON.stringify(conn.sessionData, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={!!actionDialog}
        onOpenChange={(open) => !open && setActionDialog(null)}
      >
        <AlertDialogContent className="glass-card border-border/40">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionDialog === "disconnect"
                ? `Disconnect "${conn.identity}"?`
                : `Purge all data for "${conn.identity}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionDialog === "disconnect"
                ? "This will close the WebSocket connection for this station immediately."
                : "This will disconnect the station and delete all messages, security events, and error logs. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "rounded-lg",
                actionDialog === "purge"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-amber-500 text-primary-foreground hover:bg-amber-600",
              )}
              onClick={
                actionDialog === "disconnect" ? handleDisconnect : handlePurge
              }
            >
              {actionDialog === "disconnect" ? "Disconnect" : "Purge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
