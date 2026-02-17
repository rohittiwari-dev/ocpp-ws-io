import { blogSource } from "@/lib/blog";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";

export function generateStaticParams() {
  return blogSource.getPages().map((page) => ({
    slug: page.slug,
  }));
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

  return (
    <main className="container max-w-[800px] mx-auto py-12 px-4 md:px-6">
      <div className="mb-8">
        <div className="mb-4 flex items-center gap-2 text-sm text-fd-muted-foreground">
          <a
            href="/blog"
            className="hover:text-fd-foreground transition-colors"
          >
            ← Back to Blog
          </a>
          <span>•</span>
          <span>{new Date(page.date).toLocaleDateString()}</span>
        </div>
        <h1 className="mb-4 text-4xl font-bold text-fd-foreground">
          {page.title}
        </h1>
        <div className="flex items-center gap-4">
          <img
            src={page.author.avatar}
            alt={page.author.name}
            className="h-10 w-10 rounded-full object-cover"
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
      </div>

      {page.image && (
        <img
          src={page.image}
          alt={page.title}
          className="mb-12 w-full rounded-xl object-cover shadow-lg aspect-video"
        />
      )}

      <article className="prose prose-zinc dark:prose-invert max-w-none">
        <MDXRemote source={page.content} />
      </article>
    </main>
  );
}
