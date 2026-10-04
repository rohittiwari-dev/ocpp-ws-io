import { notFound } from "next/navigation";
import { blogSource } from "@/lib/blog";

export const dynamic = "force-static";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/llms.mdx/blog/[slug]">,
) {
  const { slug } = await params;
  const page = blogSource.getPage([slug]);
  if (!page) notFound();

  const url = `https://ocpp-ws-io.rohittiwari.me${page.url}`;
  const content = await page.getText("processed");
  return new Response(
    `# ${page.title}\n\nURL: ${url}\n\n${page.description}\n\n${content}`,
    {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        Link: `<${url}>; rel="canonical"`,
      },
    },
  );
}

export function generateStaticParams() {
  return blogSource.generateParams();
}
