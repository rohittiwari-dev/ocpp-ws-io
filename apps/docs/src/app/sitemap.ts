import type { MetadataRoute } from "next";
import { blogSource } from "@/lib/blog";
import { source } from "@/lib/source";

export default function sitemap(): MetadataRoute.Sitemap {
  const url = "https://ocpp-ws-io.rohittiwari.me";

  return [
    {
      url,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${url}/blog`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    ...source.getPages().map((page) => ({
      url: `${url}${page.url}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 1,
    })),
    ...blogSource.getPages().map((page) => ({
      url: `${url}${page.url}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 1,
    })),
  ];
}
