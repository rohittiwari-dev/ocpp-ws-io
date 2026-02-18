"use client";

import { motion } from "framer-motion";
import { useState } from "react";

const tabs = [
  {
    id: "client",
    label: "Client",
    filename: "client.ts",
    lines: [
      { text: "import", cls: "text-[#ff7b72]" },
      { text: " { OCPPClient } ", cls: "text-[#79c0ff]" },
      { text: "from ", cls: "text-[#ff7b72]" },
      { text: "'ocpp-ws-io'", cls: "text-[#a5d6ff]" },
      { text: ";", cls: "" },
      { br: true },
      { br: true },
      { text: "const ", cls: "text-[#79c0ff]" },
      { text: "client = ", cls: "" },
      { text: "new ", cls: "text-[#ff7b72]" },
      { text: "OCPPClient", cls: "text-[#d2a8ff]" },
      { text: "({", cls: "" },
      { br: true },
      { text: "  endpoint: ", cls: "" },
      { text: "'ws://localhost:3000'", cls: "text-[#a5d6ff]" },
      { text: ",", cls: "" },
      { br: true },
      { text: "  identity: ", cls: "" },
      { text: "'CP001'", cls: "text-[#a5d6ff]" },
      { text: ",", cls: "" },
      { br: true },
      { text: "  protocols: [", cls: "" },
      { text: "'ocpp1.6'", cls: "text-[#a5d6ff]" },
      { text: "],", cls: "" },
      { br: true },
      { text: "});", cls: "" },
      { br: true },
      { br: true },
      { text: "await ", cls: "text-[#ff7b72]" },
      { text: "client.", cls: "" },
      { text: "connect", cls: "text-[#d2a8ff]" },
      { text: "();", cls: "" },
      { br: true },
      { br: true },
      { text: "// Version-aware, fully typed call", cls: "text-[#8b949e]" },
      { br: true },
      { text: "const ", cls: "text-[#79c0ff]" },
      { text: "res = ", cls: "" },
      { text: "await ", cls: "text-[#ff7b72]" },
      { text: "client.", cls: "" },
      { text: "call", cls: "text-[#d2a8ff]" },
      { text: "(", cls: "" },
      { text: "'ocpp1.6'", cls: "text-[#a5d6ff]" },
      { text: ", ", cls: "" },
      { text: "'BootNotification'", cls: "text-[#a5d6ff]" },
      { text: ", {", cls: "" },
      { br: true },
      { text: "  chargePointVendor: ", cls: "" },
      { text: "'VendorX'", cls: "text-[#a5d6ff]" },
      { text: ",", cls: "" },
      { br: true },
      { text: "  chargePointModel: ", cls: "" },
      { text: "'ModelY'", cls: "text-[#a5d6ff]" },
      { text: ",", cls: "" },
      { br: true },
      { text: "});", cls: "" },
    ],
  },
  {
    id: "server",
    label: "Server",
    filename: "server.ts",
    lines: [
      { text: "import", cls: "text-[#ff7b72]" },
      { text: " { OCPPServer } ", cls: "text-[#79c0ff]" },
      { text: "from ", cls: "text-[#ff7b72]" },
      { text: "'ocpp-ws-io'", cls: "text-[#a5d6ff]" },
      { text: ";", cls: "" },
      { br: true },
      { br: true },
      { text: "const ", cls: "text-[#79c0ff]" },
      { text: "server = ", cls: "" },
      { text: "new ", cls: "text-[#ff7b72]" },
      { text: "OCPPServer", cls: "text-[#d2a8ff]" },
      { text: "({", cls: "" },
      { br: true },
      { text: "  protocols: [", cls: "" },
      { text: "'ocpp1.6'", cls: "text-[#a5d6ff]" },
      { text: ", ", cls: "" },
      { text: "'ocpp2.0.1'", cls: "text-[#a5d6ff]" },
      { text: "],", cls: "" },
      { br: true },
      { text: "});", cls: "" },
      { br: true },
      { br: true },
      { text: "server.", cls: "" },
      { text: "on", cls: "text-[#d2a8ff]" },
      { text: "(", cls: "" },
      { text: "'client'", cls: "text-[#a5d6ff]" },
      { text: ", (", cls: "" },
      { text: "client", cls: "text-[#ff7b72]" },
      { text: ") => {", cls: "" },
      { br: true },
      { text: "  client.", cls: "" },
      { text: "handle", cls: "text-[#d2a8ff]" },
      { text: "(", cls: "" },
      { text: "'BootNotification'", cls: "text-[#a5d6ff]" },
      { text: ", ({ ", cls: "" },
      { text: "params", cls: "text-[#ff7b72]" },
      { text: " }) => ({", cls: "" },
      { br: true },
      { text: "    status: ", cls: "" },
      { text: "'Accepted'", cls: "text-[#a5d6ff]" },
      { text: ",", cls: "" },
      { br: true },
      { text: "    currentTime: ", cls: "" },
      { text: "new ", cls: "text-[#ff7b72]" },
      { text: "Date", cls: "text-[#d2a8ff]" },
      { text: "().", cls: "" },
      { text: "toISOString", cls: "text-[#d2a8ff]" },
      { text: "(),", cls: "" },
      { br: true },
      { text: "    interval: ", cls: "" },
      { text: "300", cls: "text-[#79c0ff]" },
      { br: true },
      { text: "  }));", cls: "" },
      { br: true },
      { text: "});", cls: "" },
      { br: true },
      { br: true },
      { text: "await ", cls: "text-[#ff7b72]" },
      { text: "server.", cls: "" },
      { text: "listen", cls: "text-[#d2a8ff]" },
      { text: "(", cls: "" },
      { text: "3000", cls: "text-[#79c0ff]" },
      { text: ");", cls: "" },
    ],
  },
  {
    id: "browser",
    label: "Browser",
    filename: "app.tsx",
    lines: [
      { text: "import", cls: "text-[#ff7b72]" },
      { text: " { BrowserOCPPClient } ", cls: "text-[#79c0ff]" },
      { br: true },
      { text: "  ", cls: "" },
      { text: "from ", cls: "text-[#ff7b72]" },
      { text: "'ocpp-ws-io/browser'", cls: "text-[#a5d6ff]" },
      { text: ";", cls: "" },
      { br: true },
      { br: true },
      { text: "// Zero Node.js dependencies", cls: "text-[#8b949e]" },
      { br: true },
      { text: "const ", cls: "text-[#79c0ff]" },
      { text: "client = ", cls: "" },
      { text: "new ", cls: "text-[#ff7b72]" },
      { text: "BrowserOCPPClient", cls: "text-[#d2a8ff]" },
      { text: "({", cls: "" },
      { br: true },
      { text: "  endpoint: ", cls: "" },
      { text: "'wss://csms.example.com'", cls: "text-[#a5d6ff]" },
      { text: ",", cls: "" },
      { br: true },
      { text: "  identity: ", cls: "" },
      { text: "'CP001'", cls: "text-[#a5d6ff]" },
      { text: ",", cls: "" },
      { br: true },
      { text: "  protocols: [", cls: "" },
      { text: "'ocpp1.6'", cls: "text-[#a5d6ff]" },
      { text: "],", cls: "" },
      { br: true },
      { text: "});", cls: "" },
      { br: true },
      { br: true },
      { text: "// Same typed API as OCPPClient", cls: "text-[#8b949e]" },
      { br: true },
      { text: "await ", cls: "text-[#ff7b72]" },
      { text: "client.", cls: "" },
      { text: "connect", cls: "text-[#d2a8ff]" },
      { text: "();", cls: "" },
      { br: true },
      { text: "const ", cls: "text-[#79c0ff]" },
      { text: "res = ", cls: "" },
      { text: "await ", cls: "text-[#ff7b72]" },
      { text: "client.", cls: "" },
      { text: "call", cls: "text-[#d2a8ff]" },
      { text: "(", cls: "" },
      { text: "'BootNotification'", cls: "text-[#a5d6ff]" },
      { text: ", {", cls: "" },
      { br: true },
      { text: "  chargePointVendor: ", cls: "" },
      { text: "'TestCP'", cls: "text-[#a5d6ff]" },
      { text: ",", cls: "" },
      { br: true },
      { text: "  chargePointModel: ", cls: "" },
      { text: "'Sim'", cls: "text-[#a5d6ff]" },
      { br: true },
      { text: "});", cls: "" },
    ],
  },
];

