"use client";

import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Check, Copy, Github } from "lucide-react";
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
    <section className="relative flex min-h-[90vh] flex-col justify-center overflow-hidden py-16 lg:py-24">
      {/* Decorative Background Shapes (light mode only, hidden in dark) */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden dark:hidden"
        aria-hidden
      >
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-purple-100/60 blur-3xl" />
        <div className="absolute top-1/4 -right-24 h-72 w-72 rounded-full bg-blue-100/50 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-rose-100/40 blur-3xl" />
      </div>

      <div className="container max-w-7xl mx-auto relative z-10 grid gap-12 px-4 md:grid-cols-2 md:gap-8 lg:gap-16 lg:px-8 items-center">
        {/* Left Column: Text Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex flex-col text-left"
        >
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-fd-primary/20 bg-fd-primary/5 px-4 py-1.5 text-xs font-medium text-fd-primary mb-8">
            <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            v2.1.5 — OCPP 1.6 · 2.0.1 · 2.1
          </div>

          <h1 className="text-5xl font-bold tracking-tight text-fd-foreground sm:text-6xl lg:text-7xl mb-6 leading-[1.1]">
            OCPP Connectivity <br />
            <span className="bg-linear-to-r from-fd-primary to-purple-400 bg-clip-text text-transparent">
              for Node.js
            </span>
          </h1>

          <p className="max-w-lg text-lg text-fd-muted-foreground mb-10 leading-relaxed">
            Type-safe OCPP WebSocket RPC library for Node.js and the browser.
            Build EV charging infrastructure with security profiles, schema
            validation, Redis clustering, and auto-generated TypeScript types.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-8">
            <Link
              href="/docs"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-fd-foreground px-7 text-sm font-semibold text-fd-background transition-all hover:opacity-90 shadow-lg shadow-fd-foreground/10"
            >
              <BookOpen className="h-4 w-4" />
              Get Started
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/docs/api-reference"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-fd-border bg-fd-card px-7 text-sm font-medium transition-all hover:bg-fd-accent hover:text-fd-accent-foreground shadow-sm"
            >
              API Reference
            </Link>
            <Link
              href="https://github.com/rohittiwari-dev/ocpp-ws-io"
              target="_blank"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-fd-border bg-fd-card px-7 text-sm font-medium transition-all hover:bg-fd-accent hover:text-fd-accent-foreground shadow-sm"
            >
              <Github className="h-4 w-4" />
              GitHub
            </Link>
          </div>

          {/* Quick Install */}
          <div className="flex items-center gap-3 w-fit rounded-xl border border-fd-border bg-fd-card px-5 py-3 font-mono text-sm text-fd-foreground shadow-sm">
            <span className="text-fd-muted-foreground select-none">$</span>
            <span>npm install ocpp-ws-io</span>
            <button
              type="button"
              onClick={onCopy}
              className="ml-4 text-fd-muted-foreground hover:text-fd-foreground transition-colors"
              aria-label="Copy install command"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        </motion.div>

        {/* Right Column: Code Window — floated card with shadow */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="relative flex items-center justify-center lg:justify-end"
        >
          {/* Decorative glow behind code card */}
          <div className="absolute -inset-4 rounded-3xl bg-linear-to-br from-fd-primary/10 via-transparent to-blue-500/10 blur-2xl dark:from-fd-primary/20 dark:to-blue-500/20" />

          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-fd-border bg-gray-50 dark:bg-[#0d1117] shadow-2xl shadow-black/10 dark:shadow-fd-primary/5">
            {/* Window Controls */}
            <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-[#161b22] px-4 py-3">
              <div className="flex gap-2">
                <div className="h-3 w-3 rounded-full bg-[#fa7970]" />
                <div className="h-3 w-3 rounded-full bg-[#faa356]" />
                <div className="h-3 w-3 rounded-full bg-[#7ce38b]" />
              </div>
              <div className="ml-4 text-xs font-mono text-gray-500 dark:text-gray-400">
                server.ts
              </div>
            </div>

            {/* Code Content */}
            <div className="p-6 font-mono text-[13px] leading-relaxed text-gray-800 dark:text-blue-100/90 overflow-x-auto">
              <div>
                <span className="text-[#d32f2f] dark:text-[#ff7b72]">
                  import
                </span>{" "}
                {"{ "}
                <span className="text-[#1565c0] dark:text-[#79c0ff]">
                  OCPPServer
                </span>
                {" }"}{" "}
                <span className="text-[#d32f2f] dark:text-[#ff7b72]">from</span>{" "}
                <span className="text-[#0d47a1] dark:text-[#a5d6ff]">
                  &apos;ocpp-ws-io&apos;
                </span>
              </div>
              <div className="h-4" />
              <div>
                <span className="text-[#7b1fa2] dark:text-[#79c0ff]">
                  const
                </span>{" "}
                server ={" "}
                <span className="text-[#d32f2f] dark:text-[#ff7b72]">new</span>{" "}
                <span className="text-[#6a1b9a] dark:text-[#d2a8ff]">
                  OCPPServer
                </span>
                ({"{"}{" "}
              </div>
              <div className="pl-4">
                <span className="text-[#7b1fa2] dark:text-[#79c0ff]">
                  protocols
                </span>
                : [
                <span className="text-[#0d47a1] dark:text-[#a5d6ff]">
                  &apos;ocpp1.6&apos;
                </span>
                ,{" "}
                <span className="text-[#0d47a1] dark:text-[#a5d6ff]">
                  &apos;ocpp2.0.1&apos;
                </span>
                ]
              </div>
              <div>{"}"});</div>
              <div className="h-4" />
              <div>
                <span className="text-[#6b7280] dark:text-[#8b949e]">
                  {"// Version-aware, fully typed"}
                </span>
              </div>
              <div>
                server.
                <span className="text-[#6a1b9a] dark:text-[#d2a8ff]">on</span>(
                <span className="text-[#0d47a1] dark:text-[#a5d6ff]">
                  &apos;client&apos;
                </span>
                , (
                <span className="text-[#d32f2f] dark:text-[#ff7b72]">
                  client
                </span>
                ) =&gt; {"{"}
              </div>
              <div className="pl-4">
                client.
                <span className="text-[#6a1b9a] dark:text-[#d2a8ff]">
                  handle
                </span>
                (
                <span className="text-[#0d47a1] dark:text-[#a5d6ff]">
                  &apos;BootNotification&apos;
                </span>
                , ({"{ "}
                <span className="text-[#d32f2f] dark:text-[#ff7b72]">
                  params
                </span>
                {" }"}) =&gt; {"{"}
              </div>
              <div className="pl-8">
                <span className="text-[#d32f2f] dark:text-[#ff7b72]">
                  return
                </span>{" "}
                {"{"}
              </div>
              <div className="pl-12">
                <span className="text-[#7b1fa2] dark:text-[#79c0ff]">
                  status
                </span>
                :{" "}
                <span className="text-[#0d47a1] dark:text-[#a5d6ff]">
                  &apos;Accepted&apos;
                </span>
                ,
              </div>
              <div className="pl-12">
                <span className="text-[#7b1fa2] dark:text-[#79c0ff]">
                  currentTime
                </span>
                :{" "}
                <span className="text-[#d32f2f] dark:text-[#ff7b72]">new</span>{" "}
                <span className="text-[#6a1b9a] dark:text-[#d2a8ff]">Date</span>
                ().
                <span className="text-[#6a1b9a] dark:text-[#d2a8ff]">
                  toISOString
                </span>
                (),
              </div>
              <div className="pl-12">
                <span className="text-[#7b1fa2] dark:text-[#79c0ff]">
                  interval
                </span>
                :{" "}
                <span className="text-[#1565c0] dark:text-[#79c0ff]">300</span>
              </div>
              <div className="pl-8">{"}"}</div>
              <div className="pl-4">{"}"}</div>
              <div>{"})"};</div>
              <div className="h-4" />
              <div>
                <span className="text-[#d32f2f] dark:text-[#ff7b72]">
                  await
                </span>{" "}
                server.
                <span className="text-[#6a1b9a] dark:text-[#d2a8ff]">
                  listen
                </span>
                (
                <span className="text-[#1565c0] dark:text-[#79c0ff]">3000</span>
                );
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
