"use client";

import { PanelBottomOpen } from "lucide-react";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/emulator/AuthGate";
import { ChargerTabBar } from "@/components/emulator/ChargerTabBar";
import { ConfigPanel } from "@/components/emulator/ConfigPanel";
import { ConnectorsView } from "@/components/emulator/EmulatorTabs";
import { HeaderBar } from "@/components/emulator/HeaderBar";
import { LogsPanel } from "@/components/emulator/LogsPanel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    url: "https://ocpp.rohittiwari.me",
    name: "OCPP WS Simulator",
    alternateName: ["ocpp-ws-simulator", "OCPP Emulator", "OCPP Simulator"],
    description:
      "An open-source OCPP 1.6/2.0.1/2.1 charge point emulator for testing CSMS backends.",
    applicationCategory: "DeveloperApplication",
  };
  const [configOpen, setConfigOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);

  // Restore persisted state after hydration
  useEffect(() => {
    const savedConfig = localStorage.getItem("configPanelOpen");
    if (savedConfig === "true") setConfigOpen(true);
    const savedLogs = localStorage.getItem("logsPanelOpen");
    if (savedLogs === "false") setLogsOpen(false);
  }, []);

  const toggleConfig = () => {
    setConfigOpen((v) => {
      const next = !v;
      localStorage.setItem("configPanelOpen", String(next));
      return next;
    });
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      // Allow Ctrl shortcuts and Alt shortcuts (for new charger)
      if (!e.ctrlKey && !e.altKey) return;

      // Ctrl+` → Toggle Log Panel
      if (e.key === "`") {
        e.preventDefault();
        setLogsOpen((v) => {
          const next = !v;
          localStorage.setItem("logsPanelOpen", String(next));
          return next;
        });

        // Ctrl+1 → Toggle Config Panel
      } else if (e.key === "1") {
        e.preventDefault();
        setConfigOpen((v) => {
          const next = !v;
          localStorage.setItem("configPanelOpen", String(next));
          return next;
        });

        // Alt+C → New Charger (Ctrl combos are browser-reserved)
      } else if (!e.shiftKey && e.altKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        const { useEmulatorStore } = await import("@/store/emulatorStore");
        useEmulatorStore.getState().addCharger();

        // Ctrl+Enter → Connect / Disconnect active charger
      } else if (e.key === "Enter") {
        e.preventDefault();
        const { ocppService } = await import("@/lib/ocppClient");
        const { useEmulatorStore } = await import("@/store/emulatorStore");
        const store = useEmulatorStore.getState();
        const activeId = store.activeChargerId;
        const slot = store.chargers.find((c) => c.id === activeId);
        const connected = slot?.runtime.status === "connected";
        if (connected) ocppService.disconnect();
        else ocppService.connect();

        // Ctrl+S → Export logs as JSON
      } else if (!e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        const { useEmulatorStore } = await import("@/store/emulatorStore");
        const store = useEmulatorStore.getState();
        const logs =
          store.chargers.find((c) => c.id === store.activeChargerId)?.runtime
            .logs ?? [];
        const blob = new Blob([JSON.stringify(logs, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ocpp_logs_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        // Ctrl+Shift+S → Export logs as CSV
      } else if (e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        const { useEmulatorStore } = await import("@/store/emulatorStore");
        const store = useEmulatorStore.getState();
        const logs =
          store.chargers.find((c) => c.id === store.activeChargerId)?.runtime
            .logs ?? [];
        const header = "timestamp,direction,action,payload\n";
        const rows = logs.map((l) =>
          [
            l.timestamp,
            l.direction,
            l.action,
            `"${JSON.stringify(l.payload ?? {}).replace(/"/g, '""')}"`,
          ].join(","),
        );
        const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ocpp_logs_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const hideLogs = () => {
    setLogsOpen(false);
    localStorage.setItem("logsPanelOpen", "false");
  };

  const showLogs = () => {
    setLogsOpen(true);
    localStorage.setItem("logsPanelOpen", "true");
  };

  return (
    <AuthGate>
      <main className="h-screen w-screen flex flex-col overflow-hidden">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* ── Header ── */}
        <HeaderBar onSettingsOpen={toggleConfig} />

        {/* ── Charger Tab Bar ── */}
        <ChargerTabBar />

        {/* ── 3-Panel Resizable Layout ── */}
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          {/* Left side: Connectors (top) + Logs (bottom) */}
          <ResizablePanel
            defaultSize={configOpen ? "70%" : "100%"}
            minSize={"40%"}
          >
            <ResizablePanelGroup orientation="vertical" className="h-full">
              {/* Top: Connectors */}
              <ResizablePanel
                defaultSize={logsOpen ? "55%" : "100%"}
                minSize={"20%"}
                maxSize={logsOpen ? "80%" : "100%"}
              >
                <div className="h-full overflow-y-auto p-5 custom-scrollbar">
                  <div className="max-w-[1400px] mx-auto w-full flex flex-col">
                    <ConnectorsView />
                  </div>
                </div>
              </ResizablePanel>

              {logsOpen ? (
                <>
                  {/* Horizontal resize handle */}
                  <ResizableHandle className="h-px! bg-[#282b3a] hover:bg-[#14b8a6]/40 transition-colors data-resize-handle-active:bg-[#14b8a6]/60" />

                  {/* Bottom: Logs */}
                  <ResizablePanel
                    defaultSize={"45%"}
                    minSize={"20%"}
                    maxSize={"75%"}
                  >
                    <div
                      className={cn(
                        "h-full py-4 max-w-[1400px] mx-auto w-full flex flex-col",
                        configOpen && "p-4",
                      )}
                    >
                      <LogsPanel onHide={hideLogs} />
                    </div>
                  </ResizablePanel>
                </>
              ) : (
                /* Slim restore bar when logs are hidden */
                <button
                  onClick={showLogs}
                  title="Show log panel"
                  className="shrink-0 w-full flex items-center gap-2 px-4 h-8 border-t border-[#1e2030] bg-[#11131b] hover:bg-[#181b27] text-[#3d4459] hover:text-[#c4b5fd] transition-colors cursor-pointer group"
                >
                  <PanelBottomOpen className="h-3.5 w-3.5 group-hover:text-[#c4b5fd]" />
                  <span className="text-[9px] font-bold uppercase tracking-widest">
                    OCPP Log
                  </span>
                </button>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {/* Right side: Config Panel (resizable, collapsible) */}
          {configOpen && (
            <>
              <ResizableHandle className="w-px! bg-[#282b3a] hover:bg-[#14b8a6]/40 transition-colors data-resize-handle-active:bg-[#14b8a6]/60" />
              <ResizablePanel
                defaultSize={"30%"}
                minSize={"20%"}
                maxSize={"50%"}
              >
                <div className="h-full overflow-hidden">
                  <ConfigPanel
                    onClose={() => {
                      setConfigOpen(false);
                      localStorage.setItem("configPanelOpen", "false");
                    }}
                  />
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </main>
    </AuthGate>
  );
}
