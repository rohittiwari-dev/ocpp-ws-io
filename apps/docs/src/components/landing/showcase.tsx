"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Terminal, Wifi, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

// ── Log stream data ───────────────────────────────────────────────────────────
const LOG_STREAM = [
  {
    dir: "SYS",
    action: "Server started",
    detail: "port 9220 · ocpp1.6 · ocpp2.0.1",
    color: "#6b7280",
  },
  {
    dir: "SYS",
    action: "Client connected",
    detail: "CP-001 @ 192.168.1.42",
    color: "#6b7280",
  },
  {
    dir: "RX ",
    action: "BootNotification",
    detail: '{ vendor: "Tesla", model: "WC-3" }',
    color: "#60a5fa",
  },
  {
    dir: "TX ",
    action: "BootNotification",
    detail: '{ status: "Accepted", interval: 300 }',
    color: "#4ade80",
  },
  { dir: "RX ", action: "Heartbeat", detail: "{}", color: "#60a5fa" },
  {
    dir: "TX ",
    action: "Heartbeat",
    detail: '{ currentTime: "2026-03-05T04:15:00Z" }',
    color: "#4ade80",
  },
  {
    dir: "RX ",
    action: "Authorize",
    detail: '{ idTag: "DEADBEEF" }',
    color: "#60a5fa",
  },
  {
    dir: "TX ",
    action: "Authorize",
    detail: '{ idTagInfo: { status: "Accepted" } }',
    color: "#4ade80",
  },
  {
    dir: "RX ",
    action: "StartTransaction",
    detail: '{ connectorId: 1, idTag: "DEADBEEF" }',
    color: "#60a5fa",
  },
  {
    dir: "TX ",
    action: "StartTransaction",
    detail: '{ transactionId: 1001, status: "Accepted" }',
    color: "#4ade80",
  },
  {
    dir: "RX ",
    action: "MeterValues",
    detail: '{ energy: "12.4 kWh", power: "7.4 kW" }',
    color: "#60a5fa",
  },
  {
    dir: "SYS",
    action: "Waiting for next MeterValues…",
    detail: "",
    color: "#374151",
  },
] as const;

