"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/emulator/AuthGate";
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
  const [configOpen, setConfigOpen] = useState(false);

  // Restore persisted state after hydration
  useEffect(() => {
    const saved = localStorage.getItem("configPanelOpen");
    if (saved === "true") setConfigOpen(true);
  }, []);

  const toggleConfig = useCallback(() => {
    setConfigOpen((v) => {
      const next = !v;
      localStorage.setItem("configPanelOpen", String(next));
      return next;
    });
  }, []);

  return (
    <AuthGate>
      <main className="h-screen w-screen flex flex-col overflow-hidden">
        {/* ── Header ── */}
        <HeaderBar onSettingsOpen={toggleConfig} />

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
                defaultSize={"45%"}
                minSize={"20%"}
                maxSize={"75%"}
              >
                <div className="h-full overflow-y-auto p-5 custom-scrollbar">
                  <div className="max-w-[1400px] mx-auto w-full flex flex-col">
                    <ConnectorsView />
                  </div>
                </div>
              </ResizablePanel>

              {/* Horizontal resize handle */}
              <ResizableHandle className="h-px! bg-[#282b3a] hover:bg-[#14b8a6]/40 transition-colors data-resize-handle-active:bg-[#14b8a6]/60" />

              {/* Bottom: Logs (full width) */}
              <ResizablePanel
                defaultSize={"35%"}
                minSize={"30%"}
                maxSize={"75%"}
              >
                <div
                  className={cn(
                    "h-full py-4 max-w-[1400px] mx-auto w-full flex flex-col",
                    configOpen && "p-4",
                  )}
                >
                  <LogsPanel />
                </div>
              </ResizablePanel>
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
