import type { MetadataRoute } from "next";
import { blogSource } from "@/lib/blog";
import { source } from "@/lib/source";

const BASE_URL = "https://ocpp-ws-io.rohittiwari.me";

/** Paths that should never appear in the sitemap */
const EXCLUDED = ["/api/", "/og/", "/_next/"];

function isExcluded(url: string): boolean {
  return EXCLUDED.some((prefix) => url.includes(prefix));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/docs`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.95,
    },
    {
      url: `${BASE_URL}/docs/packages`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/blog`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.85,
    },
  ];

  const docPages: MetadataRoute.Sitemap = source
    .getPages()
    .filter((page) => !isExcluded(page.url))
    .map((page) => ({
      url: `${BASE_URL}${page.url}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority:
        // Give package index pages slightly higher priority
        page.url.match(
          /^\/docs\/(ocpp-ws-io|protocol-proxy|smart-charge-engine|cli|simulator|voltlog-io)$/,
        )
          ? 0.85
          : 0.75,
    }));

  const blogPages: MetadataRoute.Sitemap = blogSource
    .getPages()
    .filter((page) => !isExcluded(page.url))
    .map((page) => ({
      url: `${BASE_URL}${page.url}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }));

  return [...staticPages, ...docPages, ...blogPages];
}