// ── Code tabs ────────────────────────────────────────────────────────────────
const TABS = [
  {
    id: "client",
    label: "Client",
    filename: "charger.ts",
    lines: [
      [
        { t: "import", c: "#ff7b72" },
        { t: " { OCPPClient } ", c: "#79c0ff" },
        { t: "from", c: "#ff7b72" },
        { t: " 'ocpp-ws-io'", c: "#a5d6ff" },
        { t: ";", c: "#8b949e" },
      ],
      [],
      [
        { t: "const", c: "#ff7b72" },
        { t: " client = ", c: "#c9d1d9" },
        { t: "new", c: "#ff7b72" },
        { t: " OCPPClient", c: "#d2a8ff" },
        { t: "({", c: "#c9d1d9" },
      ],
      [
        { t: "  endpoint: ", c: "#c9d1d9" },
        { t: "'ws://csms.local'", c: "#a5d6ff" },
        { t: ",", c: "#c9d1d9" },
      ],
      [
        { t: "  identity: ", c: "#c9d1d9" },
        { t: "'CP-001'", c: "#a5d6ff" },
        { t: ",", c: "#c9d1d9" },
      ],
      [
        { t: "  protocols: [", c: "#c9d1d9" },
        { t: "'ocpp1.6'", c: "#a5d6ff" },
        { t: "],", c: "#c9d1d9" },
      ],
      [{ t: "});", c: "#c9d1d9" }],
      [],
      [
        { t: "client.", c: "#c9d1d9" },
        { t: "handle", c: "#d2a8ff" },
        { t: "('Reset', ({ ", c: "#c9d1d9" },
        { t: "params", c: "#ff7b72" },
        { t: " }) => ({", c: "#c9d1d9" },
      ],
      [
        { t: "  status: ", c: "#c9d1d9" },
        { t: "'Accepted'", c: "#a5d6ff" },
      ],
      [{ t: "}));", c: "#c9d1d9" }],
      [],
      [
        { t: "await", c: "#ff7b72" },
        { t: " client.", c: "#c9d1d9" },
        { t: "connect", c: "#d2a8ff" },
        { t: "();", c: "#c9d1d9" },
      ],
    ],
  },
  {
    id: "server",
    label: "Server",
    filename: "server.ts",
    lines: [
      [
        { t: "import", c: "#ff7b72" },
        { t: " { OCPPServer } ", c: "#79c0ff" },
        { t: "from", c: "#ff7b72" },
        { t: " 'ocpp-ws-io'", c: "#a5d6ff" },
        { t: ";", c: "#8b949e" },
      ],
      [],
      [
        { t: "const", c: "#ff7b72" },
        { t: " server = ", c: "#c9d1d9" },
        { t: "new", c: "#ff7b72" },
        { t: " OCPPServer", c: "#d2a8ff" },
        { t: "({", c: "#c9d1d9" },
      ],
      [
        { t: "  protocols: [", c: "#c9d1d9" },
        { t: "'ocpp1.6'", c: "#a5d6ff" },
        { t: ", ", c: "#c9d1d9" },
        { t: "'ocpp2.0.1'", c: "#a5d6ff" },
        { t: "],", c: "#c9d1d9" },
      ],
      [{ t: "});", c: "#c9d1d9" }],
      [],
      [
        { t: "server.", c: "#c9d1d9" },
        { t: "on", c: "#d2a8ff" },
        { t: "('client', (", c: "#c9d1d9" },
        { t: "client", c: "#ff7b72" },
        { t: ") => {", c: "#c9d1d9" },
      ],
      [
        { t: "  client.", c: "#c9d1d9" },
        { t: "handle", c: "#d2a8ff" },
        { t: "('BootNotification', () => ({", c: "#c9d1d9" },
      ],
      [
        { t: "    status: ", c: "#c9d1d9" },
        { t: "'Accepted'", c: "#a5d6ff" },
        { t: ", interval: ", c: "#c9d1d9" },
        { t: "300", c: "#79c0ff" },
      ],
      [{ t: "  }));", c: "#c9d1d9" }],
      [{ t: "});", c: "#c9d1d9" }],
      [],
      [
        { t: "await", c: "#ff7b72" },
        { t: " server.", c: "#c9d1d9" },
        { t: "listen", c: "#d2a8ff" },
        { t: "(", c: "#c9d1d9" },
        { t: "9220", c: "#79c0ff" },
        { t: ");", c: "#c9d1d9" },
      ],
    ],
  },
  {
    id: "browser",
    label: "Browser",
    filename: "simulator.ts",
    lines: [
      [
        { t: "import", c: "#ff7b72" },
        { t: " { BrowserOCPPClient } ", c: "#79c0ff" },
        { t: "from", c: "#ff7b72" },
        { t: " 'ocpp-ws-io/browser'", c: "#a5d6ff" },
        { t: ";", c: "#8b949e" },
      ],
      [],
      [{ t: "// Zero Node.js deps — runs in any browser", c: "#8b949e" }],
      [
        { t: "const", c: "#ff7b72" },
        { t: " client = ", c: "#c9d1d9" },
        { t: "new", c: "#ff7b72" },
        { t: " BrowserOCPPClient", c: "#d2a8ff" },
        { t: "({", c: "#c9d1d9" },
      ],
      [
        { t: "  endpoint: ", c: "#c9d1d9" },
        { t: "'wss://csms.example.com'", c: "#a5d6ff" },
        { t: ",", c: "#c9d1d9" },
      ],
      [
        { t: "  identity: ", c: "#c9d1d9" },
        { t: "'CP-001'", c: "#a5d6ff" },
        { t: ",", c: "#c9d1d9" },
      ],
      [{ t: "});", c: "#c9d1d9" }],
      [],
      [
        { t: "await", c: "#ff7b72" },
        { t: " client.", c: "#c9d1d9" },
        { t: "connect", c: "#d2a8ff" },
        { t: "();", c: "#c9d1d9" },
      ],
      [],
      [
        { t: "const", c: "#ff7b72" },
        { t: " res = ", c: "#c9d1d9" },
        { t: "await", c: "#ff7b72" },
        { t: " client.", c: "#c9d1d9" },
        { t: "call", c: "#d2a8ff" },
        { t: "(", c: "#c9d1d9" },
      ],
      [{ t: "  'ocpp1.6', 'BootNotification',", c: "#a5d6ff" }],
      [
        { t: "  { chargePointVendor: ", c: "#c9d1d9" },
        { t: "'ACME'", c: "#a5d6ff" },
        { t: " }", c: "#c9d1d9" },
      ],
      [
        { t: "); ", c: "#c9d1d9" },
        { t: "// res.status → 'Accepted'", c: "#8b949e" },
      ],
    ],
  },
] as const;

