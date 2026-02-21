import { BookOpen, Code, Shield } from "lucide-react";
import Link from "next/link";
import { BlogPostsList } from "@/components/blog/blog-posts-list";
import { Footer } from "@/components/landing/footer";
import type { Metadata } from "next";
import { blogSource } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Latest updates, guides, and deep dives into OCPP and EV charging infrastructure.",
  keywords: [
    "OCPP blog",
    "EV charging tutorial",
    "CSMS guides",
    "ocpp-ws-io updates",
    "Node.js OCPP",
  ],
  openGraph: {
    title: "Blog | OCPP WS IO",
    description:
      "Latest updates, guides, and deep dives into OCPP and EV charging infrastructure.",
    url: "https://ocpp-ws-io.rohittiwari.me/blog",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Blog | OCPP WS IO",
    description:
      "Latest updates, guides, and deep dives into OCPP and EV charging infrastructure.",
  },
};

export default function BlogPage() {
  const posts = [...blogSource.getPages()]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map((p) => ({
      url: p.url,
      title: p.title,
      description: p.description,
      date: p.date,
      image: p.image,
      tags: p.tags,
    }));

  return (
    <>
      <main className="container max-w-[1260px] mx-auto py-12 px-4 md:px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="mb-4 flex items-center gap-2 text-sm text-fd-muted-foreground">
            <Link
              href="/"
              className="hover:text-fd-foreground transition-colors"
            >
              ← Back to Home
            </Link>
          </div>
          <h1 className="mb-3 text-4xl font-bold text-fd-foreground">Blog</h1>
          <p className="mb-6 text-lg text-fd-muted-foreground">
            Latest updates, guides, and deep dives into OCPP and EV charging
            infrastructure.
          </p>

          {/* Navigation Pills */}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card/50 px-4 py-2 text-sm font-medium text-fd-muted-foreground transition-all hover:bg-fd-card hover:text-fd-foreground hover:shadow-sm"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Documentation
            </Link>
            <Link
              href="/docs/quick-start"
              className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card/50 px-4 py-2 text-sm font-medium text-fd-muted-foreground transition-all hover:bg-fd-card hover:text-fd-foreground hover:shadow-sm"
            >
              <Code className="h-3.5 w-3.5" />
              Quick Start
            </Link>
            <Link
              href="/docs/security"
              className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card/50 px-4 py-2 text-sm font-medium text-fd-muted-foreground transition-all hover:bg-fd-card hover:text-fd-foreground hover:shadow-sm"
            >
              <Shield className="h-3.5 w-3.5" />
              Security Guide
            </Link>
          </div>
        </div>

        {/* Interactive Search + Posts */}
        <BlogPostsList posts={posts} />
      </main>
      <Footer />
    </>
  );
}
