import { blogSource } from "@/lib/blog";
import { getLLMText, source } from "@/lib/source";

export const dynamic = "force-static";
const BASE_URL = "https://ocpp-ws-io.rohittiwari.me";

export async function GET() {
  // Compiled collections do not depend on raw MDX files being deployed.
  const docs = await Promise.all(source.getPages().map(getLLMText));
  const blogs = await Promise.all(
    blogSource.getPages().map(async (page) => {
      const content = await page.getText("processed");
      return `# ${page.title}\n\nURL: ${BASE_URL}${page.url}\n\n${page.description}\n\n${content}`;
    }),
  );

  return new Response([...docs, ...blogs].join("\n\n---\n\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
