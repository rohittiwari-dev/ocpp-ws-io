"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Github,
  Shield,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const BADGES = [
  { label: "Core RPC", color: "#7c3aed", delay: 0 },
  { label: "Protocol Proxy", color: "#ec4899", delay: 0.15 },
  { label: "Smart Charging", color: "#eab308", delay: 0.3 },
  { label: "CLI & Simulator", color: "#10b981", delay: 0.45 },
];

const STATS = [
  { value: "3", label: "OCPP versions" },
  { value: "6", label: "Ecosystem packages" },
  { value: "4", label: "Security profiles" },
];

export function Hero() {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText("npm install ocpp-ws-io");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative flex min-h-[96vh] pt-20 flex-col justify-center overflow-hidden">
      {/* ── Animated dot-grid background ─────────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
        aria-hidden
      />

      {/* ── Radial gradient vignette ──────────────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(124,58,237,0.08) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(59,130,246,0.06) 0%, transparent 70%)",
        }}
        aria-hidden
      />

      {/* ── Animated glow rings ───────────────────────────────────────────── */}
      <motion.div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0"
        initial={{ opacity: 0 }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.04, 0.07, 0.04] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      >
        <div className="h-[600px] w-[600px] rounded-full border border-violet-500" />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0"
        initial={{ opacity: 0 }}
        animate={{ scale: [1, 1.05, 1], opacity: [0.03, 0.05, 0.03] }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1,
        }}
        aria-hidden
      >
        <div className="h-[900px] w-[900px] rounded-full border border-blue-500" />
      </motion.div>

      {/* ── Main grid ─────────────────────────────────────────────────────── */}
      <div className="container max-w-7xl mx-auto relative z-10 grid gap-16 px-4 lg:px-8 items-center lg:grid-cols-2 py-24">
        {/* ── Left column ──────────────────────────────────────────────────── */}
        <div className="flex flex-col">
          {/* Version badges */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-wrap items-center gap-2 mb-8"
          >
            {BADGES.map((b) => (
              <motion.span
                key={b.label}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: b.delay, duration: 0.4 }}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold"
                style={{
                  color: b.color,
                  borderColor: `${b.color}40`,
                  background: `${b.color}10`,
                }}
              >
                {b.label}
              </motion.span>
            ))}
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl font-extrabold tracking-tight text-fd-foreground sm:text-6xl lg:text-7xl mb-6 leading-[1.08]"
          >
            The Complete
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #7c3aed 0%, #a855f7 40%, #3b82f6 100%)",
              }}
            >
              OCPP Ecosystem
            </span>
            <br />
            for Node.js
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="max-w-lg text-lg text-fd-muted-foreground mb-10 leading-relaxed"
          >
            A modular, plug-and-play suite of TypeScript tools. Type-safe
            WebSocket RPC, version translation proxy, smart charging math, CLI
            tooling, and a live browser simulator — everything in one ecosystem.
          </motion.p>

          {/* CTA buttons — two rows */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col gap-3 mb-10"
          >
            <div className="flex gap-3 flex-wrap">
              <Link
                href="/docs"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-fd-foreground px-7 text-sm font-semibold text-fd-background transition-all hover:opacity-90 shadow-lg shadow-fd-foreground/10"
              >
                <BookOpen className="h-4 w-4" />
                Explore Ecosystem
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/docs/packages"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-fd-border bg-fd-card px-7 text-sm font-medium transition-all hover:bg-fd-accent hover:text-fd-accent-foreground shadow-sm"
              >
                Browse Packages
              </Link>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link
                href="https://github.com/rohittiwari-dev/ocpp-ws-io"
                target="_blank"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-fd-border bg-fd-card px-7 text-sm font-medium transition-all hover:bg-fd-accent hover:text-fd-accent-foreground shadow-sm"
              >
                <Github className="h-4 w-4" />
                GitHub
              </Link>
              <Link
                href="https://ocpp.rohittiwari.me"
                target="_blank"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/8 px-7 text-sm font-medium text-violet-400 transition-all hover:bg-violet-500/15 shadow-sm"
              >
                <Zap className="h-4 w-4" />
                Live Simulator
              </Link>
            </div>
          </motion.div>

          {/* Install snippet */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.45 }}
            className="flex items-center gap-3 w-fit rounded-xl border border-fd-border bg-fd-card/80 backdrop-blur px-5 py-3 font-mono text-sm text-fd-foreground shadow-sm"
          >
            <span className="select-none text-fd-muted-foreground">$</span>
            <span>npm install ocpp-ws-io</span>
            <button
              type="button"
              onClick={onCopy}
              className="ml-4 text-fd-muted-foreground hover:text-fd-foreground transition-colors"
              aria-label="Copy install command"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </motion.div>

          {/* Stats row */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="mt-10 flex items-center gap-8"
          >
            {STATS.map((s) => (
              <div key={s.label}>
                <p className="text-2xl font-bold text-fd-foreground tabular-nums">
                  {s.value}
                </p>
                <p className="text-xs text-fd-muted-foreground">{s.label}</p>
              </div>
            ))}
          </motion.div>
        </div>

        {/* ── Right column — code card ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, x: 30, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.25, ease: "easeOut" }}
          className="relative flex items-center justify-center lg:justify-end"
        >
          {/* Glow behind card */}
          <div className="absolute -inset-6 rounded-3xl bg-linear-to-br from-violet-500/12 via-transparent to-blue-500/10 blur-2xl" />

          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-fd-border shadow-2xl shadow-black/20 dark:shadow-violet-500/5 bg-[#0d1117] dark:bg-[#0d1117]">
            {/* Window chrome */}
            <div className="flex items-center justify-between border-b border-white/8 bg-white/3 px-4 py-3">
              <div className="flex gap-2">
                <div className="h-3 w-3 rounded-full bg-[#fa7970]" />
                <div className="h-3 w-3 rounded-full bg-[#faa356]" />
                <div className="h-3 w-3 rounded-full bg-[#7ce38b]" />
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono text-white/30">
                <Shield className="h-3 w-3" />
                charger.ts
              </div>
              <div className="w-16" />
            </div>

            {/* Code body */}
            <div className="p-6 font-mono text-[13px] leading-7 overflow-x-auto">
              {/* Line 1 */}
              <div>
                <span className="text-[#ff7b72]">import</span>{" "}
                <span className="text-white/60">{"{ "}</span>
                <span className="text-[#79c0ff]">OCPPClient</span>
                <span className="text-white/60">{" }"}</span>{" "}
                <span className="text-[#ff7b72]">from</span>{" "}
                <span className="text-[#a5d6ff]">&apos;ocpp-ws-io&apos;</span>
              </div>

              <div className="h-3" />

              {/* Line 2-5 */}
              <div>
                <span className="text-[#79c0ff]">const</span> client{" "}
                <span className="text-white/50">=</span>{" "}
                <span className="text-[#ff7b72]">new</span>{" "}
                <span className="text-[#d2a8ff]">OCPPClient</span>
                <span className="text-white/50">({"{"}</span>
              </div>
              <div className="pl-5">
                <span className="text-[#79c0ff]">endpoint</span>
                <span className="text-white/50">:</span>{" "}
                <span className="text-[#a5d6ff]">
                  &apos;ws://csms.example.com&apos;
                </span>
                ,
              </div>
              <div className="pl-5">
                <span className="text-[#79c0ff]">identity</span>
                <span className="text-white/50">:</span>{" "}
                <span className="text-[#a5d6ff]">&apos;CP-001&apos;</span>,
              </div>
              <div className="pl-5">
                <span className="text-[#79c0ff]">protocols</span>
                <span className="text-white/50">:</span>{" "}
                <span className="text-white/50">[</span>
                <span className="text-[#a5d6ff]">&apos;ocpp2.0.1&apos;</span>
                <span className="text-white/50">],</span>
              </div>
              <div>
                <span className="text-white/50">{"}"}</span>);
              </div>

              <div className="h-3" />

              {/* Handler */}
              <div>
                <span className="text-white/40">
                  {"// Fully typed handler"}
                </span>
              </div>
              <div>
                client.
                <span className="text-[#d2a8ff]">handle</span>(
                <span className="text-[#a5d6ff]">&apos;Reset&apos;</span>,
                <span className="text-white/50"> ({"{"} </span>
                <span className="text-[#ff7b72]">params</span>
                <span className="text-white/50">
                  {" "}
                  {"}"}) =&gt; {"{"}
                </span>
              </div>
              <div className="pl-5">
                <span className="text-white/40">
                  {"// params.type → 'Hard' | 'Soft'"}
                </span>
              </div>
              <div className="pl-5">
                <span className="text-[#ff7b72]">return</span>{" "}
                <span className="text-white/50">{"{ "}</span>
                <span className="text-[#79c0ff]">status</span>
                <span className="text-white/50">:</span>{" "}
                <span className="text-[#a5d6ff]">&apos;Accepted&apos;</span>
                <span className="text-white/50">{" }"}</span>
                {";"}
              </div>
              <div>
                <span className="text-white/50">{"}"}</span>);
              </div>

              <div className="h-3" />

              {/* Connect */}
              <div>
                <span className="text-[#ff7b72]">await</span> client.
                <span className="text-[#d2a8ff]">connect</span>();
              </div>

              <div className="h-3" />

              {/* Call */}
              <div>
                <span className="text-[#ff7b72]">const</span> res{" "}
                <span className="text-white/50">=</span>{" "}
                <span className="text-[#ff7b72]">await</span> client.
                <span className="text-[#d2a8ff]">call</span>(
              </div>
              <div className="pl-5">
                <span className="text-[#a5d6ff]">&apos;ocpp2.0.1&apos;</span>,{" "}
                <span className="text-[#a5d6ff]">
                  &apos;BootNotification&apos;
                </span>
                ,
              </div>
              <div className="pl-5">
                <span className="text-white/50">{"{ "}</span>
                <span className="text-[#79c0ff]">reason</span>
                <span className="text-white/50">:</span>{" "}
                <span className="text-[#a5d6ff]">&apos;PowerUp&apos;</span>
                <span className="text-white/50">{" }"}</span>
              </div>
              <div>
                );{" "}
                <span className="text-white/40">
                  {"// res.status → 'Accepted'"}
                </span>
              </div>
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between border-t border-white/8 bg-white/2.5 px-4 py-2">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] font-mono text-white/30">
                  Connected · OCPP 2.0.1
                </span>
              </div>
              <span className="text-[10px] font-mono text-white/20">
                TypeScript
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
