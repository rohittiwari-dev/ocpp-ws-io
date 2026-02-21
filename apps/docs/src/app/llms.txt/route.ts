import { blogSource } from "@/lib/blog";
import { source } from "@/lib/source";

export const revalidate = false;

export async function GET(request: Request) {
  const host = request.headers.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const lines: string[] = [];
  lines.push("# Documentation");
  lines.push("");
  for (const page of source.getPages()) {
    lines.push(
      `- [${page.data.title}](${baseUrl}${page.url}): ${page.data.description}`,
    );
  }

  lines.push("");
  lines.push("# Blog");
  lines.push("");
  for (const page of blogSource.getPages()) {
    lines.push(`- [${page.title}](${baseUrl}${page.url}): ${page.description}`);
  }

  return new Response(lines.join("\n"));
}
