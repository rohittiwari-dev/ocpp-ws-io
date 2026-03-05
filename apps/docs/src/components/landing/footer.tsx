"use client";

import { Github, Twitter } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "../layout/theme-toggle";

const LINKS = [
  {
    title: "Product",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "API Reference", href: "/docs/api-reference" },
      {
        label: "Simulator",
        href: "https://ocpp.rohittiwari.me",
        external: true,
      },
      { label: "Blog", href: "/blog" },
    ],
  },
  {
    title: "Ecosystem",
    links: [
      { label: "Browser Client", href: "/docs/browser-client" },
      { label: "CLI Toolbox", href: "/docs/cli" },
      { label: "Redis Clustering", href: "/docs/clustering" },
      {
        label: "NPM Package",
        href: "https://www.npmjs.com/package/ocpp-ws-io",
        external: true,
      },
    ],
  },
  {
    title: "Connect",
    links: [
      {
        label: "GitHub",
        href: "https://github.com/rohittiwari-dev/ocpp-ws-io",
        external: true,
      },
      {
        label: "Twitter / X",
        href: "https://x.com/rohittiwari_dev",
        external: true,
      },
      { label: "Rohit Tiwari", href: "https://rohittiwari.me", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-fd-border bg-fd-card overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-full max-w-4xl bg-linear-to-r from-transparent via-violet-500/30 to-transparent" />
      <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-48 w-full max-w-2xl bg-violet-500/5 blur-3xl rounded-full" />

      <div className="container max-w-7xl mx-auto px-4 py-16 relative z-10">
        <div className="grid gap-12 lg:grid-cols-5">
          {/* Brand Column */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-2 group mb-6 w-fit">
              <Image
                src="/logo.svg"
                alt="ocpp-ws-io logo"
                width={32}
                height={32}
                className="transition-transform group-hover:scale-105"
              />
              <span className="text-xl font-bold tracking-tight text-fd-foreground">
                ocpp-ws-io
              </span>
            </Link>

            <p className="text-sm text-fd-muted-foreground leading-relaxed max-w-xs mb-8">
              Type-safe OCPP WebSocket RPC for Node.js. Build scalable CSMS and
              charging station infrastructure with zero headaches.
            </p>

            <div className="flex gap-4">
              <Link
                href="https://github.com/rohittiwari-dev/ocpp-ws-io"
                target="_blank"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-fd-border bg-fd-card text-fd-muted-foreground transition-colors hover:border-fd-primary hover:text-fd-primary hover:bg-fd-primary/5"
              >
                <Github className="h-4 w-4" />
                <span className="sr-only">GitHub</span>
              </Link>
              <Link
                href="https://x.com/rohittiwari_dev"
                target="_blank"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-fd-border bg-fd-card text-fd-muted-foreground transition-colors hover:border-[#1DA1F2] hover:text-[#1DA1F2] hover:bg-[#1DA1F2]/5"
              >
                <Twitter className="h-4 w-4" />
                <span className="sr-only">Twitter</span>
              </Link>
            </div>
          </div>

          {/* Nav Columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-3">
            {LINKS.map((col) => (
              <div key={col.title}>
                <h3 className="mb-5 text-sm font-semibold text-fd-foreground">
                  {col.title}
                </h3>
                <ul className="space-y-3.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        target={link.external ? "_blank" : undefined}
                        rel={link.external ? "noopener noreferrer" : undefined}
                        className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-primary"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-fd-border/50 pt-8 sm:flex-row">
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <p className="text-xs text-fd-muted-foreground">
              © {new Date().getFullYear()} Rohit Tiwari. Released under the MIT
              License.
            </p>
            <ThemeToggle className="scale-90" />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-fd-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            All systems operational
          </div>
        </div>
      </div>
    </footer>
  );
}
