import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OCPP WS IO",
    short_name: "OCPP WS IO",
    description:
      "Type-safe OCPP WebSocket library for Node.js — supports OCPP 1.6, 2.0.1, 2.1, strict validation, and clustering.",
    start_url: "/",
    display: "browser",
    background_color: "#09090b",
    theme_color: "#7C3AED",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
