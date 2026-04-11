import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ConnectionBadgeProps {
  status: "online" | "offline" | "evicted";
  className?: string;
}

export function ConnectionBadge({ status, className }: ConnectionBadgeProps) {
  return (
    <Badge
      variant={status === "online" ? "default" : "secondary"}
      className={cn(
        "gap-1.5 font-medium",
        status === "online" &&
          "bg-emerald-500/15 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20",
        status === "offline" && "bg-muted text-muted-foreground",
        status === "evicted" &&
          "bg-amber-500/15 text-amber-600 border-amber-500/20 hover:bg-amber-500/20",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "online" && "bg-emerald-500 animate-pulse",
          status === "offline" && "bg-muted-foreground/40",
          status === "evicted" && "bg-amber-500",
        )}
      />
      {status === "online"
        ? "Online"
        : status === "evicted"
          ? "Evicted"
          : "Offline"}
    </Badge>
  );
}

interface DirectionBadgeProps {
  direction: "IN" | "OUT";
  className?: string;
}

export function DirectionBadge({ direction, className }: DirectionBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px] px-1.5",
        direction === "IN"
          ? "border-blue-500/30 text-blue-500 bg-blue-500/10"
          : "border-amber-500/30 text-amber-500 bg-amber-500/10",
        className,
      )}
    >
      {direction}
    </Badge>
  );
}

interface TypeBadgeProps {
  type: "CALL" | "CALLRESULT" | "CALLERROR";
  className?: string;
}

export function TypeBadge({ type, className }: TypeBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px] px-1.5",
        type === "CALL" && "border-primary/30 text-primary bg-primary/10",
        type === "CALLRESULT" &&
          "border-emerald-500/30 text-emerald-500 bg-emerald-500/10",
        type === "CALLERROR" &&
          "border-destructive/30 text-destructive bg-destructive/10",
        className,
      )}
    >
      {type}
    </Badge>
  );
}

interface ProtocolBadgeProps {
  protocol: string;
  className?: string;
}

export function ProtocolBadge({ protocol, className }: ProtocolBadgeProps) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px]", className)}>
      {protocol || "—"}
    </Badge>
  );
}
