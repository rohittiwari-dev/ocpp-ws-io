"use client";

import { motion } from "framer-motion";

const stats = [
  { value: "3", label: "OCPP Versions", sub: "1.6 · 2.0.1 · 2.1" },
  { value: "100%", label: "TypeScript", sub: "Auto-generated types" },
  { value: "4+", label: "Log Transports", sub: "Console, File, Redis, HTTP" },
  { value: "0-3", label: "Security Profiles", sub: "NONE, WS, TLS, mTLS" },
  { value: "Logging", label: "Built in Library", sub: "Voltlog-io" },
];

export function Stats() {
  return (
    <section className="container max-w-7xl mx-auto  px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="mx-auto max-w-6xl rounded-2xl border border-fd-border bg-fd-card p-8 shadow-sm"
      >
        <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="flex flex-col items-center text-center"
            >
              <span className="text-4xl font-bold bg-linear-to-br from-fd-primary to-purple-400 bg-clip-text text-transparent">
                {stat.value}
              </span>
              <span className="mt-1 text-sm font-semibold text-fd-foreground">
                {stat.label}
              </span>
              <span className="mt-0.5 text-xs text-fd-muted-foreground">
                {stat.sub}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
