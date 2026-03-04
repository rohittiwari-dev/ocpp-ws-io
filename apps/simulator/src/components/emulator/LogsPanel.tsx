"use client";

import {
  Activity,
  AlertTriangle,
  AlignLeft,
  ArrowDownLeft,
  ArrowUpToLine,
  Braces,
  CheckCheck,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  Info,
  PanelBottomClose,
  Radio,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { JsonViewer } from "@/components/ui/json-viewer";
import { useActiveCharger } from "@/hooks/useActiveCharger";
import type { OCPPLog } from "@/store/emulatorStore";

/* ═══════════════════════════════════════════════════════
   DIRECTION CONFIG
   ═══════════════════════════════════════════════════════ */
const DIR: Record<
  string,
  {
    dot: string;
    border: string;
    rowHover: string;
    rowActive: string;
    badge: string;
    icon: React.ElementType;
    label: string;
  }
> = {
  Tx: {
    dot: "#f59e0b",
    border: "#f59e0b",
    rowHover: "hover:bg-[#17150a]",
    rowActive: "bg-[#17150a]",
    badge: "text-[#fbbf24] bg-[#241b08] border-[#6b4a10]",
    icon: Zap,
    label: "TX",
  },
  Rx: {
    dot: "#22c55e",
    border: "#22c55e",
    rowHover: "hover:bg-[#0a130d]",
    rowActive: "bg-[#0a130d]",
    badge: "text-[#4ade80] bg-[#091a0d] border-[#175228]",
    icon: ArrowDownLeft,
    label: "RX",
  },
  System: {
    dot: "#38bdf8",
    border: "#38bdf8",
    rowHover: "hover:bg-[#0b141e]",
    rowActive: "bg-[#0b141e]",
    badge: "text-[#7dd3fc] bg-[#0a1826] border-[#164964]",
    icon: Info,
    label: "SYS",
  },
  Error: {
    dot: "#f43f5e",
    border: "#f43f5e",
    rowHover: "hover:bg-[#180b0e]",
    rowActive: "bg-[#180b0e]",
    badge: "text-[#fda4af] bg-[#260c12] border-[#6b1e28]",
    icon: AlertTriangle,
    label: "ERR",
  },
};

/* ═══════════════════════════════════════════════════════
   LOG ENTRY
   ═══════════════════════════════════════════════════════ */
function LogEntry({ log, isNew }: { log: OCPPLog; isNew: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"parsed" | "raw">("parsed");
  const [copied, setCopied] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const cfg = DIR[log.direction] ?? DIR.System;
  const Icon = cfg.icon;

  const t = new Date(log.timestamp);
  const time = t.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const ms = t.getMilliseconds().toString().padStart(3, "0");

  const fullRaw = log.rawMessage ?? JSON.stringify(log, null, 2);
  const hasPayload = log.payload !== undefined && log.payload !== null;

  const copyFull = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fullRaw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const copyPayload = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(JSON.stringify(log.payload, null, 2));
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 1800);
  };
  const download = (e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = new Blob([fullRaw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${log.action}_${log.ocppMessageId ?? log.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`group flex flex-col border-l-[3px] transition-colors duration-100 ${
        cfg.rowHover
      } ${expanded ? cfg.rowActive : ""}`}
      style={{ borderLeftColor: cfg.border }}
    >
      {/* ── Row ── */}
      <div
        className="flex items-center gap-2 px-2.5 py-[7px] cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status dot with subtle glow */}
        <span
          className="shrink-0 h-1.5 w-1.5 rounded-full"
          style={{ background: cfg.dot, boxShadow: `0 0 5px ${cfg.dot}` }}
        />

        {/* Direction badge */}
        <span
          className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-px rounded border text-[9px] font-black tracking-[0.12em] leading-none ${cfg.badge}`}
        >
          <Icon className="h-2.5 w-2.5" />
          {cfg.label}
        </span>

        {/* Timestamp */}
        <span className="shrink-0 font-mono text-[10px] text-[#434b5e] tabular-nums">
          {time}
          <span className="text-[#2e3445]">.{ms}</span>
        </span>

        {/* Action name */}
        <span
          className={`flex-1 min-w-0 text-[12px] font-medium tracking-tight truncate ${
            log.direction === "Error" ? "text-[#fda4af]" : "text-[#c8cedd]"
          } ${isNew ? "font-semibold" : ""}`}
        >
          {log.action}
        </span>

        {/* Hover: View mode toggles */}
        {hasPayload && (
          <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-px bg-[#0f1117] rounded p-0.5 border border-[#23253a]">
            {(["parsed", "raw"] as const).map((m) => (
              <button
                key={m}
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMode(m);
                }}
                className={`px-2 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-colors ${
                  viewMode === m
                    ? "bg-[#1e1535] text-[#c4b5fd]"
                    : "text-[#4a5568] hover:text-[#a0a8b8]"
                }`}
              >
                {m === "parsed" ? (
                  <>
                    <Braces className="h-2.5 w-2.5 inline mr-0.5" />
                    JSON
                  </>
                ) : (
                  <>
                    <AlignLeft className="h-2.5 w-2.5 inline mr-0.5" />
                    Raw
                  </>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Hover: copy + download */}
        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-px">
          <button
            onClick={copyFull}
            title="Copy full"
            className="p-1 rounded text-[#4a5568] hover:text-white hover:bg-[#1d1f2b] transition-colors cursor-pointer"
          >
            {copied ? (
              <CheckCheck className="h-3 w-3 text-[#22c55e]" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={download}
            title="Download"
            className="p-1 rounded text-[#4a5568] hover:text-white hover:bg-[#1d1f2b] transition-colors cursor-pointer"
          >
            <Download className="h-3 w-3" />
          </button>
        </div>

        {/* Chevron */}
        {hasPayload ? (
          <ChevronRight
            className={`shrink-0 h-3 w-3 text-[#2e3445] transition-transform duration-150 ${
              expanded ? "rotate-90 text-[#5d6577]!" : ""
            }`}
          />
        ) : (
          <span className="shrink-0 w-3" />
        )}
      </div>

      {/* ── Expanded payload ── */}
      {expanded && hasPayload && (
        <div className="mx-3 mb-2.5 border border-[#1d2235] rounded-lg overflow-hidden">
          {/* Payload toolbar */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#0f1117] border-b border-[#1d2235]">
            <div className="flex items-center gap-0.5">
              {(["parsed", "raw"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-colors ${
                    viewMode === m
                      ? "bg-[#1e1535] text-[#c4b5fd]"
                      : "text-[#4a5568] hover:text-[#a0a8b8]"
                  }`}
                >
                  {m === "parsed" ? (
                    <>
                      <Braces className="h-2.5 w-2.5" />
                      Parsed
                    </>
                  ) : (
                    <>
                      <AlignLeft className="h-2.5 w-2.5" />
                      Raw
                    </>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={copyPayload}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold text-[#4a5568] hover:text-white border border-[#23253a] hover:border-[#383e50] hover:bg-[#1d1f2b] transition-colors cursor-pointer"
            >
              {copiedPayload ? (
                <CheckCheck className="h-2.5 w-2.5 text-[#22c55e]" />
              ) : (
                <Copy className="h-2.5 w-2.5" />
              )}
              Copy
            </button>
          </div>
          {/* Payload body */}
          <div className="max-h-[260px] overflow-auto custom-scrollbar bg-[#080a10]">
            <div className="p-3">
              {viewMode === "parsed" ? (
                <JsonViewer data={log.payload} />
              ) : (
                <pre className="text-[#7dd3fc] font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all">
                  {fullRaw}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   LOGS PANEL
   ═══════════════════════════════════════════════════════ */
const FILTERS = ["All", "Tx", "Rx", "Error"] as const;
type Filter = (typeof FILTERS)[number];

export function LogsPanel({ onHide }: { onHide?: () => void }) {
  const { logs, clearLogs } = useActiveCharger();
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(logs.length);

  /* counts */
  const counts = useMemo(() => {
    const c = { All: logs.length, Tx: 0, Rx: 0, Error: 0 };
    for (const l of logs) {
      if (l.direction === "Tx") c.Tx++;
      else if (l.direction === "Rx") c.Rx++;
      else if (l.direction === "Error") c.Error++;
    }
    return c;
  }, [logs]);

  /* filtered list */
  const displayLogs = useMemo(
    () =>
      logs.filter((l) => {
        if (filter !== "All" && l.direction !== filter) return false;
        if (search) {
          const q = search.toLowerCase();
          return (
            l.action.toLowerCase().includes(q) ||
            (l.payload
              ? JSON.stringify(l.payload).toLowerCase().includes(q)
              : false)
          );
        }
        return true;
      }),
    [logs, filter, search],
  );

  /* track new log entries while paused */
  useEffect(() => {
    const diff = logs.length - prevLen.current;
    if (diff > 0 && !autoScroll) setNewCount((n) => n + diff);
    prevLen.current = logs.length;
  }, [logs.length, autoScroll]);

  /* auto-scroll to top (newest first) */
  useEffect(() => {
    if (autoScroll && viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [displayLogs, autoScroll]);

  /* focus search when toggled */
  useEffect(() => {
    if (showSearch) setTimeout(() => searchRef.current?.focus(), 50);
  }, [showSearch]);

  const jumpToLatest = () => {
    setAutoScroll(true);
    setNewCount(0);
    viewportRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const downloadAll = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ocpp_logs_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCSV = () => {
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = [
      "timestamp",
      "direction",
      "action",
      "raw_message",
      "payload",
    ].join(",");
    const rows = logs.map((l) =>
      [
        q(l.timestamp),
        q(l.direction),
        q(l.action),
        q(l.rawMessage ?? ""),
        q(JSON.stringify(l.payload ?? "")),
      ].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ocpp_logs_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ═══ RENDER ═══ */
  return (
    <div className="flex flex-col h-full rounded-xl bg-[#11131b] border border-[#1e2030]">
      {/* ── HEADER ── */}
      <div className="shrink-0 flex flex-col bg-[#181b27] border-b border-[#1e2030] rounded-t-xl">
        {/* Top row */}
        <div className="flex items-center gap-2 h-10 px-3">
          {/* Brand */}
          <Radio className="h-3.5 w-3.5 text-[#8b5cf6] shrink-0" />
          <span className="text-[11px] font-bold text-white tracking-widest uppercase shrink-0">
            OCPP Log
          </span>

          {/* Live dot + count */}
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inset-0 rounded-full bg-[#22c55e] opacity-50" />
            <span className="relative rounded-full h-1.5 w-1.5 bg-[#22c55e]" />
          </span>
          <span className="text-[10px] font-mono text-[#4a5568] tabular-nums">
            {logs.length}
          </span>

          <div className="w-px h-3.5 bg-[#23253a] shrink-0 mx-0.5" />

          {/* Filter tabs */}
          <div className="flex items-center gap-0.5 flex-1 min-w-0">
            {FILTERS.map((f) => {
              const active = filter === f;
              const color =
                f === "Tx"
                  ? "text-[#fbbf24]"
                  : f === "Rx"
                    ? "text-[#4ade80]"
                    : f === "Error"
                      ? "text-[#f87171]"
                      : "text-[#8b5cf6]";
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer shrink-0 border ${
                    active
                      ? `bg-[#0f1117] border-[#23253a] ${color}`
                      : "text-[#3d4459] border-transparent hover:text-[#6b7898] hover:bg-[#0f1117]"
                  }`}
                >
                  {f}
                  {counts[f] > 0 && (
                    <span
                      className={`text-[8px] font-mono px-1 py-px rounded ${
                        active
                          ? "bg-[#0f1117] text-[#4a5568]"
                          : "text-[#2e3445]"
                      }`}
                    >
                      {counts[f]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Follow toggle */}
          <button
            onClick={() => {
              setAutoScroll(!autoScroll);
              setNewCount(0);
            }}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-all cursor-pointer shrink-0 ${
              autoScroll
                ? "bg-[#091a0d] text-[#4ade80] border-[#175228]"
                : "text-[#3d4459] border-[#23253a] hover:text-[#6b7898]"
            }`}
          >
            <ArrowUpToLine className="h-2.5 w-2.5" />
            Follow
          </button>

          <div className="w-px h-3.5 bg-[#23253a] shrink-0 mx-0.5" />

          {/* Actions */}
          <button
            onClick={() => setShowSearch(!showSearch)}
            title="Search"
            className={`p-1 rounded cursor-pointer transition-colors ${
              showSearch
                ? "text-[#c4b5fd] bg-[#1e1535]"
                : "text-[#3d4459] hover:text-white hover:bg-[#1d1f2b]"
            }`}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(logs, null, 2));
              setCopiedAll(true);
              setTimeout(() => setCopiedAll(false), 1800);
            }}
            title="Copy all"
            className="p-1 rounded transition-colors cursor-pointer text-[#3d4459] hover:text-white hover:bg-[#1d1f2b]"
          >
            {copiedAll ? (
              <CheckCheck className="h-3.5 w-3.5 text-[#22c55e]" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={downloadAll}
            title="Export JSON"
            className="p-1 rounded text-[#3d4459] hover:text-white hover:bg-[#1d1f2b] transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={downloadCSV}
            title="Export CSV"
            className="p-1 rounded text-[#3d4459] hover:text-[#4ade80] hover:bg-[#091a0d] transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={clearLogs}
            title="Clear"
            className="p-1 rounded text-[#3d4459] hover:text-[#f43f5e] hover:bg-[#26101a] transition-colors cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {onHide && (
            <>
              <div className="w-px h-3.5 bg-[#23253a] shrink-0 mx-0.5" />
              <button
                onClick={onHide}
                title="Hide log panel"
                className="p-1 rounded text-[#3d4459] hover:text-[#c4b5fd] hover:bg-[#1e1535] transition-colors cursor-pointer"
              >
                <PanelBottomClose className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Search bar — slides open */}
        {showSearch && (
          <div className="px-3 pb-2 flex items-center gap-2 border-t border-[#1e2030] pt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[#3d4459] pointer-events-none" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setShowSearch(false)}
                placeholder="Filter by action or payload content…"
                className="w-full h-7 pl-8 pr-7 text-[11px] font-mono text-white bg-[#0f1117] border border-[#23253a] rounded-md outline-none placeholder:text-[#2e3445] focus:border-[#8b5cf6] focus:shadow-[0_0_0_2px_rgba(139,92,246,0.1)] transition-all"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#3d4459] hover:text-white cursor-pointer transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {search && (
              <span className="shrink-0 text-[9px] font-mono text-[#4a5568]">
                {displayLogs.length} match{displayLogs.length !== 1 ? "es" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── LOG STREAM ── */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={viewportRef}
          className="absolute inset-0 overflow-y-auto custom-scrollbar"
        >
          {displayLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 h-full min-h-[200px] px-4">
              <div className="w-10 h-10 rounded-lg bg-[#181b27] border border-[#1e2030] flex items-center justify-center">
                <Activity className="h-4 w-4 text-[#2e3445]" />
              </div>
              <p className="text-[11px] font-medium text-[#3d4459] text-center">
                {search
                  ? `No results for "${search}"`
                  : "Waiting for OCPP messages…"}
              </p>
            </div>
          ) : (
            <div>
              {displayLogs.map((log, i) => (
                <LogEntry key={log.id} log={log} isNew={i === 0} />
              ))}
            </div>
          )}
        </div>

        {/* "Jump to Latest" pill — shown when paused + new entries */}
        {!autoScroll && displayLogs.length > 0 && (
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex flex-col items-center">
            <button
              onClick={jumpToLatest}
              className="pointer-events-auto flex items-center gap-1.5 h-6 px-3 rounded-full text-[9px] font-bold uppercase tracking-wide bg-[#8b5cf6] hover:bg-[#7c3aed] text-white shadow-[0_4px_16px_rgba(139,92,246,0.35)] transition-colors"
            >
              <ArrowUpToLine className="h-2.5 w-2.5" />
              {newCount > 0 ? `${newCount} new` : "Latest"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
