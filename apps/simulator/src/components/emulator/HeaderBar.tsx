"use client";

import {
  ChevronDown,
  Loader2,
  LogOut,
  Power,
  PowerOff,
  RefreshCw,
  Settings,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/emulator/AuthGate";
import { type ConnectionStatus, useEmulatorStore } from "@/store/emulatorStore";

/* ── Status config ── */
type StCfg = { dot: string; text: string; label: string };
const ST: Record<ConnectionStatus, StCfg> = {
  connected: { dot: "#22c55e", text: "#4ade80", label: "Connected" },
  connecting: { dot: "#f59e0b", text: "#fbbf24", label: "Connecting" },
  faulted: { dot: "#f43f5e", text: "#fda4af", label: "Faulted" },
  disconnected: { dot: "#4b5563", text: "#6b7280", label: "Disconnected" },
};

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

/* ── Header ── */
export function HeaderBar({ onSettingsOpen }: { onSettingsOpen: () => void }) {
  const { status, config, connectedAt, updateConfig } = useEmulatorStore();
  const auth = useAuth();
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const st = ST[status];

  /* version picker */
  const [vOpen, setVOpen] = useState(false);
  const [vRect, setVRect] = useState<DOMRect | null>(null);
  const vBtnRef = useRef<HTMLButtonElement>(null);
  const VERSIONS = ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"] as const;

  useEffect(() => {
    if (!vOpen) return;
    const close = () => setVOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [vOpen]);

  const [uptime, setUptime] = useState("");
  useEffect(() => {
    if (!connectedAt) {
      setUptime("");
      return;
    }
    const tick = () => setUptime(formatUptime(Date.now() - connectedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [connectedAt]);

  const runService = (fn: (svc: any) => void) =>
    import("@/lib/ocppClient").then(({ ocppService }) => fn(ocppService));

  return (
    <header className="sticky top-0 z-30 h-14 flex items-center px-4 gap-4 bg-[#181a24] border-b border-[#232636]">
      {/* ── Brand ── */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="h-7 w-7 rounded-lg flex items-center justify-center overflow-hidden bg-[#1a1030] shadow-[0_0_12px_rgba(124,58,237,0.35)] shrink-0">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 100 100"
            className="h-5 w-5"
          >
            <defs>
              <linearGradient id="hdr-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#7C3AED" />
                <stop offset="100%" stopColor="#C084FC" />
              </linearGradient>
            </defs>
            <path
              d="M50 0 L93.3 25 L93.3 75 L50 100 L6.7 75 L6.7 25 Z"
              fill="url(#hdr-grad)"
              opacity="0.15"
            />
            <path
              d="M50 10 A 40 40 0 1 0 90 50"
              fill="none"
              stroke="url(#hdr-grad)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <circle cx="90" cy="50" r="8" fill="#7C3AED" />
            <circle cx="50" cy="10" r="8" fill="#C084FC" />
            <path
              d="M55 22 L32 55 L48 55 L42 82 L72 45 L52 45 Z"
              fill="url(#hdr-grad)"
            />
          </svg>
        </div>
        <span className="text-[13px] font-bold text-white tracking-tight hidden sm:block">
          OCPP WS Simulator
        </span>
      </div>

      <div className="h-5 w-px bg-[#282b3a] shrink-0 hidden sm:block" />

      {/* ── Endpoint (clickable) ── */}
      <button
        onClick={onSettingsOpen}
        title="Edit connection settings"
        className="hidden md:flex items-center gap-2 h-7 px-3 rounded-lg bg-[#0f1117] border border-[#232636] hover:border-[#2d3050] hover:bg-[#13151f] transition-all group min-w-0 max-w-sm cursor-pointer"
      >
        <span className="text-[10px] font-mono text-[#4a5568] group-hover:text-[#7a88a8] truncate transition-colors">
          {config.endpoint}/
          <span className="text-[#c4b5fd]">{config.chargePointId}</span>
        </span>
        <span className="shrink-0 text-[8px] font-mono text-[#3d4459] border border-[#232636] rounded px-1 py-px uppercase tracking-widest">
          {config.ocppVersion}
        </span>
      </button>

      {/* ── OCPP Version Picker ── */}
      <div className="relative shrink-0">
        <button
          ref={vBtnRef}
          onClick={() => {
            if (vBtnRef.current)
              setVRect(vBtnRef.current.getBoundingClientRect());
            setVOpen(!vOpen);
          }}
          className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg bg-[#0f1117] border border-[#232636] hover:border-[#2d3050] hover:bg-[#13151f] transition-all cursor-pointer group"
        >
          <span className="text-[9px] font-mono font-bold text-[#8b5cf6] uppercase tracking-wider">
            {config.ocppVersion.replace("ocpp", "v")}
          </span>
          <ChevronDown
            className={`h-3 w-3 text-[#3d4459] transition-transform ${
              vOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {vOpen &&
          vRect &&
          createPortal(
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                top: vRect.bottom + 4,
                left: vRect.left,
                minWidth: vRect.width,
                zIndex: 9999,
              }}
              className="rounded-lg overflow-hidden border border-[#2d3050] bg-[#181a24] shadow-[0_8px_32px_rgba(0,0,0,0.7)]"
            >
              {VERSIONS.map((v) => (
                <button
                  key={v}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => {
                    updateConfig({ ocppVersion: v });
                    setVOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[10px] font-mono font-bold cursor-pointer transition-colors ${
                    config.ocppVersion === v
                      ? "text-[#8b5cf6] bg-[#1e1535]"
                      : "text-[#4a5568] hover:text-white hover:bg-[#1d1f2b]"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      config.ocppVersion === v ? "bg-[#8b5cf6]" : "bg-[#232636]"
                    }`}
                  />
                  {v.replace("ocpp", "OCPP ")}
                </button>
              ))}
            </div>,
            document.body,
          )}
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Status indicator ── */}
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <span className="relative flex h-2 w-2">
          {isConnected && (
            <span
              className="animate-ping absolute inset-0 rounded-full opacity-50"
              style={{ background: st.dot }}
            />
          )}
          <span
            className="relative inline-flex rounded-full h-2 w-2"
            style={{ background: st.dot, boxShadow: `0 0 6px ${st.dot}` }}
          />
        </span>
        <span className="text-[10px] font-medium" style={{ color: st.text }}>
          {st.label}
        </span>
        {uptime && (
          <span className="text-[9px] font-mono text-[#3d4459] bg-[#0f1117] border border-[#232636] rounded px-1.5 py-0.5">
            {uptime}
          </span>
        )}
      </div>

      {/* Quick actions — only when connected */}
      {isConnected && (
        <>
          <div className="h-5 w-px bg-[#282b3a] shrink-0 hidden sm:block" />
          <div className="hidden sm:flex items-center gap-0.5">
            <button
              onClick={() => runService((s) => s.sendBootNotification())}
              className="h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[10px] font-semibold text-[#4a5568] hover:text-[#c4b5fd] hover:bg-[#1e1535] transition-all cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" /> Boot
            </button>
            <button
              onClick={() => runService((s) => s.sendHeartbeat())}
              className="h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[10px] font-semibold text-[#4a5568] hover:text-[#a78bfa] hover:bg-[#1e1535] transition-all cursor-pointer"
            >
              <Zap className="h-3 w-3" /> Heartbeat
            </button>
          </div>
        </>
      )}

      {/* ── Connect / Disconnect ── */}
      <button
        disabled={isConnecting}
        onClick={() =>
          runService((s) => (isConnected ? s.disconnect() : s.connect()))
        }
        className={`h-8 px-4 rounded-lg flex items-center gap-2 text-[11px] font-bold tracking-wide transition-all disabled:opacity-50 cursor-pointer shrink-0 ${
          isConnected
            ? "bg-[#1c0f13] border border-[#5c1c28] text-[#fda4af] hover:bg-[#26101a] hover:border-[#8b2838]"
            : isConnecting
              ? "bg-[#0f1117] border border-[#232636] text-[#4a5568]"
              : "bg-linear-to-r from-[#7C3AED] to-[#9333ea] text-white shadow-[0_0_14px_rgba(124,58,237,0.3)] hover:shadow-[0_0_20px_rgba(124,58,237,0.5)]"
        }`}
      >
        {isConnecting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Connecting…
          </>
        ) : isConnected ? (
          <>
            <PowerOff className="h-3.5 w-3.5" />
            Disconnect
          </>
        ) : (
          <>
            <Power className="h-3.5 w-3.5" />
            Connect
          </>
        )}
      </button>

      {/* ── Logout ── */}
      {process.env.NEXT_PUBLIC_ALLOW_AUTH === "true" && (
        <button
          onClick={() => auth?.logout()}
          title="Sign out"
          className="h-8 w-8 rounded-lg flex items-center justify-center bg-[#0f1117] border border-[#232636] text-[#4a5568] hover:text-[#fda4af] hover:bg-[#1c0f13] hover:border-[#5c1c28] transition-all cursor-pointer shrink-0"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      )}

      {/* ── Settings ── */}
      <button
        onClick={onSettingsOpen}
        title="Settings"
        className="h-8 w-8 rounded-lg flex items-center justify-center bg-[#0f1117] border border-[#232636] text-[#4a5568] hover:text-[#a0a8b8] hover:border-[#2d3050] hover:bg-[#13151f] transition-all cursor-pointer shrink-0"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </header>
  );
}
