"use client";

import {
  Activity,
  AlertTriangle,
  Bolt,
  CalendarCheck,
  ChevronDown,
  Gauge,
  Play,
  PlugZap,
  PowerOff,
  Radio,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Unlock,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { useActiveCharger } from "@/hooks/useActiveCharger";
import { ocppService } from "@/lib/ocppClient";
import type { ConnectorStatus, StopReason } from "@/store/emulatorStore";

/* ──────────────────────────────────
   BASE UI COMPONENTS
   ────────────────────────────────── */
function MiniSelect<T extends string>({
  value,
  options,
  onChange,
  icon,
  label,
}: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
  icon?: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const openDropdown = () => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const dropdown =
    open && rect
      ? createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: rect.bottom + 4,
              left: rect.left,
              width: rect.width,
              zIndex: 9999,
            }}
            className="rounded-md py-1.5 max-h-52 overflow-y-auto custom-scrollbar shadow-[0_12px_32px_rgba(0,0,0,0.8)] bg-[#1d1f2b] border border-[#383e50] animate-in fade-in zoom-in-95 duration-100"
          >
            {options.map((opt) => (
              <button
                key={opt}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-start px-3 py-1.5 text-[11px] cursor-pointer transition-colors ${
                  opt === value
                    ? "text-[#8b5cf6] bg-[#1e1535]"
                    : "text-[#a0a8b8] hover:text-[#f0f2f5] hover:bg-[#252838]"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <span className="text-[9px] font-bold uppercase tracking-widest text-[#5d6577]">
          {label}
        </span>
      )}
      <button
        ref={btnRef}
        onClick={openDropdown}
        className="w-full flex items-center justify-between gap-1.5 px-3 h-9 rounded-md font-medium cursor-pointer transition-all bg-[#1d1f2b] border border-[#282b3a] text-[#a0a8b8] hover:bg-[#252838] hover:text-[#f0f2f5] hover:border-[#383e50] text-[11px]"
      >
        <span className="flex items-center gap-2 text-left shrink truncate">
          {icon}
          <span className="truncate">{value}</span>
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-[#5d6577] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {dropdown}
    </div>
  );
}

/* ──────────────────────────────────
   CONFIG / THEME Maps
   ────────────────────────────────── */
type StatusCfg = {
  dot: string;
  accent: string;
  badgeBg: string;
  text: string;
  ring: string;
};

const SC: Record<ConnectorStatus, StatusCfg> = {
  Available: {
    dot: "#22c55e",
    accent: "#22c55e",
    badgeBg: "rgba(34,197,94,0.1)",
    text: "#4ade80",
    ring: "rgba(34,197,94,0.25)",
  },
  Preparing: {
    dot: "#38bdf8",
    accent: "#38bdf8",
    badgeBg: "rgba(56,189,248,0.1)",
    text: "#7dd3fc",
    ring: "rgba(56,189,248,0.25)",
  },
  Charging: {
    dot: "#8b5cf6",
    accent: "#8b5cf6",
    badgeBg: "rgba(139,92,246,0.1)",
    text: "#c4b5fd",
    ring: "rgba(139,92,246,0.25)",
  },
  SuspendedEV: {
    dot: "#a78bfa",
    accent: "#a78bfa",
    badgeBg: "rgba(167,139,250,0.1)",
    text: "#c4b5fd",
    ring: "rgba(167,139,250,0.25)",
  },
  SuspendedEVSE: {
    dot: "#a78bfa",
    accent: "#a78bfa",
    badgeBg: "rgba(167,139,250,0.1)",
    text: "#c4b5fd",
    ring: "rgba(167,139,250,0.25)",
  },
  Finishing: {
    dot: "#60a5fa",
    accent: "#60a5fa",
    badgeBg: "rgba(96,165,250,0.1)",
    text: "#93c5fd",
    ring: "rgba(96,165,250,0.25)",
  },
  Reserved: {
    dot: "#fbbf24",
    accent: "#f59e0b",
    badgeBg: "rgba(245,158,11,0.1)",
    text: "#fde68a",
    ring: "rgba(245,158,11,0.25)",
  },
  Unavailable: {
    dot: "#6b7280",
    accent: "#4b5563",
    badgeBg: "rgba(107,114,128,0.1)",
    text: "#9ca3af",
    ring: "rgba(107,114,128,0.25)",
  },
  Faulted: {
    dot: "#f43f5e",
    accent: "#f43f5e",
    badgeBg: "rgba(244,63,94,0.1)",
    text: "#fda4af",
    ring: "rgba(244,63,94,0.25)",
  },
};

const STOP_REASONS: StopReason[] = [
  "Local",
  "EmergencyStop",
  "EVDisconnected",
  "HardReset",
  "Other",
  "PowerLoss",
  "Reboot",
  "Remote",
  "SoftReset",
  "UnlockCommand",
  "DeAuthorized",
];
const ALL_STATUSES: ConnectorStatus[] = [
  "Available",
  "Preparing",
  "Charging",
  "SuspendedEV",
  "SuspendedEVSE",
  "Finishing",
  "Reserved",
  "Unavailable",
  "Faulted",
];
const ERROR_CODES = [
  "InternalError",
  "ConnectorLockFailure",
  "EVCommunicationError",
  "GroundFailure",
  "HighTemperature",
  "LocalListConflict",
  "OtherError",
  "OverCurrentFailure",
  "PowerMeterFailure",
  "PowerSwitchFailure",
  "ReaderFailure",
  "ResetFailure",
  "UnderVoltage",
  "OverVoltage",
  "WeakSignal",
];

/* ──────────────────────────────────
   CONNECTOR PANEL
   ────────────────────────────────── */
export function ConnectorPanel({ connectorId }: { connectorId: number }) {
  const {
    status: globalStatus,
    config,
    connectors,
    updateConnector,
  } = useActiveCharger();
  const connector = connectors[connectorId];
  const is2x = config.ocppVersion !== "ocpp1.6";

  const [selectedStatus, setSelectedStatus] = useState<ConnectorStatus>(
    connector?.status || "Available",
  );
  const [selectedErrorCode, setSelectedErrorCode] = useState("InternalError");
  const [customMeterStep, setCustomMeterStep] = useState<number>(10);

  // ── NEW: direct meter value setter ──
  const [meterSetInput, setMeterSetInput] = useState<string>("");

  // ── NEW: maintenance mode local toggle ──
  const [inMaintenance, setInMaintenance] = useState(false);

  if (!connector) return null;

  const isConnected = globalStatus === "connected";
  const st = SC[connector.status];
  const inTx = connector.inTransaction;
  const barPct = Math.min((connector.currentMeterValue / 5000) * 100, 100);

  // Set meter value handler
  const handleSetMeter = () => {
    const val = parseFloat(meterSetInput);
    if (!Number.isNaN(val) && val >= 0) {
      updateConnector(connectorId, { currentMeterValue: val });
      setMeterSetInput("");
    }
  };

  // Maintenance mode toggle — sets Unavailable/Available locally + notifies CSMS
  const toggleMaintenance = () => {
    if (!inMaintenance) {
      updateConnector(connectorId, { status: "Unavailable" });
      if (isConnected)
        ocppService.sendStatusNotification(connectorId, "Unavailable");
      setInMaintenance(true);
    } else {
      updateConnector(connectorId, { status: "Available" });
      if (isConnected)
        ocppService.sendStatusNotification(connectorId, "Available");
      setInMaintenance(false);
    }
  };

  return (
    <div className="relative flex flex-col rounded-xl overflow-hidden bg-[#181a24] border border-[#282b3a] shadow-lg transition-colors h-full">
      {/* Dynamic top bar accent */}
      <div
        className="absolute top-0 inset-x-0 opacity-30! h-px z-10"
        style={{
          background: inTx
            ? `linear-gradient(90deg, ${st.accent}, ${st.accent}80)`
            : st.accent,
          opacity: inTx ? 1 : 0.8,
        }}
      />

      {/* ── HEADER ── */}
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-[#232636] bg-[#1d1f2b]">
        {/* Icon */}
        <div className="relative shrink-0 flex items-center justify-center w-8 h-8 rounded-md border border-[#232636] bg-[#121420]">
          <PlugZap
            className={`h-4 w-4 ${inTx ? "animate-pulse" : ""}`}
            style={{
              color: st.accent,
              filter: inTx ? `drop-shadow(0 0 6px ${st.accent})` : "none",
            }}
          />
          <div
            className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-[#1d1f2b]"
            style={{ background: st.dot }}
          />
        </div>

        {/* All metadata inline */}
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          <span className="text-[13px] font-bold text-white leading-none tracking-tight shrink-0">
            Connector {connectorId}
          </span>
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border shrink-0"
            style={{
              backgroundColor: st.badgeBg,
              color: st.text,
              borderColor: st.ring,
            }}
          >
            {connector.status}
          </span>
          {inMaintenance && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border border-amber-500/40 bg-amber-500/10 text-amber-400 flex items-center gap-1 shrink-0">
              <Wrench className="h-2.5 w-2.5" /> Maint
            </span>
          )}
          {inTx ? (
            <span className="flex items-center gap-1 text-[10px] font-mono text-[#c4b5fd] px-1.5 py-0.5 rounded bg-[#1e1535] border border-[#5b21b6] leading-none shrink-0">
              <Zap className="h-2.5 w-2.5" /> TX:{connector.transactionId}
            </span>
          ) : connector.reservation ? (
            <span className="flex items-center gap-1 text-[10px] font-mono text-[#fcd34d] px-1.5 py-0.5 rounded bg-[#382b0e] border border-[#7a5a1a] leading-none shrink-0">
              <CalendarCheck className="h-2.5 w-2.5" /> RSV:
              {connector.reservation.reservationId}
            </span>
          ) : (
            <span className="text-[10px] text-[#5d6577] uppercase tracking-wide leading-none">
              Idle
            </span>
          )}
        </div>
      </div>

      {/* ── SPLIT BODY ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#232636] flex-1">
        {/* LEFT PANE: Energy Hub & Reservations */}
        <div className="flex flex-col bg-[#0f1117]">
          <div className="p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#5d6577]">
                Active Session Energy
              </span>
              {inTx && (
                <button
                  onClick={() => ocppService.sendMeterValues(connectorId)}
                  className="flex items-center gap-1 text-[10px] font-bold text-[#8b5cf6] hover:text-[#c4b5fd] px-2 py-1 rounded hover:bg-[#1e1535] transition-colors cursor-pointer"
                >
                  <Gauge className="h-3 w-3" /> Push Value
                </button>
              )}
            </div>

            {/* Big readout */}
            <div className="flex items-end gap-3 mb-1">
              <div className="flex items-baseline flex-1 min-w-0 border-b border-[#232636] pb-1">
                <Input
                  type="number"
                  value={connector.currentMeterValue}
                  disabled={!inTx}
                  onChange={(e) =>
                    updateConnector(connectorId, {
                      currentMeterValue: Number(e.target.value),
                    })
                  }
                  className={`w-full h-auto bg-transparent border-none p-0 text-[40px] md:text-[48px] font-black font-mono tracking-tighter leading-none focus-visible:ring-0 shadow-none disabled:opacity-100 ${
                    inTx ? "text-white" : "text-[#383e50]"
                  }`}
                />
                <span
                  className={`text-[14px] font-bold uppercase ml-2 ${
                    inTx ? "text-[#8b5cf6]" : "text-[#383e50]"
                  }`}
                >
                  Wh
                </span>
              </div>
            </div>

            {/* ── SET METER VALUE row — always visible ── */}
            <div className="mt-3 flex items-center gap-2 bg-[#181a24] p-2 rounded-lg border border-[#232636]">
              <span className="text-[9px] font-bold text-[#5d6577] uppercase tracking-widest shrink-0">
                Set&nbsp;→
              </span>
              <input
                type="number"
                value={meterSetInput}
                placeholder="e.g. 5000"
                onChange={(e) => setMeterSetInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSetMeter()}
                className="flex-1 h-8 px-2 text-[12px] font-mono text-white bg-[#121420] border border-[#282b3a] rounded outline-none placeholder:text-[#383e50] focus:border-[#8b5cf6] focus:shadow-[0_0_0_2px_rgba(139,92,246,0.12)] transition-all min-w-0"
              />
              <button
                onClick={handleSetMeter}
                className="h-8 px-3 rounded text-[11px] font-bold text-[#c4b5fd] bg-[#1e1535] hover:bg-[#115e56] transition-colors cursor-pointer shrink-0 border border-[#5b21b6]"
              >
                Set Wh
              </button>
            </div>

            {/* ── ADD step row — only during tx ── */}
            {inTx && (
              <div className="flex items-center gap-2 mt-2 bg-[#181a24] p-2 rounded-lg border border-[#232636]">
                <span className="text-[9px] font-bold text-[#5d6577] uppercase tracking-widest shrink-0">
                  Add&nbsp;+
                </span>
                <Input
                  type="number"
                  value={customMeterStep}
                  onChange={(e) =>
                    setCustomMeterStep(Number(e.target.value) || 0)
                  }
                  className="h-8 max-w-[80px] text-center bg-[#121420] border-[#282b3a] font-mono text-[13px] text-white focus-visible:ring-1 focus-visible:ring-[#8b5cf6]"
                />
                <button
                  onClick={() =>
                    updateConnector(connectorId, {
                      currentMeterValue:
                        connector.currentMeterValue + customMeterStep,
                    })
                  }
                  className="h-8 px-3 rounded text-[11px] font-bold text-[#8b5cf6] bg-[#1e1535] hover:bg-[#115e56] hover:text-[#c4b5fd] transition-colors cursor-pointer flex-1"
                >
                  Add Wh
                </button>
                <div className="w-px h-6 bg-[#282b3a]" />
                <button
                  onClick={() => ocppService.sendMeterValues(connectorId)}
                  className="h-8 px-3 rounded btn-primary text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Gauge className="h-3.5 w-3.5" /> Push
                </button>
              </div>
            )}

            <div
              className={`mt-4 h-2 w-full rounded-full bg-[#1d1f2b] overflow-hidden transition-opacity duration-300 ${
                inTx ? "opacity-100" : "opacity-30"
              }`}
            >
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${barPct}%`,
                  background: inTx ? st.accent : "#5d6577",
                  boxShadow: inTx ? `0 0 12px ${st.accent}` : "none",
                }}
              />
            </div>
          </div>

          <div className="mt-auto border-t border-[#232636] p-4 bg-[#121420] flex flex-col gap-4">
            {/* Reservation Module */}
            <div>
              <span className="block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5d6577]">
                Reservation Handling
              </span>
              {connector.reservation ? (
                <div className="flex items-center justify-between bg-[#382b0e] border border-[#7a5a1a] rounded-lg p-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-mono text-[#fcd34d]">
                      ID: {connector.reservation.reservationId}
                    </span>
                    <span className="text-[10px] text-[#fbbf24]">
                      Tag: {connector.reservation.idTag}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      updateConnector(connectorId, { reservation: null });
                      if (connector.status === "Reserved")
                        ocppService.sendStatusNotification(
                          connectorId,
                          "Available",
                        );
                    }}
                    className="h-8 px-3 text-[10px] font-bold rounded bg-[#7a5a1a]/30 hover:bg-[#7a5a1a]/60 text-[#fde68a] transition-colors cursor-pointer"
                  >
                    Clear Local
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center h-12 border border-dashed border-[#282b3a] rounded-lg text-[#5d6577] text-[11px] font-medium tracking-wide">
                  No Active Reservation
                </div>
              )}
            </div>

            {/* Local Operations */}
            <div className="border-t border-[#232636] pt-3">
              <span className="block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5d6577]">
                Local Operations
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={!isConnected}
                  onClick={() =>
                    ocppService.sendStatusNotification(
                      connectorId,
                      connector.status,
                    )
                  }
                  className="h-8 rounded bg-[#1f2231] hover:bg-[#282b3a] border border-[#282b3a] text-[#a0a8b8] hover:text-white text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
                >
                  <Activity className="h-3 w-3" /> Ping Status
                </button>
                <button
                  disabled={!isConnected}
                  onClick={() =>
                    ocppService.sendStatusNotification(connectorId, "Available")
                  }
                  className="h-8 rounded bg-[#1f2231] hover:bg-[#282b3a] border border-[#282b3a] text-[#a0a8b8] hover:text-white text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
                >
                  <Unlock className="h-3 w-3" /> Force Unlock
                </button>
                <button
                  disabled={!isConnected}
                  onClick={() =>
                    ocppService.sendStatusNotification(
                      connectorId,
                      "Unavailable",
                    )
                  }
                  className="h-8 rounded bg-[#1f2231] hover:bg-[#282b3a] border border-[#282b3a] text-[#a0a8b8] hover:text-white text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
                >
                  <PowerOff className="h-3 w-3" /> Set Offline
                </button>
                {/* ── FIXED: Maintenance Mode ── */}
                <button
                  onClick={toggleMaintenance}
                  className={`h-8 rounded border text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    inMaintenance
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30"
                      : "bg-[#1f2231] border-[#282b3a] text-[#a0a8b8] hover:bg-[#282b3a] hover:text-white"
                  }`}
                >
                  <Wrench className="h-3 w-3" />{" "}
                  {inMaintenance ? "Exit Maint." : "Maint. Mode"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANE: Controls, Auth, Diagnostics */}
        <div className="flex flex-col bg-[#181a24]">
          {/* Auth Block */}
          <div className="p-4 border-b border-[#232636]">
            <span className="block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5d6577]">
              Authorization Map
            </span>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Radio className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5d6577] pointer-events-none" />
                <input
                  value={connector.idTag}
                  onChange={(e) =>
                    updateConnector(connectorId, { idTag: e.target.value })
                  }
                  className="w-full h-9 pl-9 pr-3 rounded-md text-[13px] font-mono text-white bg-[#121420] border border-[#232636] outline-none placeholder:text-[#383e50] focus:border-[#8b5cf6] focus:shadow-[0_0_0_2px_rgba(139,92,246,0.15)] transition-all"
                  placeholder="RFID Token"
                />
              </div>
              <button
                disabled={!isConnected}
                onClick={() =>
                  is2x
                    ? ocppService.sendAuthorize201(connector.idTag)
                    : ocppService.authorize(connectorId, connector.idTag)
                }
                className="h-9 px-4 rounded-md btn-primary text-[11px] font-bold uppercase tracking-wider flex items-center gap-2 cursor-pointer disabled:opacity-40 shrink-0"
              >
                <ShieldCheck className="h-4 w-4" /> Auth
              </button>
            </div>
          </div>

          {/* Transaction Controls */}
          <div className="p-4 border-b border-[#232636]">
            <span className="block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5d6577]">
              Control Sequence
            </span>
            <div className="grid grid-cols-2 gap-2">
              {!inTx ? (
                <button
                  disabled={!isConnected}
                  onClick={() =>
                    is2x
                      ? ocppService.startTransaction201(
                          connectorId,
                          connector.idTag,
                        )
                      : ocppService.startTransaction(connectorId)
                  }
                  className="h-10 rounded-md btn-success text-[12px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
                >
                  <Play className="h-4 w-4" /> Start Tx
                </button>
              ) : (
                <button
                  disabled={!isConnected}
                  onClick={() =>
                    is2x
                      ? ocppService.stopTransaction201(connectorId)
                      : ocppService.stopTransaction(connectorId)
                  }
                  className="h-10 rounded-md btn-danger text-[12px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
                >
                  <Square className="h-4 w-4" /> Stop Tx
                </button>
              )}
              <button
                disabled={!isConnected}
                onClick={() =>
                  inTx
                    ? ocppService.stopAutoCharge(connectorId)
                    : ocppService.startAutoCharge(connectorId)
                }
                className={`h-10 rounded-md text-[12px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 ${
                  inTx
                    ? "btn-warning bg-opacity-20 border-[#f59e0b]"
                    : "btn-ghost"
                }`}
              >
                <Bolt className={`h-4 w-4 ${inTx ? "animate-pulse" : ""}`} />{" "}
                {inTx ? "Auto Mode: ON" : "Auto Charge"}
              </button>
            </div>
            {inTx && (
              <div className="mt-3">
                <MiniSelect
                  label="Transaction Stop Reason"
                  value={connector.stopReason}
                  options={STOP_REASONS}
                  onChange={(v) =>
                    updateConnector(connectorId, {
                      stopReason: v as StopReason,
                    })
                  }
                />
              </div>
            )}
          </div>

          {/* Diagnostics — always exposed */}
          <div className="p-4 bg-[#121420] flex-1">
            <div className="flex items-center justify-between mb-3 border-b border-[#282b3a] pb-2">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#8b5cf6]">
                <AlertTriangle className="w-3.5 h-3.5" /> Diagnostics Injection
              </span>
              <Settings className="h-3 w-3 text-[#5d6577]" />
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 relative">
                <MiniSelect
                  label="Override Status Element"
                  value={selectedStatus}
                  options={ALL_STATUSES}
                  onChange={(v) => setSelectedStatus(v as ConnectorStatus)}
                  icon={<Activity className="h-3 w-3 text-[#5d6577]" />}
                />
                <button
                  disabled={!isConnected}
                  onClick={() =>
                    ocppService.sendStatusNotification(
                      connectorId,
                      selectedStatus,
                    )
                  }
                  className="h-9 w-full rounded-md btn-ghost border-[#282b3a] bg-[#1d1f2b] text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 text-[#a0a8b8] hover:text-[#c4b5fd] hover:border-[#c4b5fd] transition-colors"
                >
                  <Send className="h-3 w-3" /> Push Status Notification
                </button>
              </div>
              <div className="flex flex-col gap-2 relative">
                <MiniSelect
                  label="Inject System Fault Code"
                  value={selectedErrorCode}
                  options={ERROR_CODES}
                  onChange={(v) => setSelectedErrorCode(v)}
                  icon={<AlertTriangle className="h-3 w-3 text-[#5d6577]" />}
                />
                <button
                  disabled={!isConnected}
                  onClick={() =>
                    ocppService.sendStatusNotification(
                      connectorId,
                      "Faulted",
                      selectedErrorCode,
                    )
                  }
                  className="h-9 w-full rounded-md bg-[#2a0f15] hover:bg-[#3a1520] border border-[#7f2030] text-[#fda4af] text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
                >
                  <AlertTriangle className="h-3 w-3" /> Trip Fault Sequence
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
