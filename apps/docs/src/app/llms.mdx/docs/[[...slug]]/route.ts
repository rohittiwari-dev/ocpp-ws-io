import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { source } from "@/lib/source";

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<"/llms.mdx/docs/[[...slug]]">,
) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  try {
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

    const mdx = `---
Title: ${page.data.title}
Description: ${page.data.description}
---

${content}`;

    return new Response(mdx, {
      headers: {
        "Content-Type": "text/markdown",
      },
    });
  } catch (_err) {
    return new Response("(Error reading source file)", { status: 500 });
  }
}

export function generateStaticParams() {
  return source.generateParams();
}
