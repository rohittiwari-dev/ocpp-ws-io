"use client";

import { Copy, Loader2, Plus, Wifi, WifiOff, X } from "lucide-react";
import { useEmulatorStore } from "@/store/emulatorStore";

/* ─── helpers ─────────────────────────────────────────────────── */
const STATUS_DOT: Record<string, string> = {
  connected: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]",
  connecting: "bg-amber-400 animate-pulse",
  faulted: "bg-red-400",
  disconnected: "bg-slate-600",
};

/* ─── ChargerTabBar ───────────────────────────────────────────── */
export function ChargerTabBar() {
  const {
    chargers,
    activeChargerId,
    setActiveCharger,
    addCharger,
    removeCharger,
    duplicateCharger,
  } = useEmulatorStore();

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-[#13151f] border-b border-[#1e2030] overflow-x-auto custom-scrollbar shrink-0">
      {/* Charger Tabs */}
      {chargers.map((slot, idx) => {
        const isActive = slot.id === activeChargerId;
        const statusDot =
          STATUS_DOT[slot.runtime.status] ?? STATUS_DOT.disconnected;

        return (
          <div
            key={slot.id}
            className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer select-none transition-all duration-150 text-[12px] font-medium whitespace-nowrap min-w-[120px] max-w-[200px] border ${
              isActive
                ? "bg-[#1e2235] border-[#8b5cf6]/40 text-white shadow-[0_0_12px_rgba(139,92,246,0.12)]"
                : "bg-transparent border-transparent text-t-muted hover:bg-surface-inset hover:text-t-primary"
            }`}
            onClick={() => setActiveCharger(slot.id)}
          >
            {/* Status dot */}
            <span
              className={`shrink-0 w-1.5 h-1.5 rounded-full ${statusDot}`}
            />

            {/* Label */}
            <span className="flex-1 truncate">
              {slot.label || `Charger ${idx + 1}`}
            </span>

            {/* CPID (only when active) */}
            {isActive && (
              <span className="hidden sm:block text-[9px] font-mono text-t-faint truncate max-w-[60px]">
                {slot.config.chargePointId}
              </span>
            )}

            {/* Connection state icon */}
            <span className="shrink-0">
              {slot.runtime.status === "connected" ? (
                <Wifi className="h-3 w-3 text-emerald-400" />
              ) : slot.runtime.status === "connecting" ? (
                <Loader2 className="h-3 w-3 text-amber-400 animate-spin" />
              ) : (
                <WifiOff className="h-3 w-3 text-t-faint" />
              )}
            </span>

            {/* Context actions (visible on hover when active) */}
            {isActive && chargers.length > 1 && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateCharger(slot.id);
                  }}
                  title="Duplicate charger"
                  className="p-0.5 rounded text-t-muted hover:text-t-primary hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <Copy className="h-2.5 w-2.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCharger(slot.id);
                  }}
                  title="Remove charger"
                  className="p-0.5 rounded text-t-muted hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Add Charger */}
      <button
        onClick={() => addCharger()}
        title="Add charger"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-t-muted hover:text-white hover:bg-surface-hover border border-transparent hover:border-b-default transition-all cursor-pointer shrink-0"
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:block">Add</span>
      </button>
    </div>
  );
}
