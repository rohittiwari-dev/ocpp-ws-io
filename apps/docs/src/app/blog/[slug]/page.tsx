import { DocsBody } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LLMCopyButton, ViewOptions } from "@/components/ai/page-actions";
import { Footer } from "@/components/landing/footer";
import { blogSource, getRelatedDocs, getRelatedPosts } from "@/lib/blog";
import { gitConfig } from "@/lib/layout.shared";
import { getMDXComponents } from "@/mdx-components";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = blogSource.getPage([slug]);

  if (!page) notFound();

  return {
    title: page.title,
    description: page.description,
    keywords: page.tags,
    alternates: {
      canonical: `https://ocpp-ws-io.rohittiwari.me${page.url}`,
    },
    openGraph: {
      title: page.title,
      description: page.description,
      type: "article",
      url: `https://ocpp-ws-io.rohittiwari.me${page.url}`,
      images: page.image ? [page.image] : undefined,
      publishedTime: new Date(page.date).toISOString(),
      authors: [page.author.name],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: page.image ? [page.image] : undefined,
      creator: page.author.twitter
        ? `@${page.author.twitter.split("/").pop()}`
        : undefined,
    },
  };
}

export function generateStaticParams() {
  return blogSource.generateParams();
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = blogSource.getPage([slug]);

  if (!page) {
    notFound();
  }

  const MDX = page.body;
  const relatedPosts = getRelatedPosts(page.slug, page.tags);
  const relatedDocs = getRelatedDocs(page.tags);
  const toc = page.toc;

  return (
    <>
      <main className="container max-w-[1400px] mx-auto py-12 px-4 md:px-6">
        <div className="flex flex-col lg:flex-row gap-10 mx-auto justify-center">
          {/* Main Content */}
          <article className="min-w-0 max-w-[780px] w-full">
            {/* Clean Hero Header */}
            <div className="mb-10">
              {/* Meta Header */}
              <div className="mb-6 flex items-center gap-3 text-sm font-semibold text-fd-muted-foreground uppercase tracking-wider">
                <Link
                  href="/blog"
                  className="inline-flex items-center gap-1.5 text-fd-foreground hover:text-violet-500 transition-colors"
                >
                  ← Back
                </Link>
                <span className="h-1 w-1 rounded-full bg-fd-border" />
                <span className="text-violet-500">
                  {new Date(page.date).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>

                {page.tags?.[0] && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-fd-border" />
                    <span className="rounded-full bg-violet-500/10 px-2.5 py-0.5 text-violet-500 border border-violet-500/20">
                      {page.tags[0]}
                    </span>
                  </>
                )}
              </div>

              {/* Title */}
              <h1 className="mb-4 text-4xl md:text-5xl font-extrabold tracking-tight text-fd-foreground leading-[1.15]">
                {page.title}
              </h1>

              <p className="mb-8 text-xl text-fd-muted-foreground leading-relaxed">
                {page.description}
              </p>

              {/* Author Plate */}
              <div className="flex items-center gap-4">
                <Image
                  src={page.author.avatar}
                  alt={page.author.name}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full object-cover border-2 border-fd-border/50"
                />
                <div className="flex flex-col">
                  <p className="font-bold text-fd-foreground">
                    {page.author.name}
                  </p>
                  {page.author.twitter && (
                    <a
                      href={page.author.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-violet-500 hover:text-violet-400 hover:underline transition-colors"
                    >
                      @{page.author.twitter.split("/").pop()}
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Fully Visible Cover Image */}
            {page.image && (
              <div className="relative mb-12 w-full overflow-hidden rounded-3xl border border-fd-border/50 bg-fd-muted/50 aspect-video shadow-lg">
                <Image
                  src={page.image}
                  alt={page.title}
                  fill
                  priority
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  className="object-cover"
                />
              </div>
            )}

            {/* MDX Content */}
            <DocsBody>
              <MDX components={getMDXComponents()} />
            </DocsBody>
          </article>

          {/* Right Sidebar */}
          <aside className="hidden bg-transparent! shadow-none! backdrop-blur-none! border-none! lg:block pl-10 shrink-0">
            <div className="sticky top-10 space-y-8 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8 pr-5 scrollbar-thin">
              {/* Page Actions */}
              <div className="flex items-center gap-3">
                <LLMCopyButton markdownUrl={`/llms.mdx${page.url}`} />
                <ViewOptions
                  markdownUrl={`/llms.mdx${page.url}`}
                  githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/docs/content/blog/${page.info.path}`}
                />
                <Link
                  href={`/docs`}
                  className="inline-flex items-center gap-2 bg-fd-muted/50 rounded-full border border-fd-border px-3 py-1.5 text-xs font-semibold text-fd-muted-foreground transition-all hover:bg-fd-card hover:text-violet-500 hover:border-violet-500/30 hover:shadow-sm"
                >
                  View Docs
                </Link>
                <Link
                  href={`/`}
                  className="inline-flex items-center gap-2 bg-fd-muted/50 rounded-full border border-fd-border px-3 py-1.5 text-xs font-semibold text-fd-muted-foreground transition-all hover:bg-fd-card hover:text-violet-500 hover:border-violet-500/30 hover:shadow-sm"
                >
                  Home
                </Link>
              </div>

              {/* Table of Contents */}
              {toc.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-fd-foreground uppercase tracking-wider">
                    On this page
                  </h3>
                  <nav className="space-y-1">
                    {toc.map((item, i) => (
                      <a
                        key={`${item.title}-${i}`}
                        href={item.url}
                        className="block text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors py-1"
                        style={{ paddingLeft: `${(item.depth - 2) * 12}px` }}
                      >
                        {item.title}
                      </a>
                    ))}
                  </nav>
                </div>
              )}

              {/* Related Documentation */}
              {relatedDocs.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-fd-foreground uppercase tracking-wider">
                    Related Docs
                  </h3>
                  <div className="space-y-2">
                    {relatedDocs.map((doc) => (
                      <Link
                        key={doc.url}
                        href={doc.url}
                        className="group block rounded-xl border border-fd-border/60 bg-fd-card/40 p-3.5 transition-all hover:bg-fd-card hover:border-violet-500/30 hover:shadow-md hover:shadow-violet-500/5 hover:-translate-y-0.5"
                      >
                        <p className="text-sm font-semibold text-fd-foreground group-hover:text-violet-500 transition-colors">
                          {doc.title}
                        </p>
                        {doc.description && (
                          <p className="mt-1.5 text-xs text-fd-muted-foreground line-clamp-2 leading-relaxed">
                            {doc.description}
                          </p>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Related Blog Posts */}
              {relatedPosts.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-fd-foreground uppercase tracking-wider">
                    Related Posts
                  </h3>
                  <div className="space-y-2">
                    {relatedPosts.map((post) => (
                      <Link
                        key={post.url}
                        href={post.url}
                        className="group block rounded-xl border border-fd-border/60 bg-fd-card/40 p-3.5 transition-all hover:bg-fd-card hover:border-violet-500/30 hover:shadow-md hover:shadow-violet-500/5 hover:-translate-y-0.5"
                      >
                        <p className="text-sm font-semibold text-fd-foreground group-hover:text-violet-500 transition-colors line-clamp-2">
                          {post.title}
                        </p>
                        <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-fd-muted-foreground">
                          {new Date(post.date).toLocaleDateString()}
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Links */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-fd-foreground uppercase tracking-wider">
                  Quick Links
                </h3>
                <div className="space-y-1">
                  <Link
                    href="/docs"
                    className="flex items-center gap-2 text-sm font-medium text-fd-muted-foreground hover:text-violet-500 transition-colors py-1.5"
                  >
                    <span>📖</span> Documentation
                  </Link>
                  <Link
                    href="/docs/quick-start"
                    className="flex items-center gap-2 text-sm font-medium text-fd-muted-foreground hover:text-violet-500 transition-colors py-1.5"
                  >
                    <span>🚀</span> Quick Start
                  </Link>
                  <Link
                    href="/docs/api-reference"
                    className="flex items-center gap-2 text-sm font-medium text-fd-muted-foreground hover:text-violet-500 transition-colors py-1.5"
                  >
                    <span>📚</span> API Reference
                  </Link>
                  <Link
                    href="/blog"
                    className="flex items-center gap-2 text-sm font-medium text-fd-muted-foreground hover:text-violet-500 transition-colors py-1.5"
                  >
                    <span>✍️</span> All Blog Posts
                  </Link>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
