"use client";

import { motion, useMotionValueEvent, useScroll } from "framer-motion";
import { Github, Terminal } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ThemeToggle } from "../layout/theme-toggle";

const NAV_LINKS = [
  { label: "Docs", href: "/docs" },
  { label: "Simulator", href: "https://ocpp.rohittiwari.me" },
  { label: "API", href: "/docs/api-reference" },
  { label: "Blog", href: "/blog" },
];

export function LandingHeader() {
  const { scrollY } = useScroll();
  const [isScrolled, setIsScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (latest) => {
    setIsScrolled(latest > 40);
  });

  return (
    <header
      className={`fixed top-0  z-50 transition-all duration-500 ${
        isScrolled ? "py-4" : "py-6"
      } pointer-events-none`}
    >
      <div className="container max-w-7xl mx-auto px-4 pointer-events-auto">
        <motion.div
          layout
          className={`flex items-center justify-between overflow-hidden transition-all duration-500 ${
            isScrolled
              ? "rounded-full border border-fd-border bg-fd-background backdrop-blur-xl shadow-xl px-6 py-3"
              : "rounded-2xl border-transparent bg-transparent px-2 py-2"
          }`}
        >
          {/* Left: Brand */}
          <Link href="/" className="flex items-center gap-2 group mr-auto">
            <Image
              src="/logo.svg"
              alt="ocpp-ws-io"
              width={26}
              height={26}
              className="transition-transform group-hover:scale-110"
            />
            <span className="font-bold tracking-tight text-fd-foreground hidden sm:block">
              ocpp-ws-io
            </span>
          </Link>

          {/* Center: Links (Desktop) */}
          <nav className="hidden md:flex items-center gap-1 mx-auto">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="px-4 py-2 text-sm font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground hover:bg-white/5 rounded-full"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right: Actions */}
          <div className="flex items-center gap-3 ml-auto">
            {/* GitHub Icon */}
            <Link
              href="https://github.com/rohittiwari-dev/ocpp-ws-io"
              target="_blank"
              className="hidden sm:flex h-9 w-9 items-center justify-center rounded-full border border-fd-border/50 text-fd-muted-foreground transition-colors hover:bg-white/5 hover:text-fd-foreground"
              aria-label="GitHub"
            >
              <Github className="h-4 w-4" />
            </Link>

            {/* Theme Toggle */}
            <div className="hidden sm:block border-l border-fd-border/50 pl-3">
              <ThemeToggle className="scale-90 shadow-sm transition-transform hover:scale-100" />
            </div>

            {/* Primary CTA */}
            <Link
              href="/docs"
              className="group relative inline-flex h-9 items-center justify-center gap-2 overflow-hidden rounded-full bg-fd-primary px-5 text-sm font-medium text-fd-primary-foreground shadow-md transition-all hover:bg-fd-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-fd-ring"
            >
              <Terminal className="h-4 w-4" />
              <span>Get Started</span>
              <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/20 to-transparent group-hover:animate-shimmer" />
            </Link>
          </div>
        </motion.div>
      </div>
    </header>
  );
}
