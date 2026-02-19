"use client";

import { Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

interface BlogPost {
  url: string;
  title: string;
  description: string;
  date: Date;
  image: string;
  tags: string[];
}

export function BlogPostsList({ posts }: { posts: BlogPost[] }) {
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = useMemo(
    () => Array.from(new Set(posts.flatMap((p) => p.tags))),
    [posts],
  );

  const filtered = useMemo(() => {
    return posts.filter((post) => {
      const matchesSearch =
        !search ||
        post.title.toLowerCase().includes(search.toLowerCase()) ||
        post.description.toLowerCase().includes(search.toLowerCase());
      const matchesTag = !activeTag || post.tags.includes(activeTag);
      return matchesSearch && matchesTag;
    });
  }, [posts, search, activeTag]);

  return (
    <>
      {/* Search + Tag Filters */}
      <div className="mb-8 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute z-10 left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fd-foreground" />
          <input
            type="text"
            placeholder="Search posts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-fd-border bg-fd-card/50 py-2.5 pl-10 pr-4 text-sm text-fd-foreground placeholder:text-fd-muted-foreground outline-none transition-all focus:border-fd-primary/50 focus:ring-2 focus:ring-fd-primary/20 backdrop-blur-sm"
          />
        </div>

        {/* Tag Filters */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
              activeTag === null
                ? "bg-fd-primary text-fd-primary-foreground shadow-sm"
                : "bg-fd-card/50 text-fd-muted-foreground border border-fd-border hover:bg-fd-card hover:text-fd-foreground"
            }`}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                activeTag === tag
                  ? "bg-fd-primary text-fd-primary-foreground shadow-sm"
                  : "bg-fd-primary/10 text-fd-primary hover:bg-fd-primary/20"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Results Count */}
      {(search || activeTag) && (
        <p className="mb-4 text-sm text-fd-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "post" : "posts"} found
          {activeTag && (
            <>
              {" "}
              in{" "}
              <span className="font-medium text-fd-primary">{activeTag}</span>
            </>
          )}
          {search && (
            <>
              {" "}
              for &quot;
              <span className="font-medium text-fd-foreground">{search}</span>
              &quot;
            </>
          )}
        </p>
      )}

      {/* Posts Grid */}
      <div className="grid gap-8 md:grid-cols-2 w-full place-items-stretch lg:grid-cols-3">
        {filtered.map((post) => (
          <Link
            key={post.url}
            href={post.url}
            className="flex flex-col overflow-hidden w-full rounded-lg border bg-fd-card text-fd-card-foreground shadow-sm transition-all hover:shadow-md"
          >
            {post.image && (
              <Image
                src={post.image}
                alt={post.title}
                className="aspect-video w-full object-cover"
                width={500}
                height={500}
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
        {filtered.length === 0 && (
          <div className="col-span-full py-16 text-center">
            <p className="text-lg font-medium text-fd-muted-foreground">
              No posts found
            </p>
            <p className="mt-1 text-sm text-fd-muted-foreground/70">
              Try adjusting your search or filter
            </p>
          </div>
        )}
      </div>
    </>
  );
}
