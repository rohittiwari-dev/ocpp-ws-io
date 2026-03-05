"use client";

import { motion } from "framer-motion";
import {
  BookOpen,
  Box,
  ChevronRight,
  Cpu,
  Monitor,
  Terminal,
} from "lucide-react";
import Link from "next/link";

const ITEMS = [
  {
    key: "library",
    label: "Core Library",
    name: "ocpp-ws-io",
    description:
      "Type-safe OCPP WebSocket RPC for Node.js. Unified client & server across OCPP 1.6, 2.0.1, and 2.1 with schema validation and Redis clustering.",
    icon: Box,
    badge: "npm",
    badgeColor: "bg-red-500/10 text-red-400 border-red-500/20",
    accentColor: "#7c3aed",
    glow: "from-violet-500/20 to-purple-600/5",
    border: "border-violet-500/20 hover:border-violet-500/40",
    href: "/docs",
    cta: "Read the docs",
    tags: ["OCPP 1.6", "2.0.1", "2.1", "TypeScript", "Node.js"],
  },
  {
    key: "simulator",
    label: "Browser Simulator",
    name: "OCPP Simulator",
    description:
      "Zero-install charge point emulator that runs entirely in the browser. Connect to any CSMS, inspect live OCPP frames, and simulate full charging sessions.",
    icon: Monitor,
    badge: "live",
    badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    accentColor: "#10b981",
    glow: "from-emerald-500/20 to-teal-600/5",
    border: "border-emerald-500/20 hover:border-emerald-500/40",
    href: "https://ocpp.rohittiwari.me",
    cta: "Open simulator",
    tags: ["Multi-charger", "Live logs", "JSON/CSV export", "Keyboard-first"],
    external: true,
  },
  {
    key: "cli",
    label: "CLI Toolbox",
    name: "ocpp-ws-io CLI",
    description:
      "Command-line tools to scaffold projects, send test messages, spin up mock CSMS servers, and debug OCPP traffic — all from your terminal.",
    icon: Terminal,
    badge: "npx",
    badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    accentColor: "#f59e0b",
    glow: "from-amber-500/20 to-orange-600/5",
    border: "border-amber-500/20 hover:border-amber-500/40",
    href: "/docs/cli",
    cta: "Explore commands",
    tags: ["Scaffold", "Mock server", "Test runner", "OCPP inspector"],
  },
  {
    key: "docs",
    label: "Documentation",
    name: "Full Reference",
    description:
      "Comprehensive guides, API reference, integration examples, and architecture deep-dives — everything you need from first install to production.",
    icon: BookOpen,
    badge: "open",
    badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    accentColor: "#3b82f6",
    glow: "from-blue-500/20 to-indigo-600/5",
    border: "border-blue-500/20 hover:border-blue-500/40",
    href: "/docs",
    cta: "Browse docs",
    tags: ["Quick start", "API reference", "Security", "Clustering"],
  },
  {
    key: "browser-client",
    label: "Browser Client",
    name: "BrowserOCPPClient",
    description:
      "Zero-dependency browser WebSocket client built on the native WebSocket API. Same typed call/handle interface as the Node.js client.",
    icon: Cpu,
    badge: "pkg",
    badgeColor: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    accentColor: "#0ea5e9",
    glow: "from-sky-500/20 to-cyan-600/5",
    border: "border-sky-500/20 hover:border-sky-500/40",
    href: "/docs/browser-client",
    cta: "View browser client",
    tags: ["No dependencies", "Auto-reconnect", "Typed", "Browser-native"],
  },
] as const;

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" as const },
  },
};

export function Ecosystem() {
  return (
    <section className="relative py-28 overflow-hidden border-t border-fd-border/50">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute top-0 left-1/4 h-96 w-96 rounded-full bg-violet-500/5 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-72 w-72 rounded-full bg-emerald-500/5 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-blue-500/3 blur-3xl" />
      </div>

      <div className="container max-w-7xl mx-auto px-4 relative z-10">
        {/* Heading */}
        <div className="text-center mb-20">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-4 py-1.5 text-xs font-semibold text-fd-muted-foreground mb-6"
          >
            <span className="flex h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
            Everything in one ecosystem
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.05 }}
            className="text-4xl sm:text-5xl font-bold tracking-tight text-fd-foreground mb-5"
          >
            Built to cover the{" "}
            <span className="bg-linear-to-r from-violet-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">
              full OCPP stack
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-lg text-fd-muted-foreground max-w-2xl mx-auto"
          >
            From the core protocol library to a live browser simulator — every
            tool you need to build, test, and ship OCPP charging infrastructure.
          </motion.p>
        </div>

        {/* Cards grid — 2 on top, 3 on bottom */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid gap-5 md:grid-cols-2 lg:grid-cols-3"
        >
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const isExternal = "external" in item && item.external;
            return (
              <motion.div key={item.key} variants={cardVariants}>
                <Link
                  href={item.href}
                  target={isExternal ? "_blank" : undefined}
                  rel={isExternal ? "noopener noreferrer" : undefined}
                  className={`group relative flex flex-col h-full rounded-2xl border bg-fd-card/60 backdrop-blur-sm p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${
                    item.border
                  } ${
                    item.key === "library" || item.key === "simulator"
                      ? "md:col-span-1"
                      : ""
                  }`}
                >
                  {/* Gradient glow on hover */}
                  <div
                    className={`pointer-events-none absolute inset-0 rounded-2xl bg-linear-to-br ${item.glow} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
                  />

                  {/* Header */}
                  <div className="relative flex items-start justify-between mb-5">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-xl"
                      style={{
                        background: `${item.accentColor}18`,
                        border: `1px solid ${item.accentColor}30`,
                      }}
                    >
                      <Icon
                        className="h-5 w-5"
                        style={{ color: item.accentColor }}
                      />
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${item.badgeColor}`}
                    >
                      {item.badge}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="relative flex-1 flex flex-col">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-fd-muted-foreground mb-1">
                      {item.label}
                    </p>
                    <h3 className="text-xl font-bold text-fd-foreground mb-3">
                      {item.name}
                    </h3>
                    <p className="text-sm text-fd-muted-foreground leading-relaxed mb-5 flex-1">
                      {item.description}
                    </p>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1.5 mb-5">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-fd-border bg-fd-muted/50 px-2 py-0.5 text-[10px] font-medium text-fd-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* CTA */}
                    <div
                      className="flex items-center gap-1 text-sm font-semibold transition-colors"
                      style={{ color: item.accentColor }}
                    >
                      {item.cta}
                      <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
