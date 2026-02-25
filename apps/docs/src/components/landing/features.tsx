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

const features: {
  title: string;
  description: string;
  icon: typeof Code2;
  iconBg: string;
  iconColor: string;
}[] = [
  {
    title: "Type-Safe Everything",
    description:
      "End-to-end TypeScript support with auto-generated types for OCPP 1.6, 2.0.1, and 2.1. Request params and responses are fully inferred.",
    icon: Code2,
    iconBg: "bg-purple-100 dark:bg-purple-500/10",
    iconColor: "text-purple-600 dark:text-purple-400",
  },
  {
    title: "Security Profiles 0–3",
    description:
      "Built-in support for all OCPP security profiles: plain WebSocket, Basic Auth, TLS + Basic Auth, and Mutual TLS with client certificates.",
    icon: Shield,
    iconBg: "bg-rose-100 dark:bg-rose-500/10",
    iconColor: "text-rose-600 dark:text-rose-400",
  },
  {
    title: "High Performance",
    description:
      "WebSocket engine optimized for concurrent connections with configurable call concurrency, timeouts, and queue management.",
    icon: Zap,
    iconBg: "bg-amber-100 dark:bg-amber-500/10",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  {
    title: "Multi-Version Support",
    description:
      "Unified typed API for OCPP 1.6, 2.0.1, and 2.1. Register version-specific or generic handlers — the protocol context is always available.",
    icon: Globe,
    iconBg: "bg-blue-100 dark:bg-blue-500/10",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  {
    title: "Schema Validation",
    description:
      "Strict mode validates all inbound and outbound messages against official OCPP JSON schemas. Custom validators supported.",
    icon: CheckCircle2,
    iconBg: "bg-emerald-100 dark:bg-emerald-500/10",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  {
    title: "Framework Agnostic",
    description:
      "Use standalone, or attach to Express, Fastify, NestJS, or any Node.js HTTP server. Works with any deployment setup.",
    icon: Layers,
    iconBg: "bg-indigo-100 dark:bg-indigo-500/10",
    iconColor: "text-indigo-600 dark:text-indigo-400",
  },
  {
    title: "Redis Clustering",
    description:
      "Optional Redis adapter for multi-instance deployments behind a load balancer. Works with both ioredis and node-redis.",
    icon: Cpu,
    iconBg: "bg-teal-100 dark:bg-teal-500/10",
    iconColor: "text-teal-600 dark:text-teal-400",
  },
  {
    title: "Browser Client",
    description:
      "Zero-dependency browser WebSocket client for building charge point simulators and testing dashboards. Same typed API.",
    icon: MonitorSmartphone,
    iconBg: "bg-violet-100 dark:bg-violet-500/10",
    iconColor: "text-violet-600 dark:text-violet-400",
  },
  {
    title: "Minimal Dependencies",
    description:
      "Lightweight architecture built on ws and cuid2. No heavy runtime dependencies — fast install, small bundle.",
    icon: Cpu,
    iconBg: "bg-slate-100 dark:bg-slate-500/10",
    iconColor: "text-slate-600 dark:text-slate-400",
  },
];

export function Features() {
  return (
    <section className="container max-w-7xl mx-auto px-4 py-20">
      <div className="mb-16 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl font-bold tracking-tight text-fd-foreground sm:text-4xl mb-4"
        >
          Core Features
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-fd-muted-foreground text-lg max-w-2xl mx-auto"
        >
          Everything you need to build OCPP infrastructure — type-safe, tested,
          and open source.
        </motion.p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
        {features.map((feature, i) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.05 }}
            className="group relative flex flex-col gap-4 rounded-2xl border border-fd-border bg-fd-card p-7 transition-all duration-300 hover:shadow-lg hover:shadow-fd-primary/5 hover:-translate-y-0.5"
          >
            {/* Icon Badge */}
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-xl ${feature.iconBg}`}
            >
              <feature.icon className={`h-6 w-6 ${feature.iconColor}`} />
            </div>

            <h3 className="text-lg font-semibold text-fd-foreground">
              {feature.title}
            </h3>
            <p className="text-sm text-fd-muted-foreground leading-relaxed">
              {feature.description}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
