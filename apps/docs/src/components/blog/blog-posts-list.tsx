"use client";

import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

interface BlogPost {
  url: string;
  title: string;
  description: string;
  date: Date | string;
  image?: string;
  tags?: string[];
}

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" as const },
  },
};

export function BlogPostsList({ posts }: { posts: BlogPost[] }) {
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = useMemo(
    () => Array.from(new Set(posts.flatMap((p) => p.tags || []))),
    [posts],
  );

  const filtered = useMemo(() => {
    return posts.filter((post) => {
      const matchesSearch =
        !search ||
        post.title.toLowerCase().includes(search.toLowerCase()) ||
        post.description.toLowerCase().includes(search.toLowerCase());
      const matchesTag = !activeTag || post.tags?.includes(activeTag);
      return matchesSearch && matchesTag;
    });
  }, [posts, search, activeTag]);

  return (
    <>
      <div className="mb-12">
        {/* Search */}
        <div className="relative max-w-xl mb-6 group">
          <Search className="absolute z-10 left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-fd-muted-foreground transition-colors group-focus-within:text-violet-500" />
          <input
            type="text"
            placeholder="Search all posts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-fd-border bg-fd-card/50 py-3 pl-11 pr-4 text-sm text-fd-foreground placeholder:text-fd-muted-foreground outline-none transition-all focus:border-violet-500/50 focus:ring-4 focus:ring-violet-500/10 focus:bg-fd-card shadow-sm"
          />
        </div>

        {/* Tag Filters */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTag === null
                ? "bg-violet-500 text-white shadow-md shadow-violet-500/20"
                : "bg-fd-card/50 text-fd-muted-foreground border border-fd-border hover:bg-fd-card hover:text-fd-foreground hover:shadow-sm"
            }`}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                activeTag === tag
                  ? "bg-violet-500 text-white shadow-md shadow-violet-500/20"
                  : "bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 border border-transparent"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Results Count Meta */}
      {(search || activeTag) && (
        <motion.p
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 text-sm text-fd-muted-foreground"
        >
          {filtered.length} {filtered.length === 1 ? "post" : "posts"} found
          {activeTag && (
            <>
              {" "}
              in{" "}
              <span className="font-semibold text-violet-400">{activeTag}</span>
            </>
          )}
          {search && (
            <>
              {" "}
              for &quot;
              <span className="font-semibold text-fd-foreground">{search}</span>
              &quot;
            </>
          )}
        </motion.p>
      )}

      {/* Posts Grid */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
      >
        {filtered.map((post) => (
          <motion.div key={post.url} variants={cardVariants}>
            <Link
              href={post.url}
              className="group relative flex flex-col h-full overflow-hidden rounded-2xl border border-fd-border bg-fd-card transition-all duration-300 hover:shadow-xl hover:shadow-violet-500/5 hover:-translate-y-1"
            >
              {/* Glow on hover */}
              <div className="absolute inset-0 rounded-2xl bg-linear-to-b from-transparent to-violet-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

              {/* Hero Image */}
              <div className="relative aspect-video w-full overflow-hidden border-b border-fd-border/50 bg-fd-muted/50">
                {post.image ? (
                  <Image
                    src={post.image}
                    alt={post.title}
                    fill
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-violet-500/10 to-blue-500/10">
                    <BookOpen className="h-8 w-8 text-violet-400/50" />
                  </div>
                )}
                {/* Image overlay gradient for text legibility */}
                <div className="absolute inset-0 bg-linear-to-t from-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              </div>

              {/* Content */}
              <div className="flex flex-1 flex-col p-6 relative z-10">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-y-2 text-xs font-semibold text-fd-muted-foreground uppercase tracking-wider">
                  {post.tags?.[0] ? (
                    <span className="text-violet-400">{post.tags[0]}</span>
                  ) : (
                    <span className="text-violet-400">Article</span>
                  )}
                  <span>
                    {new Date(post.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>

                <h3 className="mb-3 text-xl font-bold leading-tight text-fd-foreground transition-colors group-hover:text-violet-400">
                  {post.title}
                </h3>

                <p className="mb-6 line-clamp-2 text-sm text-fd-muted-foreground leading-relaxed flex-1">
                  {post.description}
                </p>

                <div className="mt-auto flex items-center gap-1.5 text-sm font-semibold text-fd-foreground transition-colors group-hover:text-violet-400">
                  Read article
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          </motion.div>
        ))}

        {filtered.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="col-span-full py-20 text-center"
          >
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-fd-muted mb-4">
              <Search className="h-6 w-6 text-fd-muted-foreground/50" />
            </div>
            <p className="text-lg font-bold text-fd-foreground">
              No matching posts
            </p>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              Try adjusting your search criteria or clearing filters.
            </p>
          </motion.div>
        )}
      </motion.div>
    </>
  );
}
