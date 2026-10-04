import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LLMCopyButton, ViewOptions } from "@/components/ai/page-actions";
import {
  createBreadcrumbJsonLd,
  createTechArticleJsonLd,
  serializeJsonLd,
} from "@/lib/json-ld";
import { gitConfig } from "@/lib/layout.shared";
import { getPageImage, source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";

const DEFAULT_DOC_KEYWORDS = [
  "OCPP",
  "OCPP RPC",
  "OCPP 1.6",
  "OCPP 2.0.1",
  "OCPP 2.1",
  "Node.js OCPP",
  "TypeScript OCPP",
  "EV Charging",
  "CSMS",
  "Open Charge Alliance",
  "OCA",
  "OCPI",
  "e-mobility",
  "CitrineOS",
  "NestJS OCPP",
  "EVSE",
  "Smart Charging",
];

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  const breadcrumbItems = [
    { name: "Home", url: "/" },
    { name: "Documentation", url: "/docs" },
    ...page.slugs.flatMap((_segment, idx) => {
      const ancestor = source.getPage(page.slugs.slice(0, idx + 1));
      return ancestor ? [{ name: ancestor.data.title, url: ancestor.url }] : [];
    }),
  ];
  if (breadcrumbItems.length > 1) {
    breadcrumbItems[breadcrumbItems.length - 1].name = page.data.title;
  }

  const pageKeywords = Array.from(
    new Set([...(page.data.keywords || []), ...DEFAULT_DOC_KEYWORDS]),
  );

  const techArticleJsonLd = createTechArticleJsonLd({
    title: page.data.title,
    description: page.data.description || page.data.title,
    url: page.url,
    keywords: pageKeywords,
    dateModified: page.data.lastModified?.toISOString(),
    breadcrumbs: breadcrumbItems,
  });

  const breadcrumbsJsonLd = createBreadcrumbJsonLd(breadcrumbItems);

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{
        style: "clerk",
      }}
      breadcrumb={{
        enabled: true,
      }}
    >
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: structured data is serialized with HTML delimiters escaped
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd([techArticleJsonLd, breadcrumbsJsonLd]),
        }}
      />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">
        {page.data.description}
      </DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <LLMCopyButton markdownUrl={`/llms.mdx${page.url}`} />
        <ViewOptions
          markdownUrl={`/llms.mdx${page.url}`}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/docs/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: (linkProps) => {
              const resolvedHref = linkProps.href
                ? source.resolveHref(linkProps.href, page)
                : linkProps.href;
              return <a {...linkProps} href={resolvedHref} />;
            },
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<"/docs/[[...slug]]">,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const keywords = Array.from(
    new Set([...(page.data.keywords || []), ...DEFAULT_DOC_KEYWORDS]),
  );

  return {
    title: page.data.title,
    description: page.data.description,
    keywords,
    alternates: {
      canonical: `https://ocpp-ws-io.rohittiwari.me${page.url}`,
    },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      type: "article",
      url: `https://ocpp-ws-io.rohittiwari.me${page.url}`,
      images: [
        {
          url: getPageImage(page).url,
          width: 1200,
          height: 630,
          alt: page.data.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page.data.title,
      description: page.data.description,
      images: [getPageImage(page).url],
    },
  };
}
