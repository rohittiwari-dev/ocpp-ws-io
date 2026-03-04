"use client";

import { Keyboard } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/* ── Shortcut data ─────────────────────────────────────────────────────────── */
const GROUPS = [
  {
    group: "Panels",
    color: "text-[#8b5cf6]",
    items: [
      { keys: ["Ctrl", "`"], label: "Toggle Log Panel" },
      { keys: ["Ctrl", "1"], label: "Toggle Config Panel" },
    ],
  },
  {
    group: "Charger",
    color: "text-[#14b8a6]",
    items: [
      { keys: ["Alt", "C"], label: "New charger" },
      { keys: ["Ctrl", "Enter"], label: "Connect / Disconnect" },
    ],
  },
  {
    group: "Logs",
    color: "text-[#f59e0b]",
    items: [
      { keys: ["Ctrl", "S"], label: "Export logs as JSON" },
      { keys: ["Ctrl", "Shift", "S"], label: "Export logs as CSV" },
    ],
  },
  {
    group: "This dialog",
    color: "text-[#4a5568]",
    items: [
      { keys: ["Ctrl", "/"], label: "Open / close shortcuts" },
      { keys: ["Esc"], label: "Close" },
    ],
  },
] as const;

/* ── Component ─────────────────────────────────────────────────────────────── */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);

  /* Ctrl+/ global toggle */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        title="Keyboard shortcuts (Ctrl+/)"
        className="h-8 w-8 rounded-lg flex items-center justify-center bg-[#0f1117] border border-[#232636] text-[#4a5568] hover:text-[#c4b5fd] hover:bg-[#1e1535] hover:border-[#5b21b6]/40 transition-all cursor-pointer shrink-0"
      >
        <Keyboard className="h-3.5 w-3.5" />
      </DialogTrigger>

      <DialogContent
        showCloseButton
        className="w-[440px] max-w-[95vw] bg-[#11131b] border border-[#282b3a] shadow-[0_24px_80px_rgba(0,0,0,0.8)] rounded-2xl p-0"
      >
        {/* Header */}
        <DialogHeader className="flex flex-row items-center gap-2.5 px-5 py-4 border-b border-[#1e2030] bg-[#181b27] rounded-t-2xl">
          <Keyboard className="h-4 w-4 text-[#8b5cf6] shrink-0" />
          <DialogTitle className="text-[13px] font-bold text-white tracking-wide">
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <div className="p-5 space-y-5">
          {GROUPS.map(({ group, color, items }) => (
            <div key={group}>
              <div
                className={`text-[9px] font-bold uppercase tracking-[0.2em] mb-3 ${color}`}
              >
                {group}
              </div>
              <div className="space-y-2.5">
                {items.map(({ keys, label }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between"
                  >
                    <span className="text-[12px] text-[#a0a8b8]">{label}</span>
                    <div className="flex items-center gap-1">
                      {keys.map((k, i) => (
                        <span
                          key={`${k}-${i?.toString()}`}
                          className="flex items-center gap-1"
                        >
                          <kbd className="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono bg-[#1d1f2b] border border-[#2d3050] text-[#c4b5fd] shadow-[0_2px_0_rgba(0,0,0,0.5)] leading-tight">
                            {k}
                          </kbd>
                          {i < keys.length - 1 && (
                            <span className="text-[9px] text-[#3d4459]">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1e2030] text-center bg-[#0d0f17] rounded-b-2xl">
          <span className="text-[9px] font-mono text-[#2a2e40]">
            Press <span className="text-[#3d4459]">Ctrl+/</span> anytime to
            toggle this dialog
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
