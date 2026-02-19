"use client";

import { motion } from "framer-motion";
import {
  CheckCircle2,
  Code2,
  Cpu,
  Globe,
  Layers,
  Lock,
  MonitorSmartphone,
  Server,
  Shield,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

const features: {
  title: string;
  description: string;
  icon: typeof Code2;
  className?: string;
  visual?: ReactNode;
}[] = [
  {
    title: "Type-Safe Everything",
    description:
      "End-to-end TypeScript support with auto-generated types for every OCPP 1.6, 2.0.1, and 2.1 message. Request params and responses are fully inferred.",
    icon: Code2,
    className: "md:col-span-2 lg:col-span-2",
    visual: (
      <div className="absolute right-4 top-4 hidden lg:block w-72 opacity-50 group-hover:opacity-100 transition-opacity">
        <div className="rounded-md bg-secondary/50 p-3 text-[10px] font-mono leading-relaxed text-muted-foreground border border-border">
          <div>
            <span className="text-purple-400">const</span> res ={" "}
            <span className="text-yellow-400">await</span> client.
            <span className="text-blue-400">call</span>(
          </div>
          <div className="pl-2">
            <span className="text-green-400">&apos;ocpp1.6&apos;</span>,{" "}
            <span className="text-green-400">&apos;BootNotification&apos;</span>
            , {"{"}
          </div>
          <div className="pl-4">
            chargePointVendor: <span className="text-green-400">string</span>,
          </div>
          <div className="pl-4">
            chargePointModel: <span className="text-green-400">string</span>,
          </div>
          <div className="pl-2">{"})"}</div>
          <div>
            res.status{" "}
            <span className="text-gray-500">
              {"// 'Accepted' | 'Pending' | 'Rejected'"}
            </span>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Security Profiles 0–3",
    description:
      "Built-in support for all OCPP security profiles: plain WebSocket, Basic Auth, TLS + Basic Auth, and Mutual TLS with client certificates.",
    icon: Shield,
    className: "md:col-span-1",
    visual: (
      <div className="mt-4 flex flex-wrap gap-2">
        {["None", "Basic Auth", "TLS", "mTLS"].map((p, i) => (
          <span
            key={p}
            className={`text-[10px] border px-2 py-0.5 rounded-full ${
              i === 3
                ? "border-green-500/50 text-green-500 bg-green-500/5"
                : "border-fd-border text-fd-muted-foreground"
            }`}
          >
            <Lock className="h-2.5 w-2.5 inline mr-1" />
            {p}
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "High Performance",
    description:
      "WebSocket engine optimized for concurrent connections with configurable call concurrency, timeouts, and queue management.",
    icon: Zap,
    className: "md:col-span-1",
    visual: (
      <div className="mt-4 flex gap-1 items-end h-8">
        <div className="w-2 bg-fd-primary/30 h-3 rounded-t"></div>
        <div className="w-2 bg-fd-primary/50 h-5 rounded-t"></div>
        <div className="w-2 bg-fd-primary/70 h-4 rounded-t"></div>
        <div className="w-2 bg-fd-primary/80 h-7 rounded-t"></div>
        <div className="w-2 bg-fd-primary h-8 rounded-t animate-pulse"></div>
        <div className="text-[10px] text-muted-foreground ml-2 font-mono self-center">
          concurrent calls
        </div>
      </div>
    ),
  },
  {
    title: "Multi-Version Support",
    description:
      "Unified typed API for OCPP 1.6, 2.0.1, and 2.1. Register version-specific or generic handlers — the protocol context is always available.",
    icon: Globe,
    className: "md:col-span-2",
    visual: (
      <div className="absolute bottom-4 right-4 flex gap-2">
        <span className="text-xs border border-fd-border px-2.5 py-1 rounded-full bg-fd-secondary/50 text-fd-muted-foreground">
          v1.6
        </span>
        <span className="text-xs border border-fd-border px-2.5 py-1 rounded-full bg-fd-secondary/50 text-fd-muted-foreground">
          v2.0.1
        </span>
        <span className="text-xs border border-fd-primary/50 px-2.5 py-1 rounded-full bg-fd-primary/10 text-fd-primary">
          v2.1
        </span>
      </div>
    ),
  },
  {
    title: "Schema Validation",
    description:
      "Strict mode validates all inbound and outbound messages against official OCPP JSON schemas. Custom validators supported.",
    icon: CheckCircle2,
    className: "md:col-span-1",
    visual: (
      <div className="mt-4 text-[10px] font-mono space-y-1">
        <div className="flex items-center gap-1.5 text-green-500">
          <CheckCircle2 className="h-3 w-3" /> BootNotification
        </div>
        <div className="flex items-center gap-1.5 text-green-500">
          <CheckCircle2 className="h-3 w-3" /> Heartbeat
        </div>
        <div className="flex items-center gap-1.5 text-green-500">
          <CheckCircle2 className="h-3 w-3" /> StatusNotification
        </div>
      </div>
    ),
  },
  {
    title: "Framework Agnostic",
    description:
      "Use standalone, or attach to Express, Fastify, NestJS, or any HTTP server. Manual handleUpgrade available for full control.",
    icon: Server,
    className: "md:col-span-1",
    visual: (
      <div className="mt-4 flex gap-2 flex-wrap">
        {["Standalone", "Express", "Fastify", "NestJS"].map((fw) => (
          <span
            key={fw}
            className="text-[10px] border border-fd-border px-2 py-0.5 rounded bg-fd-secondary/50 text-fd-muted-foreground"
          >
            {fw}
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "Redis Clustering",
    description:
      "Optional Redis adapter for multi-instance deployments behind a load balancer. Works with both ioredis and node-redis.",
    icon: Layers,
    className: "md:col-span-1",
    visual: (
      <div className="mt-4 flex items-center gap-3">
        <div className="flex -space-x-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-6 w-6 rounded-full border-2 border-fd-card bg-fd-secondary flex items-center justify-center text-[8px] font-mono text-fd-muted-foreground"
            >
              {i}
            </div>
          ))}
        </div>
        <span className="text-[10px] text-fd-muted-foreground font-mono">
          → Redis
        </span>
      </div>
    ),
  },
  {
    title: "Browser Client",
    description:
      "Zero-dependency browser WebSocket client for building charge point simulators and testing dashboards. Same typed API, runs in React, Vue, or Next.js.",
    icon: MonitorSmartphone,
    className: "md:col-span-2 lg:col-span-2",
    visual: (
      <div className="absolute right-4 top-4 hidden lg:block w-64 opacity-50 group-hover:opacity-100 transition-opacity">
        <div className="rounded-md bg-secondary/50 p-3 text-[10px] font-mono leading-relaxed text-muted-foreground border border-border">
          <div>
            <span className="text-purple-400">import</span> {"{ "}
            <span className="text-yellow-400">BrowserOCPPClient</span>
            {" }"}
          </div>
          <div className="pl-2">
            <span className="text-purple-400">from</span>{" "}
            <span className="text-green-400">
              &apos;ocpp-ws-io/browser&apos;
            </span>
          </div>
          <div className="h-2" />
          <div className="text-gray-500">
            {"// Same API — works in browser"}
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Minimal Dependencies",
    description:
      "Lightweight architecture built on ws and cuid2. No heavy runtime dependencies — fast install, small bundle.",
    icon: Cpu,
    className: "md:col-span-1",
  },
];

export function Features() {
  return (
    <section className="container mx-auto px-4 py-24">
      <div className="mb-16">
        <h2 className="text-3xl font-bold tracking-tight text-fd-foreground sm:text-4xl">
          Core Features
        </h2>
        <p className="mt-4 text-lg text-fd-muted-foreground max-w-2xl">
          Built for reliability, correctness, and developer experience —
          everything you need for production OCPP infrastructure.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 auto-rows-fr">
        {features.map((feature, index) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.08 }}
            viewport={{ once: true }}
            className={`group relative overflow-hidden rounded-xl border border-fd-border bg-fd-card p-6 transition-all hover:border-fd-primary/50 hover:shadow-lg hover:shadow-fd-primary/5 ${
              feature.className || "md:col-span-1"
            }`}
          >
            <div className="flex flex-col h-full justify-between">
              <div>
                <div className="mb-4 inline-flex items-center justify-center rounded-lg border border-fd-border/50 bg-fd-secondary/50 p-2.5 text-fd-muted-foreground group-hover:text-fd-primary group-hover:bg-fd-primary/10 transition-colors">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-fd-foreground">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-fd-muted-foreground max-w-[85%]">
                  {feature.description}
                </p>
              </div>

              {feature.visual && (
                <div className="mt-4 pt-4 border-t border-fd-border/30">
                  {feature.visual}
                </div>
              )}
            </div>

            {/* Hover Gradient */}
            <div className="absolute inset-0 bg-linear-to-br from-fd-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
