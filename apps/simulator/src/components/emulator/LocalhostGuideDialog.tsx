"use client";

import { ArrowRight, Copy, ExternalLink, Globe, Terminal } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const STEPS = [
  {
    title: "Install Ngrok",
    command: "npm install -g ngrok",
    alt: "Or download from ngrok.com/download",
    description: "Install Ngrok globally on your machine.",
  },
  {
    title: "Start your CSMS server",
    command: "node server.js  # or your start command",
    description:
      "Make sure your local CSMS is running and listening on a port (e.g., 9000).",
  },
  {
    title: "Create a tunnel",
    command: "ngrok http 9000",
    description: "Ngrok will assign a public URL. Copy the Forwarding address.",
  },
  {
    title: "Use the wss:// URL here",
    command: "wss://a1b2c3d4.ngrok-free.app",
    description:
      "Paste the secure wss:// URL into the CSMS Endpoint field in the simulator.",
  },
] as const;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 p-1 rounded hover:bg-white/10 text-[#6b7898] hover:text-white transition-colors cursor-pointer"
      title="Copy"
    >
      <Copy className={`h-3 w-3 ${copied ? "text-emerald-400" : ""}`} />
    </button>
  );
}

export function LocalhostGuideDialog() {
  return (
    <Dialog>
      <DialogTrigger
        className="h-8 w-8 rounded-lg flex items-center justify-center bg-[#0f1117] border border-[#232636] text-[#4a5568] hover:text-[#a0a8b8] hover:border-[#2d3050] hover:bg-[#13151f] transition-all cursor-pointer shrink-0"
        title="Connect to localhost"
      >
        <Globe className="h-3.5 w-3.5" />
      </DialogTrigger>

      <DialogContent className="sm:max-w-md bg-[#13151f] border-[#232636] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-bold">
            <Globe className="h-4 w-4 text-[#8b5cf6]" />
            Connect to Localhost
          </DialogTitle>
          <DialogDescription className="text-[#6b7898] text-xs">
            Use a reverse proxy to expose your local CSMS server to this hosted
            simulator securely.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex gap-3 group">
              {/* Step number */}
              <div className="shrink-0 flex flex-col items-center">
                <div className="h-6 w-6 rounded-full bg-[#1e1535] border border-[#8b5cf6]/30 flex items-center justify-center text-[10px] font-bold text-[#c4b5fd]">
                  {i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 w-px bg-[#232636] my-1" />
                )}
              </div>

              {/* Step content */}
              <div className="flex-1 pb-3">
                <p className="text-[11px] font-semibold text-white mb-1">
                  {step.title}
                </p>
                <p className="text-[10px] text-[#6b7898] mb-1.5">
                  {step.description}
                </p>
                <div className="flex items-center gap-1.5 bg-[#0a0c14] border border-[#232636] rounded-md px-2.5 py-1.5">
                  <Terminal className="h-3 w-3 text-[#4a5568] shrink-0" />
                  <code className="flex-1 text-[10px] font-mono text-[#a78bfa] truncate">
                    {step.command}
                  </code>
                  <CopyButton text={step.command} />
                </div>
                {"alt" in step && step.alt && (
                  <p className="text-[9px] text-[#3d4459] mt-1 italic">
                    {step.alt}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Alternatives */}
        <div className="mt-1 p-3 rounded-lg bg-[#0f1117] border border-[#232636]">
          <p className="text-[10px] font-bold text-[#6b7898] uppercase tracking-wider mb-2">
            Alternatives
          </p>
          <div className="space-y-1.5">
            <a
              href="https://ngrok.com/download"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-[10px] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Ngrok — ngrok.com
              <ArrowRight className="h-2.5 w-2.5 ml-auto" />
            </a>
            <a
              href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-[10px] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Cloudflare Tunnel — cloudflare.com
              <ArrowRight className="h-2.5 w-2.5 ml-auto" />
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