const STATUS_COLORS: Record<string, string> = {
  Charging: "#3b82f6",
  Available: "#22c55e",
  Connecting: "#f59e0b",
};

export function Showcase() {
  const [visibleCount, setVisibleCount] = useState(1);
  const [activeTab, setActiveTab] = useState("client");
  const activeCode = TABS.find((t) => t.id === activeTab);

  const phase =
    visibleCount >= 10
      ? "Charging"
      : visibleCount >= 4
        ? "Available"
        : "Connecting";

  useEffect(() => {
    const id = setInterval(() => {
      setVisibleCount((n) => {
        if (n >= LOG_STREAM.length) return 1; // loop
        return n + 1;
      });
    }, 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="relative py-28 overflow-hidden">
      <div className="container max-w-7xl mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-4 py-1.5 text-xs font-semibold text-fd-muted-foreground mb-6"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            Live OCPP simulation
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.05 }}
            className="text-4xl sm:text-5xl font-bold tracking-tight text-fd-foreground mb-5"
          >
            See it in{" "}
            <span className="bg-linear-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              Action
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-lg text-fd-muted-foreground max-w-2xl mx-auto"
          >
            One typed API — Node.js clients, servers, and zero-dependency
            browser simulators.
          </motion.p>
        </div>

        {/* ── Two column ─────────────────────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          {/* ── Left: Terminal ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="flex flex-col gap-4"
          >
            {/* Terminal window */}
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl shadow-black/30">
              {/* Top glow */}
              <div className="absolute top-0 inset-x-0 h-px bg-linear-to-r from-transparent via-blue-500/50 to-transparent" />

              {/* Window bar */}
              <div className="flex items-center justify-between border-b border-white/8 bg-white/3 px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-[#fa7970]" />
                  <div className="h-3 w-3 rounded-full bg-[#faa356]" />
                  <div className="h-3 w-3 rounded-full bg-[#7ce38b]" />
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px] text-white/30">
                  <Terminal className="h-3 w-3" />
                  ocpp-server · port 9220
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="font-mono text-[10px] text-green-400/60">
                    LIVE
                  </span>
                </div>
              </div>

              {/* Log lines */}
              <div className="p-5 font-mono text-[12.5px] leading-7 min-h-[320px] space-y-0.5">
                <AnimatePresence initial={false}>
                  {LOG_STREAM.slice(0, visibleCount).map((log, i) => (
                    <motion.div
                      key={`${i?.toString()}-${log.action}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-baseline gap-3"
                    >
                      <span className="shrink-0 text-white/20 tabular-nums text-[11px]">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        className="shrink-0 font-bold text-[10px] tracking-widest uppercase rounded px-1.5 py-px"
                        style={{
                          color: log.color,
                          background: `${log.color}18`,
                          border: `1px solid ${log.color}30`,
                        }}
                      >
                        {log.dir}
                      </span>
                      <span className="text-white/80 font-semibold">
                        {log.action}
                      </span>
                      {log.detail && (
                        <span className="text-white/30 truncate">
                          {log.detail}
                        </span>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>

                {/* Blinking cursor */}
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-white/20 tabular-nums text-[11px]">
                    {String(visibleCount + 1).padStart(2, "0")}
                  </span>
                  <span className="inline-block h-4 w-2 bg-green-400/70 animate-pulse rounded-sm" />
                </div>
              </div>
            </div>

            {/* Status card */}
            <div className="flex items-center justify-between rounded-2xl border border-fd-border bg-fd-card/80 backdrop-blur px-5 py-4">
              {/* Charger */}
              <div className="flex items-center gap-3">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-xl border transition-all duration-500"
                  style={{
                    borderColor: `${STATUS_COLORS[phase]}50`,
                    background: `${STATUS_COLORS[phase]}12`,
                  }}
                >
                  <Zap
                    className="h-5 w-5 transition-colors duration-500"
                    style={{ color: STATUS_COLORS[phase] }}
                  />
                </div>
                <div>
                  <p className="text-sm font-bold text-fd-foreground">CP-001</p>
                  <p className="text-xs text-fd-muted-foreground">
                    OCPP Charge Point
                  </p>
                </div>
              </div>

              {/* Wire */}
              <div className="flex items-center gap-2">
                <div className="h-px w-8 bg-fd-border" />
                <Wifi className="h-4 w-4 text-fd-muted-foreground" />
                <div className="h-px w-8 bg-fd-border" />
              </div>

              {/* Status badge */}
              <div
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all duration-500"
                style={{
                  borderColor: `${STATUS_COLORS[phase]}40`,
                  background: `${STATUS_COLORS[phase]}10`,
                }}
              >
                <span
                  className="h-2 w-2 rounded-full animate-pulse"
                  style={{ background: STATUS_COLORS[phase] }}
                />
                <span
                  className="text-sm font-semibold"
                  style={{ color: STATUS_COLORS[phase] }}
                >
                  {phase}
                </span>
              </div>
            </div>
          </motion.div>

          {/* ── Right: Code tabs ──────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl shadow-black/30"
          >
            <div className="absolute top-0 inset-x-0 h-px bg-linear-to-r from-transparent via-violet-500/50 to-transparent" />

            {/* Tab bar */}
            <div className="flex items-center justify-between border-b border-white/8 bg-white/3">
              {TABS.map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative px-5 py-3 text-[12px] font-mono font-medium transition-colors ${
                    activeTab === tab.id
                      ? "text-white"
                      : "text-white/30 hover:text-white/60"
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="codeTab"
                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-violet-400"
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 30,
                      }}
                    />
                  )}
                </button>
              ))}
              <div className="flex-1" />
              <span className="px-4 font-mono text-[10px] text-white/25">
                {activeCode?.filename}
              </span>
            </div>

            {/* Code with line numbers */}
            <div className="flex min-h-[360px]">
              {/* Line numbers */}
              <div className="select-none border-r border-white/5 p-5 pr-4 text-right font-mono text-[12px] leading-7 text-white/15">
                {activeCode?.lines.map((_, i) => (
                  <div key={`line-${i?.toString()}`}>{i + 1}</div>
                ))}
              </div>

              {/* Code */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="flex-1 overflow-x-auto p-5 pl-4 font-mono text-[12.5px] leading-7"
                >
                  {activeCode?.lines.map((tokens, li) => (
                    <div
                      key={`line-${li?.toString()}`}
                      className="whitespace-pre"
                    >
                      {tokens.length === 0
                        ? "\u00A0"
                        : tokens.map((tok, ti) => (
                            <span
                              key={`${li?.toString()}-${ti?.toString()}`}
                              style={{ color: tok.c }}
                            >
                              {tok.t}
                            </span>
                          ))}
                    </div>
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Bottom bar */}
            <div className="flex items-center justify-between border-b border-white/8 bg-white/3 px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                <span className="font-mono text-[10px] text-white/25">
                  TypeScript
                </span>
              </div>
              <Link
                href="/docs"
                className="flex items-center gap-1 font-mono text-[10px] text-white/30 hover:text-violet-400 transition-colors"
              >
                Full docs <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
