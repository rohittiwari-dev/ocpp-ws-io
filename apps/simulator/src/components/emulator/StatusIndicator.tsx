"use client";

import { AlertTriangle, Loader2, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useActiveCharger } from "@/hooks/useActiveCharger";

const STATUS_MAP: Record<
  string, // Changed from ConnectionStatus to string
  { label: string; icon: React.ReactNode; cls: string }
> = {
  connected: {
    label: "Connected",
    icon: <Wifi className="h-3 w-3" />,
    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  },
  connecting: {
    label: "Connecting",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    cls: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  },
  faulted: {
    label: "Faulted",
    icon: <AlertTriangle className="h-3 w-3" />,
    cls: "bg-red-500/15 text-red-400 border-red-500/40",
  },
  disconnected: {
    label: "Disconnected",
    icon: <WifiOff className="h-3 w-3" />,
    cls: "bg-surface-hover text-t-muted border-b-default",
  },
};

export function StatusIndicator() {
  const { status, config } = useActiveCharger();
  const s = STATUS_MAP[status];

  return (
    <div className="flex items-center gap-2">
      {status === "connected" && (
        <span className="text-xs text-t-muted font-mono hidden sm:block">
          {config.chargePointId}
        </span>
      )}
      <Badge
        variant="outline"
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium ${s.cls}`}
      >
        {s.icon}
      </Badge>
    </div>
  );
}
