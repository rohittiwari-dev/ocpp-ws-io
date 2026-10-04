import type { Metadata } from "next";
import { BlogSection } from "@/components/landing/blog-section";
import { Ecosystem } from "@/components/landing/ecosystem";
import { Features } from "@/components/landing/features";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { Showcase } from "@/components/landing/showcase";
import { Stats } from "@/components/landing/stats";
import { blogSource } from "@/lib/blog";
import {
  createSoftwareApplicationJsonLd,
  serializeJsonLd,
} from "@/lib/json-ld";

export const metadata: Metadata = {
  metadataBase: new URL("https://ocpp-ws-io.rohittiwari.me"),
  title: {
    absolute:
      "ocpp-ws-io — Type-Safe OCPP 1.6/2.0.1/2.1 Ecosystem for Node.js & NestJS",
  },
  description:
    "A type-safe OCPP WebSocket RPC ecosystem for Node.js & TypeScript. Supports OCPP 1.6, 2.0.1, 2.1, native NestJS modules, Redis clustering, OCA schemas, Smart Charging, and Protocol Translation.",
  keywords: [
    // Core library & RPC
    "OCPP",
    "OCPP RPC",
    "ocpp-rpc",
    "OCPP WebSocket RPC",
    "OCPP Library Node.js",
    "TypeScript OCPP WebSocket",
    "OCPP Server Implementation",
    "OCPP Client Node.js",
    "OCPP 1.6 Server",
    "OCPP 2.0.1 Library",
    "OCPP 2.1 TypeScript",
    "node-ocpp",
    "ocpp node js framework",
    // Frameworks & Architecture
    "NestJS OCPP",
    "NestJS EV charging",
    "NestJS CSMS",
    "Express OCPP",
    "Fastify OCPP",
    "Hono OCPP",
    "Bun OCPP",
    // Open Standards & Ecosystems
    "Open Charge Alliance",
    "OCA",
    "OCPI",
    "e-mobility",
    "e-mobility OS",
    "CitrineOS",
    "CitrineOS Node.js",
    "CSMS Builder",
    "Charge Point Operator",
    "CPO Software",
    "EV Fleet Management",
    // Ecosystem packages
    "OCPP Protocol Proxy",
    "OCPP Version Translation",
    "Smart Charging Engine",
    "OCPP Smart Charging",
    "EV Load Balancing",
    "OCPP CLI",
    "OCPP Simulator Browser",
    "OCPP Redis Clustering",
    "OCPP Security Profiles mTLS",
  ],
  openGraph: {
    siteName: "ocpp-ws-io ecosystem",
    title: "ocpp-ws-io — Type-Safe OCPP 1.6/2.0.1/2.1 Ecosystem for Node.js",
    description:
      "Type-safe OCPP WebSocket RPC, native NestJS module, Protocol Proxy, Smart Charging Engine, CLI tooling, and Browser Simulator — all in one TypeScript ecosystem.",
    url: "https://ocpp-ws-io.rohittiwari.me",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ocpp-ws-io — Type-Safe OCPP Ecosystem for Node.js & NestJS",
    description:
      "Type-safe OCPP 1.6/2.0.1/2.1 WebSocket RPC, NestJS integration, Protocol Proxy, Smart Charging, CLI tools & Browser Simulator.",
  },
  alternates: {
    canonical: "/",
  },
};

export default function HomePage() {
  const posts = [...blogSource.getPages()]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    url: "https://ocpp-ws-io.rohittiwari.me",
    name: "OCPP WS IO",
    alternateName: ["OCPP-WS-IO", "ocpp-ws-io ecosystem"],
    description:
      "Type-safe OCPP WebSocket RPC client & server for Node.js. Supports OCPP 1.6, 2.0.1, 2.1, NestJS, and Redis clustering.",
    publisher: {
      "@type": "Person",
      name: "Rohit Tiwari",
      url: "https://rohittiwari.me",
    },
  };

  const softwareJsonLd = createSoftwareApplicationJsonLd({
    name: "ocpp-ws-io",
    description:
      "Production-grade, type-safe OCPP 1.6/2.0.1/2.1 WebSocket RPC client and server toolkit for Node.js and NestJS.",
    url: "https://ocpp-ws-io.rohittiwari.me",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Cross-platform (Node.js, Bun, Deno)",
    programmingLanguage: ["TypeScript", "JavaScript"],
    codeRepository: "https://github.com/rohittiwari-dev/ocpp-ws-io",
    keywords: [
      "OCPP",
      "OCPP RPC",
      "OCPP 1.6",
      "OCPP 2.0.1",
      "OCPP 2.1",
      "EV Charging",
      "CSMS",
      "Open Charge Alliance",
      "OCA",
      "OCPI",
      "CitrineOS",
      "NestJS",
      "Smart Charging",
    ],
    version: "3.0.0",
    license: "https://opensource.org/licenses/MIT",
    author: {
      name: "Rohit Tiwari",
      url: "https://rohittiwari.me",
    },
  });

  return (
    <div className="flex flex-col min-h-screen w-full">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: structured data is serialized with HTML delimiters escaped
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd([websiteJsonLd, softwareJsonLd]),
        }}
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
