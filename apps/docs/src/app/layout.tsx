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
  title: {
    template: "%s | OCPP WS IO",
    default: "OCPP WS IO Docs",
  },
  description:
    "Build scalable CSMS and Charging Stations with ocpp-ws-io. Type-safe OCPP 1.6/2.0.1/2.1 WebSocket RPC ecosystem for Node.js, TypeScript, and NestJS — strict OCA schema validation, Redis clustering, and live Protocol Translation.",
  keywords: [
    "OCPP",
    "OCPP 1.6",
    "OCPP 1.6J",
    "OCPP 2.0.1",
    "OCPP 2.1",
    "Open Charge Point Protocol",
    "Open Charge Alliance",
    "OCA",
    "OCPI",
    "WebSocket",
    "RPC",
    "OCPP RPC",
    "ocpp-rpc",
    "TypeScript",
    "TypeScript OCPP",
    "Node.js",
    "nodejs",
    "node-ocpp",
    "NestJS",
    "NestJS OCPP",
    "NestJS EV Charging",
    "EV Charging",
    "EVSE",
    "CSMS",
    "Charging Station Management System",
    "Charge Point Operator",
    "CPO Software",
    "Charging Station",
    "Charge Point",
    "CitrineOS",
    "e-mobility",
    "e-mobility OS",
    "OCPP Library",
    "OCPP Framework",
    "OCPP Server",
    "OCPP Server Node.js",
    "OCPP Client",
    "OCPP Browser Client",
    "OCPP WebSocket",
    "OCPP Redis",
    "OCPP Simulator",
    "OCPP Testing",
    "Type-Safe OCPP",
    "Build CSMS",
    "EV Fleet Management",
    "Voltlog",
    "Charge Point Emulator",
    "EV Charging Simulator",
    "Smart Charging",
    "Protocol Proxy",
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
    title: "OCPP WS IO — Type-Safe OCPP Ecosystem for Node.js & NestJS",
    description:
      "Build scalable CSMS and Charging Stations with ocpp-ws-io. Type-safe OCPP 1.6/2.0.1/2.1 WebSocket RPC library for Node.js & NestJS — strict validation, Redis clustering, and browser client.",
  },
  twitter: {
    card: "summary_large_image",
    title: "OCPP WS IO — Type-Safe OCPP Ecosystem for Node.js & NestJS",
    description:
      "Type-safe OCPP WebSocket RPC client & server for Node.js and NestJS",
    creator: "@rohittiwari_dev",
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
