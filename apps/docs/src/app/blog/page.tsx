import { blogSource } from "@/lib/blog";
import Link from "next/link";

export default function BlogPage() {
  const posts = [...blogSource.getPages()].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return (
    <main className="container max-w-[1100px] py-12 px-4 md:px-6">
      <h1 className="mb-4 text-4xl font-bold text-fd-foreground">Blog</h1>
      <p className="mb-8 text-lg text-fd-muted-foreground">
        Latest updates and guides.
      </p>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <Link
            key={post.url}
            href={post.url}
            className="flex flex-col overflow-hidden rounded-lg border bg-fd-card text-fd-card-foreground shadow-sm transition-all hover:shadow-md"
          >
            {post.image && (
              <img
                src={post.image}
                alt={post.title}
                className="aspect-video w-full object-cover"
              />
            )}
            <div className="flex flex-1 flex-col p-6">
              <h2 className="mb-2 text-xl font-semibold">{post.title}</h2>
              <p className="mb-4 text-sm text-fd-muted-foreground line-clamp-3">
                {post.description}
              </p>
              <div className="mt-auto flex items-center text-xs text-fd-muted-foreground">
                <span>{new Date(post.date).toLocaleDateString()}</span>
                {post.tags && (
                  <div className="ml-auto flex gap-2">
                    {post.tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-fd-primary/10 px-2.5 py-0.5 text-fd-primary font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
