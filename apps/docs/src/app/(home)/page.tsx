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
  metadataBase: new URL("https://ocpp-ws-io.rohittiwari.me"),
  title: {
    absolute: "ocpp-ws-io — Complete OCPP Ecosystem for Node.js",
  },
  description:
    "The complete, type-safe OCPP ecosystem for Node.js. Core RPC library, Protocol Proxy, Smart Charging Engine, CLI tooling, and Browser Simulator. Supports OCPP 1.6, 2.0.1, and 2.1.",
  keywords: [
    // Core library
    "OCPP Library Node.js",
    "TypeScript OCPP WebSocket",
    "OCPP Server Implementation",
    "OCPP Client Node.js",
    "OCPP 1.6 Server",
    "OCPP 2.0.1 Library",
    "OCPP 2.1 TypeScript",
    "ocpp-ws-io",
    // Ecosystem packages
    "OCPP Protocol Proxy",
    "OCPP Version Translation",
    "Smart Charging Engine",
    "OCPP Smart Charging",
    "EV Load Balancing",
    "OCPP CLI",
    "OCPP Simulator Browser",
    // Use-cases
    "CSMS Framework Node.js",
    "EV Charging Software",
    "Charge Point Management System",
    "Open Charge Point Protocol",
    "EV Infrastructure TypeScript",
    "OCPP WebSocket RPC",
    "OCPP Redis Clustering",
    "OCPP Security Profiles mTLS",
  ],
  openGraph: {
    siteName: "ocpp-ws-io ecosystem",
    title: "ocpp-ws-io — Complete OCPP Ecosystem for Node.js",
    description:
      "Type-safe OCPP WebSocket RPC, Protocol Proxy, Smart Charging Engine, CLI tooling, and Browser Simulator — all in one TypeScript ecosystem.",
    url: "https://ocpp-ws-io.rohittiwari.me",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ocpp-ws-io — Complete OCPP Ecosystem for Node.js",
    description:
      "Type-safe OCPP 1.6/2.0.1/2.1 WebSocket RPC, Protocol Proxy, Smart Charging, CLI tools & Browser Simulator — all open source.",
  },
  alternates: {
    canonical: "/",
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
    alternateName: ["OCPP-WS-IO"],
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
