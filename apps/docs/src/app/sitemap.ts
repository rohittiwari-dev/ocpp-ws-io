import { MetadataRoute } from "next";
import { source } from "@/lib/source";

export default function sitemap(): MetadataRoute.Sitemap {
  const url = "https://ocpp-ws-io.rohittiwari.me";

  return [
    {
      url,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    ...source.getPages().map((page) => ({
      url: `${url}${page.url}`,
      lastModified: new Date(), // getting from git history could be an optimization later
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
