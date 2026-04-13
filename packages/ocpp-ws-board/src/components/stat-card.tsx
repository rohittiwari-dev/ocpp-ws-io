import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  className,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        "group relative overflow-hidden transition-all duration-300 ease-out",
        "glass-card",
        "hover:-translate-y-0.5 hover:shadow-glow-sm hover:border-primary/20",
        className,
      )}
    >
      {/* Accent line on hover */}
      <div className="accent-line-top opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2 min-w-0">
            <p className="text-[13px] font-medium text-muted-foreground leading-none tracking-wide">
              {title}
            </p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums leading-none">
              {value}
            </p>
            {subtitle && (
              <p
                className={cn(
                  "text-xs flex items-center gap-1.5 leading-none",
                  trend === "up" && "text-emerald-600 dark:text-emerald-400",
                  trend === "down" && "text-destructive",
                  !trend && "text-muted-foreground",
                )}
              >
                {trend === "up" && (
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                )}
                {trend === "down" && (
                  <span className="size-1.5 rounded-full bg-destructive animate-pulse" />
                )}
                {subtitle}
              </p>
            )}
          </div>
          {icon && (
            <div
              className={cn(
                "flex items-center justify-center size-10 rounded-xl shrink-0 transition-all duration-300",
                "bg-primary/8 text-primary/60",
                "group-hover:bg-primary/15 group-hover:text-primary group-hover:shadow-glow-sm",
              )}
            >
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
