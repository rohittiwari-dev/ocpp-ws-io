import type { Metadata } from "next";
import { BlogSection } from "@/components/landing/blog-section";
import { Ecosystem } from "@/components/landing/ecosystem";
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
      <Ecosystem />

      {/* Blog Section */}
      <BlogSection
        posts={posts.map((post) => ({
          title: post.title,
          description: post.description || "",
          url: post.url,
          date: post.date,
          image: post.image,
        }))}
      />
      <Footer />
    </div>
  );
}
