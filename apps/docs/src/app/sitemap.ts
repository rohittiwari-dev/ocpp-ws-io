import type { MetadataRoute } from "next";
import { blogSource } from "@/lib/blog";
import { source } from "@/lib/source";

const BASE_URL = "https://ocpp-ws-io.rohittiwari.me";

export default function sitemap(): MetadataRoute.Sitemap {
  // Collection dates come from Git history. A build is not a content update.
  // Omit modification dates when the collection has no reliable date.
  const pages: MetadataRoute.Sitemap = [
    { url: BASE_URL },
    { url: `${BASE_URL}/blog` },
    ...source.getPages().map((page) => ({
      url: `${BASE_URL}${page.url}`,
      lastModified: page.data.lastModified,
    })),
    ...blogSource.getPages().map((page) => ({
      url: `${BASE_URL}${page.url}`,
      lastModified: page.lastModified,
    })),
  ];

  return [...new Map(pages.map((page) => [page.url, page])).values()];
}
