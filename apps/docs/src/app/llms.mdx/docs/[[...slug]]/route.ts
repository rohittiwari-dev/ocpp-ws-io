import { notFound } from "next/navigation";
import { getLLMText, source } from "@/lib/source";

export const dynamic = "force-static";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/llms.mdx/docs/[[...slug]]">,
) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: `<https://ocpp-ws-io.rohittiwari.me${page.url}>; rel="canonical"`,
    },
  });
}

export function generateStaticParams() {
  return source.generateParams();
}
