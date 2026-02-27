import { docs } from "fumadocs-mdx:collections/server";
import { type InferPageType, loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import type { TOCItemType } from "fumadocs-core/toc";
import { icons } from "lucide-react";
import type { MDXContent } from "mdx/types";
import { createElement } from "react";

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
  icon(icon) {
    if (!icon) {
      return;
    }
    if (icon in icons) return createElement(icons[icon as keyof typeof icons]);
  },
});

/**
 * The full data shape for a docs page, combining the Zod frontmatter schema
 * with the runtime MDX properties provided by fumadocs-mdx.
 *
 * `InferPageType` types `page.data` from the Zod schema alone, so MDX
 * runtime fields (body, toc, getText, etc.) are not included there.
 * This type merges both so they can be used in a type-safe way.
 */
export type DocsPageData = InferPageType<typeof source>["data"] & {
  /** Compiled MDX React component. */
  body: MDXContent;
  /** Table of contents items extracted from the document. */
  toc: TOCItemType[];
  /** Whether the page should render full-width. */
  full?: boolean;
  /** Custom keywords added via pageSchema extension. */
  keywords?: string[];
  /**
   * Retrieve the processed Markdown text.
   * Requires `postprocess.includeProcessedMarkdown: true` in source.config.ts.
   */
  getText(type: "raw" | "processed"): Promise<string>;
};

export type DocsPageItem = Omit<InferPageType<typeof source>, "data"> & {
  data: DocsPageData;
};

export function getPageImage(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, "image.png"];

  return {
    segments,
    url: `/og/docs/${segments.join("/")}`,
  };
}

export async function getLLMText(page: DocsPageItem) {
  const processed = await page.data.getText("processed");
  return `# ${page.data.title} (${page.url})\n${processed}`;
}
