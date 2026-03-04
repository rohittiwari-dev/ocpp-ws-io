"use client";

import { Loader2, Power, PowerOff, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ocppService } from "@/lib/ocppClient";
import { useEmulatorStore } from "@/store/emulatorStore";

export function HeaderControls() {
  const { status } = useEmulatorStore();
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className="flex items-center gap-2">
      {/* Quick actions – only when connected */}
      {isConnected && (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => ocppService.sendBootNotification()}
            className="h-8 gap-1.5 text-slate-400 hover:text-white hover:bg-white/10 text-xs hidden sm:flex"
          >
            <RefreshCw className="h-3.5 w-3.5 text-blue-400" />
            Boot
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => ocppService.sendHeartbeat()}
            className="h-8 gap-1.5 text-slate-400 hover:text-white hover:bg-white/10 text-xs hidden sm:flex"
          >
            <Zap className="h-3.5 w-3.5 text-pink-400" />
            Heartbeat
          </Button>
          <div className="h-5 w-px bg-white/10" />
        </>
      )}

      {/* Connect / Disconnect */}
      <Button
        size="sm"
        disabled={isConnecting}
        onClick={() =>
          isConnected ? ocppService.disconnect() : ocppService.connect()
        }
        className={`h-8 px-4 gap-2 font-semibold text-sm rounded-lg transition-all ${
          isConnected
            ? "bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/40"
            : "bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
        }`}
      >
        {isConnecting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…
          </>
        ) : isConnected ? (
          <>
            <PowerOff className="h-3.5 w-3.5" /> Disconnect
          </>
        ) : (
          <>
            <Power className="h-3.5 w-3.5" /> Connect
          </>
        )}
      </Button>
    </div>
  );
}
