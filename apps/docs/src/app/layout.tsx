import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import { Inter, Outfit } from "next/font/google";
import type { ReactNode } from "react";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata = {
  metadataBase: new URL("https://ocpp-ws-io.rohittiwari.me"),
  alternates: {
    canonical: "./",
  },
  title: {
    template: "%s | OCPP WS IO",
    default: "OCPP WS IO — Type-Safe OCPP WebSocket Library for Node.js",
  },
  description:
    "Build scalable CSMS and Charging Stations with ocpp-ws-io. Type-safe OCPP WebSocket library for Node.js — supports OCPP 1.6, 2.0.1, 2.1, strict validation, Redis clustering, and a browser client.",
  keywords: [
    "OCPP",
    "OCPP 1.6",
    "OCPP 2.0.1",
    "OCPP 2.1",
    "WebSocket",
    "RPC",
    "TypeScript",
    "Node.js",
    "EV Charging",
    "CSMS",
    "Charging Station",
    "Charge Point",
    "EVSE",
    "OCPP Library",
    "OCPP Framework",
    "OCPP Server",
    "OCPP Client",
  ],
  authors: [{ name: "Rohit Tiwari", url: "https://rohittiwari.me" }],
  creator: "Rohit Tiwari",
  publisher: "Rohit Tiwari",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://ocpp-ws-io.rohittiwari.me",
    siteName: "OCPP WS IO",
    title: "OCPP WS IO",
    description:
      "Build scalable CSMS and Charging Stations with ocpp-ws-io. Type-safe OCPP WebSocket library for Node.js — supports OCPP 1.6, 2.0.1, 2.1, strict validation, Redis clustering, and a browser client.",
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
    title: "OCPP WS IO",
    description: "Type-safe OCPP WebSocket RPC client & server for Node.js",
    creator: "@rohittiwari",
    images: ["/og.png"],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ocpp-ws-io",
    operatingSystem: "Independent",
    applicationCategory: "DeveloperApplication",
    description:
      "Build scalable CSMS and Charging Stations with ocpp-ws-io. Type-safe OCPP WebSocket library for Node.js — supports OCPP 1.6, 2.0.1, 2.1, strict validation, Redis clustering, and a browser client.",
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "5",
      ratingCount: "1",
    },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    author: {
      "@type": "Person",
      name: "Rohit Tiwari",
      url: "https://rohittiwari.me",
    },
  };

  return (
    <html
      lang="en"
      className={`${inter.variable} ${outfit.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: safe as we control the content
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
