"use client";

import { motion } from "framer-motion";
import { ArrowRight, Github, Terminal, Copy, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export function Hero() {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText("npm install ocpp-ws-io");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative flex min-h-[90vh] flex-col justify-center overflow-hidden py-16">
      <div className="container relative z-10 grid gap-12 px-4 md:grid-cols-2 md:gap-8 lg:px-8 items-center">
        {/* Left Column: Text Content */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col text-left"
        >
          <div className="inline-flex w-fit items-center rounded-md border border-fd-primary/20 bg-fd-primary/10 px-3 py-1 text-xs font-mono text-fd-primary mb-8">
            v1.0.0 Stable
          </div>

          <h1 className="text-5xl font-bold tracking-tight text-fd-foreground sm:text-7xl mb-6">
            OCPP Connectivity <br />
            <span className="text-fd-primary">for Node.js</span>
          </h1>

          <p className="max-w-xl text-lg text-fd-muted-foreground mb-8 leading-relaxed">
            The type-safe, scalable foundation for your EV charging
            infrastructure. Supports OCPP 1.6 & 2.0.1.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <Link
              href="/docs"
              className="group inline-flex h-10 items-center justify-center gap-2 rounded-md bg-fd-primary px-6 text-sm font-medium text-fd-primary-foreground transition-all hover:bg-fd-primary/90"
            >
              Read the Docs
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="https://github.com/rohittiwari-dev/ocpp-ws-io"
              target="_blank"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-background px-6 text-sm font-medium transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
            >
              <Github className="h-4 w-4" />
              GitHub
            </Link>
          </div>

          {/* Quick Install */}
          <div className="flex items-center gap-3 w-fit rounded-md border border-fd-border bg-fd-secondary/50 px-4 py-2 font-mono text-sm text-fd-foreground">
            <span className="text-fd-muted-foreground">$</span>
            npm install ocpp-ws-io
            <button
              onClick={onCopy}
              className="ml-4 text-fd-muted-foreground hover:text-fd-foreground transition-colors"
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        </motion.div>

        {/* Right Column: Code Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, x: 20 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="relative flex items-center justify-center lg:justify-end"
        >
          <div className="relative w-full max-w-lg overflow-hidden rounded-lg border border-fd-border bg-[#0d1117] shadow-2xl">
            {/* Window Controls */}
            <div className="flex items-center gap-2 border-b border-fd-border/10 bg-[#161b22] px-4 py-3">
              <div className="flex gap-2">
                <div className="h-3 w-3 rounded-full bg-[#fa7970]" />
                <div className="h-3 w-3 rounded-full bg-[#faa356]" />
                <div className="h-3 w-3 rounded-full bg-[#7ce38b]" />
              </div>
              <div className="ml-4 text-xs font-mono text-fd-muted-foreground">
                server.ts
              </div>
            </div>

            {/* Code Content - Syntax Highlighting imitation */}
            <div className="p-6 font-mono text-sm leading-relaxed text-blue-100/90 overflow-x-auto">
              <div>
                <span className="text-[#ff7b72]">import</span> {"{ OCPP }"}{" "}
                <span className="text-[#ff7b72]">from</span>{" "}
                <span className="text-[#a5d6ff]">'ocpp-ws-io'</span>;
              </div>
              <div className="h-4" />
              <div>
                <span className="text-[#79c0ff]">const</span> server ={" "}
                <span className="text-[#ff7b72]">new</span>{" "}
                <span className="text-[#d2a8ff]">OCPP</span>();
              </div>
              <div className="h-4" />
              <div>
                <span className="text-[#8b949e]">
                  // Listen for connections
                </span>
              </div>
              <div>
                server.<span className="text-[#d2a8ff]">on</span>(
                <span className="text-[#a5d6ff]">'BootNotification'</span>, (
                <span className="text-[#ff7b72]">client</span>,{" "}
                <span className="text-[#ff7b72]">request</span>) ={">"} {"{"}
              </div>
              <div className="pl-4">
                <span className="text-[#ff7b72]">return</span> {"{"}
              </div>
              <div className="pl-8">
                <span className="text-[#79c0ff]">status</span>:{" "}
                <span className="text-[#a5d6ff]">'Accepted'</span>,
              </div>
              <div className="pl-8">
                <span className="text-[#79c0ff]">currentTime</span>:{" "}
                <span className="text-[#ff7b72]">new</span>{" "}
                <span className="text-[#d2a8ff]">Date</span>().
                <span className="text-[#d2a8ff]">toISOString</span>(),
              </div>
              <div className="pl-8">
                <span className="text-[#79c0ff]">interval</span>:{" "}
                <span className="text-[#79c0ff]">300</span>
              </div>
              <div className="pl-4">{"}"};</div>
              <div>{"}"});</div>
              <div className="h-4" />
              <div>
                server.<span className="text-[#d2a8ff]">listen</span>(
                <span className="text-[#79c0ff]">9220</span>);
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
