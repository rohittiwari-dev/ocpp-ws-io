"use client";

import { motion } from "framer-motion";
import {
  Shield,
  Zap,
  Code2,
  Globe,
  Cpu,
  Lock,
  CheckCircle2,
  Terminal as TerminalIcon,
} from "lucide-react";
import { ReactNode } from "react";

const features = [
  {
    title: "Type-Safe",
    description:
      "End-to-end TypeScript support with auto-generated types for every OCPP message.",
    icon: Code2,
    className: "md:col-span-2 lg:col-span-2",
    visual: (
      <div className="absolute right-4 top-4 hidden lg:block w-64 opacity-50 group-hover:opacity-100 transition-opacity">
        <div className="rounded-md bg-secondary/50 p-3 text-[10px] font-mono leading-relaxed text-muted-foreground border border-border">
          <div>
            <span className="text-purple-400">interface</span>{" "}
            <span className="text-yellow-400">BootNotification</span> {"{"}
          </div>
          <div className="pl-2">
            chargePointVendor: <span className="text-green-400">string</span>;
          </div>
          <div className="pl-2">
            chargePointModel: <span className="text-green-400">string</span>;
          </div>
          <div>{"}"}</div>
        </div>
      </div>
    ),
  },
  {
    title: "Security First",
    description: "Built-in CSMS security profiles 0-3 with TLS & mutual auth.",
    icon: Shield,
    className: "md:col-span-1",
    visual: (
      <div className="mt-4 flex items-center gap-2 text-xs font-mono text-green-500 bg-green-500/10 w-fit px-2 py-1 rounded">
        <Lock className="h-3 w-3" />
        TLS 1.3 Strict
      </div>
    ),
  },
  {
    title: "High Performance",
    description: "WebSocket engine optimized for 10k+ concurrent connections.",
    icon: Zap,
    className: "md:col-span-1",
    visual: (
      <div className="mt-4 flex gap-1 items-end h-8">
        <div className="w-2 bg-fd-primary/30 h-4 rounded-t"></div>
        <div className="w-2 bg-fd-primary/50 h-6 rounded-t"></div>
        <div className="w-2 bg-fd-primary/80 h-3 rounded-t"></div>
        <div className="w-2 bg-fd-primary h-8 rounded-t animate-pulse"></div>
        <div className="text-[10px] text-muted-foreground ml-2 font-mono self-center">
          {" "}
          &lt; 2ms latency
        </div>
      </div>
    ),
  },
  {
    title: "Protocol Agnostic",
    description: "Unified handler for OCPP 1.6, 2.0.1, and future specs.",
    icon: Globe,
    className: "md:col-span-2",
    visual: (
      <div className="absolute bottom-4 right-4 flex gap-2">
        <span className="text-xs border border-border px-2 py-1 rounded bg-secondary/50 text-muted-foreground">
          v1.6
        </span>
        <span className="text-xs border border-border px-2 py-1 rounded bg-secondary/50 text-muted-foreground">
          v2.0.1
        </span>
        <span className="text-xs border border-fd-primary/50 px-2 py-1 rounded bg-fd-primary/10 text-fd-primary">
          v2.1
        </span>
      </div>
    ),
  },
  {
    title: "Zero Dep",
    description: "Lightweight architecture with no heavy runtime dependencies.",
    icon: Cpu,
    className: "md:col-span-1",
  },
  {
    title: "Schema Validation",
    description: "Strict JSON schema validation for all incoming payloads.",
    icon: CheckCircle2,
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
        <p className="mt-4 text-lg text-fd-muted-foreground">
          Built for reliability, correctness, and developer experience.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 auto-rows-fr">
        {features.map((feature, index) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.1 }}
            viewport={{ once: true }}
            className={`group relative overflow-hidden rounded-lg border border-fd-border bg-fd-card p-6 transition-all hover:border-fd-primary/50 hover:shadow-lg ${feature.className || "md:col-span-1"}`}
          >
            <div className="flex flex-col h-full justify-between">
              <div>
                <div className="mb-4 inline-flex items-center justify-center rounded-md border border-fd-border/50 bg-fd-secondary/50 p-2 text-fd-muted-foreground group-hover:text-fd-primary group-hover:bg-fd-primary/10 transition-colors">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-fd-foreground">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-fd-muted-foreground max-w-[90%]">
                  {feature.description}
                </p>
              </div>

              {/* Micro-Visual Area */}
              {feature.visual && (
                <div className="mt-4 pt-4 border-t border-fd-border/30">
                  {feature.visual}
                </div>
              )}
            </div>

            {/* Hover Gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-fd-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
