import { blogCollection } from "fumadocs-mdx:collections/server";
import { source } from "@/lib/source";

export const blogSource = {
  getPages: () => {
    return blogCollection.map((entry) => {
      const slug = entry.info.path.replace(/\.mdx?$/, "");
      return {
        ...entry,
        url: `/blog/${slug}`,
        slug,
      };
    });
  },
  getPage: (slugs: string[]) => {
    const slug = slugs[0];
    const pages = blogSource.getPages();
    return pages.find((p) => p.slug === slug);
  },
  generateParams: () => {
    return blogCollection.map((entry) => ({
      slug: entry.info.path.replace(/\.mdx?$/, ""),
    }));
  },
};

export type BlogPage = ReturnType<typeof blogSource.getPages>[number];

/**
 * Get related blog posts based on shared tags (excluding the current post).
 */
export function getRelatedPosts(
  currentSlug: string,
  currentTags: string[],
  limit = 4,
) {
  const allPosts = blogSource.getPages();
  const tagsSet = new Set(currentTags);

  return allPosts
    .filter((p) => p.slug !== currentSlug)
    .map((p) => ({
      ...p,
      relevance: p.tags.filter((t) => tagsSet.has(t)).length,
    }))
    .filter((p) => p.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}

/**
 * Tag-to-docs mapping for suggesting related documentation pages.
 */
const TAG_TO_DOCS: Record<string, string[]> = {
  ocpp: ["quick-start", "api-reference"],
  csms: ["quick-start", "system-design", "clustering"],
  nodejs: ["quick-start", "frameworks"],
  typescript: ["type-safety", "type-generation"],
  websocket: ["api-reference", "browser-client"],
  security: ["security"],
  tls: ["security"],
  authentication: ["security"],
  architecture: ["system-design", "clustering"],
  tutorial: ["quick-start"],
  protocol: ["api-reference"],
};

/**
 * Get related docs pages based on the blog post's tags.
 */
export function getRelatedDocs(tags: string[], limit = 5) {
  const slugSet = new Set<string>();

  for (const tag of tags) {
    const docSlugs = TAG_TO_DOCS[tag] || [];
    for (const slug of docSlugs) {
      slugSet.add(slug);
    }
  }

  const docs: { title: string; description?: string; url: string }[] = [];

  for (const slug of slugSet) {
    const page = source.getPage([slug]);
    if (page) {
      docs.push({
        title: page.data.title,
        description: page.data.description,
        url: page.url,
      });
    }
  }

  return docs.slice(0, limit);
}
