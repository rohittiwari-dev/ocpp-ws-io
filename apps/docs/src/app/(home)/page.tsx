import Link from "next/link";
import { blogSource } from "@/lib/blog";

export default function HomePage() {
  const posts = [...blogSource.getPages()]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1 py-12">
      <h1 className="text-4xl font-bold mb-4">OCPP WS IO</h1>
      <p className="mb-8 text-lg text-fd-muted-foreground">
        A lightweight, performant OCPP 1.6/2.0.1 WebSocket server for Node.js.
      </p>
      <div className="flex gap-4 mb-16">
        <Link
          href="/docs"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          Get Started
        </Link>
        <Link
          href="/blog"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
        >
          Read Blog
        </Link>
      </div>

      <div className="w-full max-w-4xl px-4 text-left">
        <h2 className="text-2xl font-bold mb-6">Latest from Blog</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.url}
              href={post.url}
              className="group flex flex-col rounded-lg border p-4 hover:bg-fd-accent/50 transition-colors"
            >
              <h3 className="font-semibold mb-2 group-hover:underline">
                {post.title}
              </h3>
              <p className="text-sm text-fd-muted-foreground line-clamp-2 mb-4">
                {post.description}
              </p>
              <div className="mt-auto text-xs text-fd-muted-foreground">
                {new Date(post.date).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
