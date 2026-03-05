"use client";

import { motion, useInView, useMotionValue, useSpring } from "framer-motion";
import { useEffect, useRef } from "react";

const STATS = [
  {
    value: 3,
    suffix: "",
    label: "OCPP Versions",
    sub: "1.6 · 2.0.1 · 2.1",
    accent: "#7c3aed",
    glow: "rgba(124,58,237,0.2)",
  },
  {
    value: 100,
    suffix: "%",
    label: "TypeScript",
    sub: "Auto-generated types",
    accent: "#3b82f6",
    glow: "rgba(59,130,246,0.2)",
  },
  {
    value: 4,
    suffix: "",
    label: "Security Profiles",
    sub: "NONE · WS · TLS · mTLS",
    accent: "#f43f5e",
    glow: "rgba(244,63,94,0.2)",
  },
  {
    value: 0,
    suffix: "",
    label: "Browser Deps",
    sub: "Zero runtime dependencies",
    accent: "#10b981",
    glow: "rgba(16,185,129,0.2)",
  },
  {
    value: 4,
    suffix: "+",
    label: "Log Transports",
    sub: "Console · File · Redis · HTTP",
    accent: "#f59e0b",
    glow: "rgba(245,158,11,0.2)",
  },
] as const;

function Counter({
  value,
  suffix,
  accent,
}: {
  value: number;
  suffix: string;
  accent: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { stiffness: 80, damping: 18 });

  useEffect(() => {
    if (inView) motionVal.set(value);
  }, [inView, value, motionVal]);

  useEffect(() => {
    return spring.on("change", (v) => {
      if (ref.current) {
        ref.current.textContent = `${Math.round(v)}${suffix}`;
      }
    });
  }, [spring, suffix]);

  return (
    <span ref={ref} style={{ color: accent }} className="tabular-nums">
      0{suffix}
    </span>
  );
}

export function Stats() {
  return (
    <section className="container max-w-7xl mx-auto px-4 py-14">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.55 }}
        className="relative overflow-hidden rounded-2xl border border-fd-border bg-fd-card/60 backdrop-blur-sm"
      >
        {/* Top shimmer line */}
        <div
          className="absolute top-0 inset-x-0 h-px"
          style={{
            background:
              "linear-gradient(to right, transparent, #7c3aed60, #3b82f660, #10b98160, transparent)",
          }}
        />

        {/* Grid */}
        <div className="grid grid-cols-2 divide-x divide-y divide-fd-border md:grid-cols-5 md:divide-y-0">
          {STATS.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.45 }}
              className="group relative flex flex-col items-center justify-center gap-1 px-6 py-8 text-center transition-all duration-300"
              whileHover={{ backgroundColor: `${s.accent}06` }}
            >
              {/* Top accent bar per cell */}
              <div
                className="absolute top-0 inset-x-0 h-[2px] scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-center"
                style={{ background: s.accent }}
              />

              {/* Glow dot */}
              <div
                className="absolute h-24 w-24 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: s.glow }}
              />

              {/* Value */}
              <span className="relative text-4xl font-extrabold tracking-tight lg:text-5xl">
                <Counter value={s.value} suffix={s.suffix} accent={s.accent} />
              </span>

              {/* Label */}
              <span className="relative text-sm font-semibold text-fd-foreground">
                {s.label}
              </span>

              {/* Sub */}
              <span className="relative text-[11px] text-fd-muted-foreground leading-tight max-w-[120px]">
                {s.sub}
              </span>
            </motion.div>
          ))}
        </div>

        {/* Bottom shimmer line */}
        <div
          className="absolute bottom-0 inset-x-0 h-px"
          style={{
            background:
              "linear-gradient(to right, transparent, #7c3aed30, #3b82f630, transparent)",
          }}
        />
      </motion.div>
    </section>
  );
}
