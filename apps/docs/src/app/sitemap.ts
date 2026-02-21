import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { blogSource } from "@/lib/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  const url = "https://ocpp-ws-io.rohittiwari.me";

  return [
    {
      url,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${url}/blog`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...source.getPages().map((page) => ({
      url: `${url}${page.url}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...blogSource.getPages().map((page) => ({
      url: `${url}${page.url}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
