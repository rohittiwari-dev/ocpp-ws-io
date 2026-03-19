import type { MetadataRoute } from "next";

const BASE_URL = "https://ocpp-ws-io.rohittiwari.me";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Main crawlers: allow everything except /api routes
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/api/",
          "/_next/",
          "/og/", // OG image generation routes — not useful for SEO
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
