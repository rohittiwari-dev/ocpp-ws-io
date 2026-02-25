"use client";

import { motion } from "framer-motion";
import { Terminal, Wifi, Zap } from "lucide-react";
import { useEffect, useState } from "react";

// ─── Live Simulation Data ──────────────────────────────────────────
const logs = [
  { time: "00:01", type: "info", msg: "OCPP Server started on port 9220" },
  { time: "00:04", type: "info", msg: "Client connected: CP_12345" },
  {
    time: "00:05",
    type: "in",
    msg: ">> BootNotification ({ vendor: 'Tesla' })",
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

// ─── Code Showcase Data ────────────────────────────────────────────
type LineToken =
  | { text: string; cls: string; lightCls?: string }
  | { br: true };

const codeTabs: {
  id: string;
  label: string;
  filename: string;
  lines: LineToken[];
}[] = [
  {
    id: "client",
    label: "Client",
    filename: "client.ts",
    lines: [
      { text: "import", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      {
        text: " { OCPPClient } ",
        cls: "text-[#79c0ff]",
        lightCls: "text-[#1565c0]",
      },
      { text: "from ", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      {
        text: "'ocpp-ws-io'",
        cls: "text-[#a5d6ff]",
        lightCls: "text-[#0d47a1]",
      },
      { text: ";", cls: "", lightCls: "" },
      { br: true },
      { br: true },
      { text: "const ", cls: "text-[#79c0ff]", lightCls: "text-[#7b1fa2]" },
      { text: "client = ", cls: "", lightCls: "" },
      { text: "new ", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      { text: "OCPPClient", cls: "text-[#d2a8ff]", lightCls: "text-[#6a1b9a]" },
      { text: "({", cls: "", lightCls: "" },
      { br: true },
      { text: "  endpoint: ", cls: "", lightCls: "" },
      {
        text: "'ws://localhost:3000'",
        cls: "text-[#a5d6ff]",
        lightCls: "text-[#0d47a1]",
      },
      { text: ",", cls: "", lightCls: "" },
      { br: true },
      { text: "  identity: ", cls: "", lightCls: "" },
      { text: "'CP001'", cls: "text-[#a5d6ff]", lightCls: "text-[#0d47a1]" },
      { text: ",", cls: "", lightCls: "" },
      { br: true },
      { text: "  protocols: [", cls: "", lightCls: "" },
      { text: "'ocpp1.6'", cls: "text-[#a5d6ff]", lightCls: "text-[#0d47a1]" },
      { text: "],", cls: "", lightCls: "" },
      { br: true },
      { text: "});", cls: "", lightCls: "" },
      { br: true },
      { br: true },
      { text: "await ", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      { text: "client.", cls: "", lightCls: "" },
      { text: "connect", cls: "text-[#d2a8ff]", lightCls: "text-[#6a1b9a]" },
      { text: "();", cls: "", lightCls: "" },
    ],
  },
  {
    id: "server",
    label: "Server",
    filename: "server.ts",
    lines: [
      { text: "import", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      {
        text: " { OCPPServer } ",
        cls: "text-[#79c0ff]",
        lightCls: "text-[#1565c0]",
      },
      { text: "from ", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      {
        text: "'ocpp-ws-io'",
        cls: "text-[#a5d6ff]",
        lightCls: "text-[#0d47a1]",
      },
      { text: ";", cls: "", lightCls: "" },
      { br: true },
      { br: true },
      { text: "const ", cls: "text-[#79c0ff]", lightCls: "text-[#7b1fa2]" },
      { text: "server = ", cls: "", lightCls: "" },
      { text: "new ", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      { text: "OCPPServer", cls: "text-[#d2a8ff]", lightCls: "text-[#6a1b9a]" },
      { text: "({", cls: "", lightCls: "" },
      { br: true },
      { text: "  protocols: [", cls: "", lightCls: "" },
      { text: "'ocpp1.6'", cls: "text-[#a5d6ff]", lightCls: "text-[#0d47a1]" },
      { text: ", ", cls: "", lightCls: "" },
      {
        text: "'ocpp2.0.1'",
        cls: "text-[#a5d6ff]",
        lightCls: "text-[#0d47a1]",
      },
      { text: "],", cls: "", lightCls: "" },
      { br: true },
      { text: "});", cls: "", lightCls: "" },
      { br: true },
      { br: true },
      { text: "server.", cls: "", lightCls: "" },
      { text: "on", cls: "text-[#d2a8ff]", lightCls: "text-[#6a1b9a]" },
      { text: "(", cls: "", lightCls: "" },
      { text: "'client'", cls: "text-[#a5d6ff]", lightCls: "text-[#0d47a1]" },
      { text: ", (", cls: "", lightCls: "" },
      { text: "client", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      { text: ") => {", cls: "", lightCls: "" },
      { br: true },
      { text: "  client.", cls: "", lightCls: "" },
      { text: "handle", cls: "text-[#d2a8ff]", lightCls: "text-[#6a1b9a]" },
      { text: "(", cls: "", lightCls: "" },
      {
        text: "'BootNotification'",
        cls: "text-[#a5d6ff]",
        lightCls: "text-[#0d47a1]",
      },
      { text: ", ({ ", cls: "", lightCls: "" },
      { text: "params", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      { text: " }) => ({", cls: "", lightCls: "" },
      { br: true },
      { text: "    status: ", cls: "", lightCls: "" },
      { text: "'Accepted'", cls: "text-[#a5d6ff]", lightCls: "text-[#0d47a1]" },
      { text: ",", cls: "", lightCls: "" },
      { br: true },
      { text: "    interval: ", cls: "", lightCls: "" },
      { text: "300", cls: "text-[#79c0ff]", lightCls: "text-[#1565c0]" },
      { br: true },
      { text: "  }));", cls: "", lightCls: "" },
      { br: true },
      { text: "});", cls: "", lightCls: "" },
    ],
  },
  {
    id: "browser",
    label: "Browser",
    filename: "app.tsx",
    lines: [
      { text: "import", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      {
        text: " { BrowserOCPPClient } ",
        cls: "text-[#79c0ff]",
        lightCls: "text-[#1565c0]",
      },
      { br: true },
      { text: "  ", cls: "", lightCls: "" },
      { text: "from ", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      {
        text: "'ocpp-ws-io/browser'",
        cls: "text-[#a5d6ff]",
        lightCls: "text-[#0d47a1]",
      },
      { text: ";", cls: "", lightCls: "" },
      { br: true },
      { br: true },
      {
        text: "// Zero Node.js dependencies",
        cls: "text-[#8b949e]",
        lightCls: "text-[#6b7280]",
      },
      { br: true },
      { text: "const ", cls: "text-[#79c0ff]", lightCls: "text-[#7b1fa2]" },
      { text: "client = ", cls: "", lightCls: "" },
      { text: "new ", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      {
        text: "BrowserOCPPClient",
        cls: "text-[#d2a8ff]",
        lightCls: "text-[#6a1b9a]",
      },
      { text: "({", cls: "", lightCls: "" },
      { br: true },
      { text: "  endpoint: ", cls: "", lightCls: "" },
      {
        text: "'wss://csms.example.com'",
        cls: "text-[#a5d6ff]",
        lightCls: "text-[#0d47a1]",
      },
      { text: ",", cls: "", lightCls: "" },
      { br: true },
      { text: "  identity: ", cls: "", lightCls: "" },
      { text: "'CP001'", cls: "text-[#a5d6ff]", lightCls: "text-[#0d47a1]" },
      { text: ",", cls: "", lightCls: "" },
      { br: true },
      { text: "});", cls: "", lightCls: "" },
      { br: true },
      { br: true },
      { text: "await ", cls: "text-[#ff7b72]", lightCls: "text-[#d32f2f]" },
      { text: "client.", cls: "", lightCls: "" },
      { text: "connect", cls: "text-[#d2a8ff]", lightCls: "text-[#6a1b9a]" },
      { text: "();", cls: "", lightCls: "" },
    ],
  },
];

// ─── CodeLine Renderer ─────────────────────────────────────────────
function CodeLine({
  tokens,
  isDark,
}: {
  tokens: LineToken[];
  isDark: boolean;
}) {
  const elements: React.ReactNode[] = [];
  let currentLine: React.ReactNode[] = [];
  let lineIndex = 0;

  tokens.forEach((token, i) => {
    if ("br" in token) {
      elements.push(
        <div key={`line-${lineIndex}`}>
          {currentLine.length > 0 ? currentLine : "\u00A0"}
        </div>,
      );
      currentLine = [];
      lineIndex++;
    } else {
      const colorClass = isDark ? token.cls : token.lightCls || token.cls;
      currentLine.push(
        <span key={`${i}-${token.text}`} className={colorClass}>
          {token.text}
        </span>,
      );
    }
  });
  if (currentLine.length > 0) {
    elements.push(<div key={`line-${lineIndex}`}>{currentLine}</div>);
  }
  return <>{elements}</>;
}

// ─── Combined Showcase Component ───────────────────────────────────
export function Showcase() {
  const [activeLogIndex, setActiveLogIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("client");
  const [isDark, setIsDark] = useState(false);
  const activeCode = codeTabs.find((t) => t.id === activeTab);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveLogIndex((prev) => (prev + 1) % (logs.length + 4));
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Detect dark mode
  useEffect(() => {
    const checkDark = () =>
      setIsDark(document.documentElement.classList.contains("dark"));
    checkDark();
    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const currentStatus =
    activeLogIndex >= 6
      ? "Charging"
      : activeLogIndex >= 3
        ? "Available"
        : "Connecting";

  return (
    <section className="container max-w-7xl mx-auto px-4 py-20">
      {/* Section Header */}
      <div className="mb-14 text-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="inline-flex items-center rounded-full border border-fd-border bg-fd-card px-4 py-1.5 text-sm text-fd-muted-foreground mb-4 shadow-sm"
        >
          <span className="flex h-2 w-2 rounded-full bg-green-500 mr-2 animate-pulse" />
          Live Simulation
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.05 }}
          className="text-3xl font-bold tracking-tight text-fd-foreground sm:text-4xl mb-3"
        >
          See it in Action
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-fd-muted-foreground text-lg max-w-2xl mx-auto"
        >
          One typed API for Node.js clients, servers, and browser simulators.
        </motion.p>
      </div>

      {/* Two-Column Layout */}
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2 items-stretch">
        {/* Left: Live Terminal + Status */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="flex flex-col gap-4"
        >
          {/* Terminal */}
          <div className="flex-1 rounded-2xl border border-fd-border bg-gray-50 dark:bg-[#0d1117] p-5 shadow-lg font-mono text-sm flex flex-col min-h-[340px]">
            <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 pb-3 mb-3">
              <Terminal className="h-4 w-4 text-gray-400" />
              <span className="text-gray-500 dark:text-gray-400 text-xs">
                server-logs
              </span>
            </div>
            <div className="flex-1 overflow-hidden space-y-2.5">
              {logs.map((log, i) => (
                <motion.div
                  key={`${i}-${log.time}-${log.type}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{
                    opacity: i <= activeLogIndex ? 1 : 0.1,
                    x: i <= activeLogIndex ? 0 : -5,
                  }}
                  className={`flex gap-3 text-[13px] ${
                    log.type === "in"
                      ? "text-blue-600 dark:text-blue-400"
                      : log.type === "out"
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-400 dark:text-gray-500"
                  }`}
                >
                  <span className="opacity-50 select-none shrink-0">
                    [{log.time}]
                  </span>
                  <span>{log.msg}</span>
                </motion.div>
              ))}
              {activeLogIndex >= logs.length && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-gray-400 dark:text-gray-500 animate-pulse text-[13px]"
                >
                  Waiting for next heartbeat...
                </motion.div>
              )}
            </div>
          </div>

          {/* Status Card */}
          <div className="flex items-center justify-between rounded-2xl border border-fd-border bg-fd-card p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div
                className={`h-12 w-9 rounded-lg border-2 flex items-center justify-center shrink-0 ${
                  currentStatus === "Charging"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10"
                    : currentStatus === "Available"
                      ? "border-green-500 bg-green-50 dark:bg-green-500/10"
                      : "border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-500/10"
                }`}
              >
                <Zap
                  className={`h-5 w-5 ${
                    currentStatus === "Charging"
                      ? "text-blue-500 fill-blue-500"
                      : "text-current"
                  }`}
                />
              </div>
              <div>
                <div className="font-semibold text-fd-foreground text-sm">
                  CP_12345
                </div>
                <div className="text-xs text-fd-muted-foreground">
                  Charge Point
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 text-fd-muted-foreground">
              <div className="h-px w-8 bg-fd-border" />
              <Wifi className="h-5 w-5 text-fd-primary" />
              <div className="h-px w-8 bg-fd-border" />
            </div>

            <div className="flex items-center gap-3">
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  currentStatus === "Charging"
                    ? "bg-blue-500"
                    : currentStatus === "Available"
                      ? "bg-green-500"
                      : "bg-yellow-500"
                }`}
              />
              <span className="text-sm font-medium text-fd-foreground">
                {currentStatus}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Right: Code Tabs */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="overflow-hidden rounded-2xl border border-fd-border bg-gray-50 dark:bg-[#0d1117] shadow-lg flex flex-col min-h-[340px]"
        >
          {/* Tab Bar */}
          <div className="flex items-center border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-[#161b22]">
            {codeTabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-5 py-3 text-xs font-mono transition-colors ${
                  activeTab === tab.id
                    ? "text-fd-foreground bg-gray-50 dark:text-white dark:bg-[#0d1117]"
                    : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="showcaseTab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-fd-primary"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            ))}
            <div className="flex-1" />
            <span className="text-xs font-mono text-gray-400 dark:text-gray-500 px-4">
              {activeCode?.filename}
            </span>
          </div>

          {/* Code Content */}
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="p-6 font-mono text-[13px] leading-relaxed text-gray-800 dark:text-blue-100/90 flex-1"
          >
            <CodeLine
              tokens={activeCode?.lines as LineToken[]}
              isDark={isDark}
            />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
