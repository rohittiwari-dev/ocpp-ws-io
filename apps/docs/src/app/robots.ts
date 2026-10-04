import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // Public documentation, rendering assets, and social images are crawlable.
    // Also covers OAI-SearchBot, Claude-SearchBot and Claude-User.
    rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }],
    sitemap: "https://ocpp-ws-io.rohittiwari.me/sitemap.xml",
  };
}