type LineToken = { text: string; cls: string } | { br: true };

function CodeLine({ tokens }: { tokens: LineToken[] }) {
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
      currentLine.push(
        <span key={i} className={token.cls}>
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

export function CodeShowcase() {
  const [activeTab, setActiveTab] = useState("client");
  const activeCode = tabs.find((t) => t.id === activeTab)!;

  return (
    <section className="container mx-auto px-4 py-24 border-t border-fd-border/50">
      <div className="mb-12 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-fd-foreground sm:text-4xl">
          One API, Three Environments
        </h2>
        <p className="mt-4 text-lg text-fd-muted-foreground max-w-2xl mx-auto">
          Write type-safe OCPP code for Node.js clients, servers, or
          browser-based charge point simulators — all with the same familiar
          API.
        </p>
      </div>

      <div className="mx-auto max-w-2xl">
        <motion.div
          layout
          className="overflow-hidden rounded-xl border border-fd-border bg-[#0d1117] shadow-2xl"
        >
          {/* Tab Bar */}
          <div className="flex items-center border-b border-gray-800 bg-[#161b22]">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-5 py-3 text-xs font-mono transition-colors ${
                  activeTab === tab.id
                    ? "text-white bg-[#0d1117]"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-fd-primary"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            ))}
            <div className="flex-1" />
            <span className="text-xs font-mono text-gray-500 px-4">
              {activeCode.filename}
            </span>
          </div>

          {/* Code Content */}
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="p-6 font-mono text-[13px] leading-relaxed text-blue-100/90"
          >
            <CodeLine tokens={activeCode.lines as LineToken[]} />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
