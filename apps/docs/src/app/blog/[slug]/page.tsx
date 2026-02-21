import { DocsBody } from "fumadocs-ui/layouts/docs/page";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer } from "@/components/landing/footer";
import type { Metadata } from "next";
import { blogSource, getRelatedDocs, getRelatedPosts } from "@/lib/blog";
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
            {/* Header */}
            <div className="mb-8">
              <div className="mb-4 flex items-center gap-2 text-sm text-fd-muted-foreground">
                <Link
                  href="/blog"
                  className="hover:text-fd-foreground transition-colors"
                >
                  ← Back to Blog
                </Link>
                <span>•</span>
                <span>{new Date(page.date).toLocaleDateString()}</span>
              </div>
              <h1 className="mb-4 text-4xl font-bold text-fd-foreground">
                {page.title}
              </h1>
              <p className="mb-6 text-lg text-fd-muted-foreground">
                {page.description}
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Image
                    src={page.author.avatar}
                    alt={page.author.name}
                    className="h-10 w-10 rounded-full object-cover"
                    width={500}
                    height={500}
                  />
                  <div>
                    <p className="text-sm font-medium text-fd-foreground">
                      {page.author.name}
                    </p>
                    {page.author.twitter && (
                      <a
                        href={page.author.twitter}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-fd-primary hover:underline"
                      >
                        @{page.author.twitter.split("/").pop()}
                      </a>
                    )}
                  </div>
                </div>
                <div className="hidden sm:flex gap-2">
                  {page.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-fd-primary/10 px-3 py-1 text-xs font-medium text-fd-primary"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Hero Image */}
            {page.image && (
              <Image
                src={page.image}
                alt={page.title}
                className="mb-12 w-full rounded-xl object-cover shadow-lg aspect-video"
                width={500}
                height={500}
              />
            )}

            {/* MDX Content */}
            <DocsBody>
              <MDX components={getMDXComponents()} />
            </DocsBody>
          </article>

          {/* Right Sidebar */}
          <aside className="hidden lg:block pl-10 shrink-0">
            <div className="sticky top-10 space-y-8 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8 pr-5 scrollbar-thin">
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
                        className="group block rounded-lg border border-fd-border/60 bg-fd-card/40 p-3 transition-all hover:bg-fd-card/80 hover:border-fd-border hover:shadow-sm"
                      >
                        <p className="text-sm font-medium text-fd-foreground group-hover:text-fd-primary transition-colors">
                          {doc.title}
                        </p>
                        {doc.description && (
                          <p className="mt-1 text-xs text-fd-muted-foreground line-clamp-2">
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
                        className="group block rounded-lg border border-fd-border/60 bg-fd-card/40 p-3 transition-all hover:bg-fd-card/80 hover:border-fd-border hover:shadow-sm"
                      >
                        <p className="text-sm font-medium text-fd-foreground group-hover:text-fd-primary transition-colors line-clamp-2">
                          {post.title}
                        </p>
                        <p className="mt-1 text-xs text-fd-muted-foreground">
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
                    className="flex items-center gap-2 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors py-1"
                  >
                    <span>📖</span> Documentation
                  </Link>
                  <Link
                    href="/docs/quick-start"
                    className="flex items-center gap-2 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors py-1"
                  >
                    <span>🚀</span> Quick Start
                  </Link>
                  <Link
                    href="/docs/api-reference"
                    className="flex items-center gap-2 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors py-1"
                  >
                    <span>📚</span> API Reference
                  </Link>
                  <Link
                    href="/blog"
                    className="flex items-center gap-2 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors py-1"
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
