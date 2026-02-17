"use client";

import Link from "next/link";
import { Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-fd-border py-12 text-fd-muted-foreground">
      <div className="container mx-auto flex flex-col items-center justify-between gap-6 px-4 md:flex-row">
        <div className="flex flex-col items-center gap-2 md:items-start">
          <p className="text-sm font-medium text-fd-foreground">ocpp-ws-io</p>
          <p className="text-xs">
            © {new Date().getFullYear()} Rohit Tiwari. MIT License.
          </p>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <Link
            href="/docs"
            className="transition-colors hover:text-fd-foreground"
          >
            Documentation
          </Link>
          <Link
            href="/blog"
            className="transition-colors hover:text-fd-foreground"
          >
            Blog
          </Link>
          <Link
            href="https://www.npmjs.com/package/ocpp-ws-io"
            target="_blank"
            className="transition-colors hover:text-fd-foreground"
          >
            NPM
          </Link>
          <Link
            href="https://github.com/rohittiwari-dev/ocpp-ws-io"
            target="_blank"
            className="transition-colors hover:text-fd-foreground"
          >
            <Github className="h-4 w-4" />
            <span className="sr-only">GitHub</span>
          </Link>
        </div>
      </div>
    </footer>
  );
}
