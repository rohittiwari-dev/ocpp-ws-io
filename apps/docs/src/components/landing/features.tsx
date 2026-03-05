"use client";

import { motion } from "framer-motion";
import {
  CheckCircle2,
  Code2,
  Cpu,
  Globe,
  Layers,
  MonitorSmartphone,
  Shield,
  Zap,
} from "lucide-react";

const FEATURED = [
  {
    title: "Type-Safe Everything",
    description:
      "End-to-end TypeScript with auto-generated types for OCPP 1.6, 2.0.1, and 2.1. Request params and responses are fully inferred — catch protocol errors at compile time.",
    icon: Code2,
    accent: "#7c3aed",
    glow: "rgba(124,58,237,0.15)",
    tag: "TypeScript-first",
    span: "lg:col-span-2",
  },
  {
    title: "Security Profiles 0–3",
    description:
      "Plain WS, Basic Auth, TLS + Basic Auth, and Mutual TLS with client certificates — all four OCPP security profiles supported out of the box.",
    icon: Shield,
    accent: "#f43f5e",
    glow: "rgba(244,63,94,0.15)",
    tag: "Production-ready",
    span: "lg:col-span-1",
  },
] as const;

const MINOR = [
  {
    title: "High Performance",
    description:
      "Optimised for concurrent connections with configurable concurrency, timeouts, and queuing.",
    icon: Zap,
    accent: "#f59e0b",
  },
  {
    title: "Multi-Version Support",
    description:
      "Unified API across OCPP 1.6, 2.0.1, and 2.1 — version context always available in handlers.",
    icon: Globe,
    accent: "#3b82f6",
  },
  {
    title: "Schema Validation",
    description:
      "Optional strict mode validates every inbound and outbound message against official JSON schemas.",
    icon: CheckCircle2,
    accent: "#10b981",
  },
  {
    title: "Framework Agnostic",
    description:
      "Attach to Express, Fastify, NestJS, or any Node.js HTTP server with a single method call.",
    icon: Layers,
    accent: "#8b5cf6",
  },
  {
    title: "Redis Clustering",
    description:
      "Optional Redis adapter for multi-instance deployments behind a load balancer.",
    icon: Cpu,
    accent: "#06b6d4",
  },
  {
    title: "Browser Client",
    description:
      "Zero-dependency browser WebSocket client — same typed call/handle API as the Node.js client.",
    icon: MonitorSmartphone,
    accent: "#a855f7",
  },
] as const;

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: "easeOut" as const },
  },
};

export function Features() {
  return (
    <section className="relative py-28 overflow-hidden border-t border-fd-border/50">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-24 right-0 h-72 w-72 rounded-full bg-purple-500/5 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-blue-500/5 blur-3xl" />
      </div>

      <div className="container max-w-7xl mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center mb-20">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-4 py-1.5 text-xs font-semibold text-fd-muted-foreground mb-6"
          >
            <span className="flex h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
            Core library capabilities
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.05 }}
            className="text-4xl sm:text-5xl font-bold tracking-tight text-fd-foreground mb-5"
          >
            Everything you need,{" "}
            <span className="bg-linear-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              nothing you don&apos;t
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-lg text-fd-muted-foreground max-w-2xl mx-auto"
          >
            A complete OCPP toolkit built from the ground up in TypeScript —
            type-safe, tested, and open source.
          </motion.p>
        </div>

        {/* Bento grid */}
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="space-y-5"
        >
          {/* Row 1 — two featured cards */}
          <div className="grid gap-5 lg:grid-cols-3">
            {FEATURED.map((f) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  variants={fadeUp}
                  className={`group relative overflow-hidden rounded-2xl border border-fd-border bg-fd-card p-8 transition-all duration-300 hover:-translate-y-1 ${f.span}`}
                  style={{
                    boxShadow: `0 0 0 1px transparent`,
                  }}
                  whileHover={{
                    boxShadow: `0 0 40px ${f.glow}, 0 1px 0 rgba(255,255,255,0.03)`,
                  }}
                >
                  {/* Glow blob */}
                  <div
                    className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700"
                    style={{ background: f.glow }}
                  />

                  {/* Animated corner accent */}
                  <div
                    className="absolute top-0 right-0 h-px w-0 group-hover:w-1/2 transition-all duration-500"
                    style={{
                      background: `linear-gradient(to left, ${f.accent}80, transparent)`,
                    }}
                  />
                  <div
                    className="absolute top-0 right-0 w-px h-0 group-hover:h-1/3 transition-all duration-500"
                    style={{
                      background: `linear-gradient(to bottom, ${f.accent}80, transparent)`,
                    }}
                  />

                  {/* Icon */}
                  <div
                    className="relative mb-6 flex h-14 w-14 items-center justify-center rounded-xl"
                    style={{
                      background: `${f.accent}15`,
                      border: `1px solid ${f.accent}30`,
                      boxShadow: `0 0 20px ${f.accent}10`,
                    }}
                  >
                    <Icon className="h-6 w-6" style={{ color: f.accent }} />
                  </div>

                  {/* Tag */}
                  <span
                    className="mb-3 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                    style={{
                      background: `${f.accent}18`,
                      color: f.accent,
                      border: `1px solid ${f.accent}30`,
                    }}
                  >
                    {f.tag}
                  </span>

                  <h3 className="text-xl font-bold text-fd-foreground mb-3">
                    {f.title}
                  </h3>
                  <p className="text-sm text-fd-muted-foreground leading-relaxed">
                    {f.description}
                  </p>
                </motion.div>
              );
            })}
          </div>

          {/* Row 2 — six minor cards */}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {MINOR.map((f) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  variants={fadeUp}
                  className="group relative flex gap-4 rounded-2xl border border-fd-border bg-fd-card p-6 transition-all duration-300 hover:-translate-y-0.5"
                  whileHover={{
                    boxShadow: `0 0 28px ${f.accent}18`,
                    borderColor: `${f.accent}40`,
                  }}
                >
                  <div
                    className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-300"
                    style={{
                      background: `${f.accent}12`,
                      border: `1px solid ${f.accent}25`,
                    }}
                  >
                    <Icon className="h-4.5 w-4.5" style={{ color: f.accent }} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-fd-foreground mb-1">
                      {f.title}
                    </h3>
                    <p className="text-xs text-fd-muted-foreground leading-relaxed">
                      {f.description}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
