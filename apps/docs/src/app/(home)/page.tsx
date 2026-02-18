import Link from "next/link";
import { blogSource } from "@/lib/blog";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { VideoDemo } from "@/components/landing/video-demo";
import { CodeShowcase } from "@/components/landing/code-showcase";
import { Footer } from "@/components/landing/footer";

export default function HomePage() {
  const posts = [...blogSource.getPages()]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  return (
    <div className="flex flex-col min-h-screen max-w-7xl mx-auto">
      <Hero />
      <VideoDemo />
      <CodeShowcase />
      <Features />

      {/* Blog Section */}
      <section className="container mx-auto px-4 py-18 border-t border-fd-border/50">
        <div className="mb-12 flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-3xl font-bold tracking-tight text-fd-foreground">
              Latest from the Blog
            </h2>
            <p className="text-fd-muted-foreground">
              Updates, guides, and technical deep dives.
            </p>
          </div>
          <Link
            href="/blog"
            className="hidden text-sm font-medium text-fd-primary hover:underline md:block"
          >
            View all posts →
          </Link>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.url}
              href={post.url}
              className="group flex flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-card/40 transition-all hover:bg-fd-card/60 hover:shadow-lg backdrop-blur-sm"
            >
              <div className="aspect-video w-full overflow-hidden bg-fd-muted">
                {post.image ? (
                  <img
                    src={post.image}
                    alt={post.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-fd-muted-foreground">
                    No Image
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h3 className="mb-2 text-xl font-bold bg-clip-text text-transparent bg-linear-to-br from-fd-foreground to-fd-muted-foreground group-hover:to-fd-foreground transition-all">
                  {post.title}
                </h3>
                <p className="mb-4 line-clamp-2 text-sm text-fd-muted-foreground">
                  {post.description}
                </p>
                <div className="mt-auto flex items-center justify-between text-xs text-fd-muted-foreground">
                  <span>{new Date(post.date).toLocaleDateString()}</span>
                  <span className="font-medium text-fd-primary">Read more</span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-center md:hidden">
          <Link
            href="/blog"
            className="text-sm font-medium text-fd-primary hover:underline"
          >
            View all posts →
          </Link>
        </div>
      </section>
      <Footer />
    </div>
  );
}
