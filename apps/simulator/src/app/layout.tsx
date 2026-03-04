import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const BASE_URL = "https://ocpp.rohittiwari.me";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "OCPP WS Simulator",
    template: "%s | ocpp-ws-simulator",
  },
  description:
    "A modern, open-source OCPP 1.6 / 2.0.1 / 2.1 charge point emulator built on ocpp-ws-io. Test your CSMS with realistic connector simulations, diagnostics, meter values, reservations, and real-time OCPP message logs.",
  keywords: [
    "OCPP Simulator",
    "OCPP Emulator",
    "Charge Point Emulator",
    "OCPP 1.6",
    "OCPP 2.0.1",
    "OCPP 2.1",
    "CSMS Testing",
    "EV Charging Simulator",
    "EVSE Emulator",
    "ocpp-ws-io",
    "WebSocket",
    "OCPP Testing Tool",
    "OCPP Client",
    "EV Charging",
    "TypeScript",
    "Next.js",
  ],
  authors: [{ name: "Rohit Tiwari", url: "https://rohittiwari.me" }],
  creator: "Rohit Tiwari",
  publisher: "Rohit Tiwari",

  /* ── Indexing ── */
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  /* ── Icons ── */
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
    shortcut: "/favicon.ico",
  },

  /* ── Open Graph ── */
  openGraph: {
    type: "website",
    locale: "en_US",
    url: BASE_URL,
    siteName: "ocpp-ws-simulator",
    title: "ocpp-ws-simulator | OCPP Charge Point Emulator",
    description:
      "Test your CSMS with a realistic OCPP charge point emulator. Supports OCPP 1.6, 2.0.1, 2.1 — built on ocpp-ws-io.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "OCPP Charge Point Simulator",
      },
    ],
  },

  /* ── Twitter / X ── */
  twitter: {
    card: "summary_large_image",
    title: "ocpp-ws-simulator | OCPP Charge Point Emulator",
    description:
      "An open-source OCPP 1.6/2.0.1/2.1 charge point emulator for testing CSMS backends.",
    creator: "@rohittiwari_dev",
    images: ["/og.png"],
  },

  /* ── Canonical ── */
  alternates: {
    canonical: BASE_URL,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${inter.className} antialiased`}>
        {/* ── Subtle grid overlay ── */}
        <div className="bg-grid-overlay" aria-hidden="true" />

        {/* ── App content ── */}
        <div className="relative z-10 flex flex-col min-h-screen">
          <TooltipProvider>{children}</TooltipProvider>
        </div>
      </body>
    </html>
  );
}
