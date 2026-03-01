import type { Metadata } from "next";
import Link from "next/link";
import { Features } from "@/components/landing/features";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { Showcase } from "@/components/landing/showcase";
import { Stats } from "@/components/landing/stats";
import { blogSource } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Type-Safe OCPP WebSocket Library for Node.js",
  description:
    "Build scalable CSMS and Charging Stations with ocpp-ws-io. Supports OCPP 1.6, 2.0.1, 2.1, strict validation, and clustering.",
  keywords: [
    "OCPP",
    "WebSocket",
    "RPC",
    "CSMS",
    "Charging Station",
    "Ev Charging",
    "Node.js",
    "TypeScript",
  ],
  openGraph: {
    title: "OCPP WS IO — Type-Safe OCPP WebSocket Library",
    description:
      "Build scalable CSMS and Charging Stations with ocpp-ws-io. Type-safe OCPP WebSocket library for Node.js.",
    url: "https://ocpp-ws-io.rohittiwari.me",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "OCPP WS IO",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OCPP WS IO — Type-Safe OCPP WebSocket Library",
    description: "Type-safe OCPP WebSocket RPC client & server for Node.js",
    images: ["/og.png"],
  },
  alternates: {
    canonical: "./",
  },
};

export default function HomePage() {
  const posts = [...blogSource.getPages()]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    url: "https://ocpp-ws-io.rohittiwari.me",
    name: "OCPP WS IO",
    description:
      "Type-safe OCPP WebSocket RPC client & server for Node.js. Supports OCPP 1.6, 2.0.1, 2.1.",
    publisher: {
      "@type": "Person",
      name: "Rohit Tiwari",
      url: "https://rohittiwari.me",
    },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate:
          "https://ocpp-ws-io.rohittiwari.me/docs?search={search_term_string}",
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <div className="flex flex-col min-h-screen w-full">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: safe as we control the content
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Hero />
      <Stats />
      <Showcase />
      <Features />

      {/* Blog Section */}
      <section className="container max-w-7xl mx-auto px-4 py-18 border-t border-fd-border/50">
        <div className="mb-12 flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-3xl font-bold tracking-tight text-fd-foreground">
              Latest from the Blog
            </h2>
            <p className="text-fd-muted-foreground">
              Updates, guides, and technical deep dives.
            </p>
          </div>
          <Link
            href="/blog"
            className="hidden text-sm font-medium text-fd-primary hover:underline md:block"
          >
            View all posts →
          </Link>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.url}
              href={post.url}
              className="group flex flex-col overflow-hidden rounded-2xl border border-fd-border bg-fd-card transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              <div className="aspect-video w-full overflow-hidden bg-fd-muted">
                {post.image ? (
                  // biome-ignore lint/performance/noImgElement: support external images without next.config.js changes
                  <img
                    src={post.image}
                    alt={post.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-fd-muted-foreground">
                    No Image
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h3 className="mb-2 text-xl font-bold bg-clip-text text-transparent bg-linear-to-br from-fd-foreground to-fd-muted-foreground group-hover:to-fd-foreground transition-all">
                  {post.title}
                </h3>
                <p className="mb-4 line-clamp-2 text-sm text-fd-muted-foreground">
                  {post.description}
                </p>
                <div className="mt-auto flex items-center justify-between text-xs text-fd-muted-foreground">
                  <span>{new Date(post.date).toLocaleDateString()}</span>
                  <span className="font-medium text-fd-primary">Read more</span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-center md:hidden">
          <Link
            href="/blog"
            className="text-sm font-medium text-fd-primary hover:underline"
          >
            View all posts →
          </Link>
        </div>
      </section>
      <Footer />
    </div>
  );
}
