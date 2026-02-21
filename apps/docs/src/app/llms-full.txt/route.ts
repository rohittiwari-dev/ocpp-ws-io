import fs from "node:fs";
import path from "node:path";
import { blogSource } from "@/lib/blog";
import { source } from "@/lib/source";

export const revalidate = false;

export async function GET(request: Request) {
  const host = request.headers.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const pages = source.getPages();
  const scanned = pages.map((page) => {
    try {
      // Compute the relative file path based on the page slugs
      let relativePath = page.slugs.join("/");
      if (relativePath === "") relativePath = "index";

      let filePath = path.join(
        process.cwd(),
        "content",
        "docs",
        `${relativePath}.mdx`,
      );
      if (!fs.existsSync(filePath)) {
        filePath = path.join(
          process.cwd(),
          "content",
          "docs",
          relativePath,
          "index.mdx",
        );
      }

      const content = fs.readFileSync(filePath, "utf-8");

      return `---
Title: ${page.data.title}
URL: ${baseUrl}${page.url}
Description: ${page.data.description}
---

${content}`;
    } catch (_err) {
      return `---
Title: ${page.data.title}
URL: ${baseUrl}${page.url}
---

(Error reading source file)`;
    }
  });

  const blogScanned = blogSource.getPages().map((page) => {
    try {
      let relativePath = page.slug;
      if (relativePath === "") relativePath = "index";

      let filePath = path.join(
        process.cwd(),
        "content",
        "blog",
        `${relativePath}.mdx`,
      );
      if (!fs.existsSync(filePath)) {
        filePath = path.join(
          process.cwd(),
          "content",
          "blog",
          relativePath,
          "index.mdx",
        );
      }

      const content = fs.readFileSync(filePath, "utf-8");

      return `---
Title: ${page.title}
URL: ${baseUrl}${page.url}
Description: ${page.description}
---

${content}`;
    } catch (_err) {
      return `---
Title: ${page.title}
URL: ${baseUrl}${page.url}
---

(Error reading source file)`;
    }
  });

  return new Response(
    scanned
      .concat(blogScanned)
      .join("\n\n=========================================\n\n"),
  );
}
