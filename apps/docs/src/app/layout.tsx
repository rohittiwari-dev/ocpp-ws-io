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
    default: "OCPP WS IO Docs",
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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
  },
  manifest: "/manifest.webmanifest",
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
  return (
    <html
      lang="en"
      className={`${inter.variable} ${outfit.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
