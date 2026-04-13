import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import { DirectionBadge, TypeBadge } from "@/components/connection-badge";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

interface MessageRowProps {
  message: {
    id: string;
    identity: string;
    direction: "IN" | "OUT";
    type: "CALL" | "CALLRESULT" | "CALLERROR";
    method: string;
    messageId: string;
    params?: unknown;
    payload?: unknown;
    timestamp: string;
    latencyMs?: number;
    protocol: string;
    source: string;
  };
  className?: string;
}

export function MessageRow({ message: msg, className }: MessageRowProps) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(msg.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

  return (
    <div
      className={cn(
        "group border-b border-border/30 hover:bg-primary/3 dark:hover:bg-white/2 transition-colors duration-150",
        className,
      )}
    >
      <Button
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm h-auto rounded-none hover:bg-transparent"
      >
        <span className="text-muted-foreground/50 shrink-0 transition-transform duration-200">
          {expanded ? (
            <IconChevronDown className="size-3.5" />
          ) : (
            <IconChevronRight className="size-3.5" />
          )}
        </span>
        <span className="font-mono text-xs text-muted-foreground w-24 shrink-0 tabular-nums">
          {time}
        </span>
        <DirectionBadge direction={msg.direction} />
        <TypeBadge type={msg.type} />
        <span className="font-medium truncate min-w-0 flex-1">
          {msg.method}
        </span>
        <span className="font-mono text-xs text-muted-foreground truncate max-w-32">
          {msg.identity}
        </span>
        {msg.latencyMs != null && (
          <span
            className={cn(
              "font-mono text-xs shrink-0 tabular-nums font-medium",
              msg.latencyMs < 100
                ? "text-emerald-500"
                : msg.latencyMs < 500
                  ? "text-amber-500"
                  : "text-destructive",
            )}
          >
            {msg.latencyMs}ms
          </span>
        )}
      </Button>
      {expanded && (
        <div className="px-4 pb-3 pl-12 animate-in fade-in slide-in-from-top-1 duration-200">
          <pre className="text-xs font-mono bg-muted/40 dark:bg-black/20 rounded-lg p-3 overflow-x-auto max-h-64 text-muted-foreground border border-border/30">
            {JSON.stringify(msg.params ?? msg.payload ?? {}, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
