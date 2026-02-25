"use client";

import { motion } from "framer-motion";
import { Terminal, Wifi, Zap } from "lucide-react";
import { useEffect, useState } from "react";

const logs = [
  { time: "00:01", type: "info", msg: "OCPP Server started on port 9220" },
  { time: "00:04", type: "info", msg: "Client connected: CP_12345" },
  {
    time: "00:05",
    type: "in",
    msg: ">> BootNotification ({ vendor: 'Tesla', model: 'v3' })",
  },
  {
    time: "00:06",
    type: "out",
    msg: "<< BootNotificationConf ({ status: 'Accepted' })",
  },
  { time: "01:30", type: "in", msg: ">> Heartbeat ()" },
  {
    time: "01:30",
    type: "out",
    msg: "<< HeartbeatConf ({ currentTime: '...' })",
  },
  {
    time: "01:35",
    type: "in",
    msg: ">> StatusNotification ({ status: 'Charging' })",
  },
];

export function VideoDemo() {
  const [activeLogIndex, setActiveLogIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveLogIndex((prev) => (prev + 1) % (logs.length + 4));
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const currentStatus =
    activeLogIndex >= 6
      ? "Charging"
      : activeLogIndex >= 3
        ? "Available"
        : "Connecting";

  return (
    <section className="container mx-auto px-4 py-16">
      <div className="mb-12 text-center">
        <div className="inline-flex items-center rounded-full border border-fd-border bg-fd-card px-4 py-1.5 text-sm text-fd-muted-foreground mb-4 shadow-sm">
          <span className="flex h-2 w-2 rounded-full bg-green-500 mr-2 animate-pulse" />
          Live Simulation
        </div>
        <h2 className="text-3xl font-bold text-fd-foreground sm:text-4xl">
          See it in Action
        </h2>
      </div>

      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2 items-center">
        {/* Left: Terminal Logs */}
        <div className="rounded-2xl border border-fd-border bg-[#0d1117] p-5 shadow-xl font-mono text-sm h-[400px] flex flex-col">
          <div className="flex items-center gap-2 border-b border-gray-800 pb-3 mb-3">
            <Terminal className="h-4 w-4 text-gray-400" />
            <span className="text-gray-400 text-xs">server-logs</span>
          </div>
          <div className="flex-1 overflow-hidden space-y-3">
            {logs.map((log, i) => (
              <motion.div
                key={`${i}-${log.time}-${log.type}-${log.msg}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{
                  opacity: i <= activeLogIndex ? 1 : 0.1,
                  x: i <= activeLogIndex ? 0 : -5,
                }}
                className={`flex gap-3 ${
                  log.type === "in"
                    ? "text-blue-400"
                    : log.type === "out"
                      ? "text-green-400"
                      : "text-gray-500"
                }`}
              >
                <span className="opacity-50 select-none">[{log.time}]</span>
                <span>{log.msg}</span>
              </motion.div>
            ))}
            {activeLogIndex >= logs.length && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-gray-500 animate-pulse"
              >
                Waiting for next heartbeat...
              </motion.div>
            )}
          </div>
        </div>

        {/* Right: Visual System State */}
        <div className="relative h-[400px] rounded-2xl border border-fd-border bg-fd-card p-8 flex flex-col items-center justify-center shadow-sm">
          {/* Connection Line */}
          <div className="absolute top-1/2 left-0 w-full h-px border-t border-dashed border-fd-border -z-10" />

          <div className="flex justify-between w-full max-w-sm items-center z-10">
            {/* Charger Node */}
            <div
              className={`flex flex-col items-center gap-4 transition-all duration-500 ${
                activeLogIndex >= 1
                  ? "opacity-100 scale-100"
                  : "opacity-50 scale-95"
              }`}
            >
              <div
                className={`h-24 w-16 rounded-xl border-2 flex items-center justify-center transition-colors duration-500 ${
                  currentStatus === "Charging"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10"
                    : activeLogIndex >= 3
                      ? "border-green-500 bg-green-50 dark:bg-green-500/10"
                      : "border-gray-300 bg-gray-50 dark:border-gray-500 dark:bg-gray-500/10"
                }`}
              >
                <Zap
                  className={`h-8 w-8 ${
                    currentStatus === "Charging"
                      ? "text-blue-500 fill-blue-500 animate-bounce"
                      : "text-current"
                  }`}
                />
              </div>
              <div className="text-center">
                <div className="font-bold text-fd-foreground">CP_12345</div>
                <div className="text-xs text-fd-muted-foreground">
                  Charge Point
                </div>
              </div>
            </div>

            {/* Data Flow Particles */}
            <div className="flex-1 h-12 relative overflow-hidden mx-4">
              {activeLogIndex >= 2 && activeLogIndex < logs.length && (
                <motion.div
                  key={activeLogIndex}
                  initial={{ x: "-100%", opacity: 0 }}
                  animate={{ x: "100%", opacity: 1 }}
                  transition={{ duration: 1 }}
                  className="absolute top-1/2 -translate-y-1/2 flex items-center gap-2"
                >
                  <div className="h-2 w-2 rounded-full bg-fd-primary shadow-[0_0_10px_currentColor]" />
                  <div className="text-[10px] bg-fd-primary/10 px-2 rounded text-fd-primary whitespace-nowrap">
                    JSON Payload
                  </div>
                </motion.div>
              )}
            </div>

            {/* Server Node */}
            <div className="flex flex-col items-center gap-4">
              <div className="h-24 w-24 rounded-full border-2 border-fd-primary/30 bg-fd-primary/5 flex items-center justify-center relative">
                <div className="absolute inset-0 rounded-full border border-fd-primary animate-ping opacity-20" />
                <Wifi className="h-8 w-8 text-fd-primary" />
              </div>
              <div className="text-center">
                <div className="font-bold text-fd-foreground">OCPP Server</div>
                <div className="text-xs text-fd-muted-foreground">Node.js</div>
              </div>
            </div>
          </div>

          {/* Status Badge */}
          <div className="absolute bottom-8 px-5 py-2.5 rounded-full bg-fd-secondary border border-fd-border flex items-center gap-2 shadow-sm">
            <div
              className={`h-2 w-2 rounded-full ${
                currentStatus === "Charging"
                  ? "bg-blue-500"
                  : currentStatus === "Available"
                    ? "bg-green-500"
                    : "bg-yellow-500"
              }`}
            />
            <span className="text-sm font-medium text-fd-foreground">
              Status: {currentStatus}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
