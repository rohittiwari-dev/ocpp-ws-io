"use client";

import { motion } from "framer-motion";
import { ArrowRight, BookOpen } from "lucide-react";
import Link from "next/link";

type Post = {
  title: string;
  description: string;
  url: string;
  date: string | Date;
  image?: string;
};

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

export function BlogSection({ posts }: { posts: Post[] }) {
  if (!posts || posts.length === 0) return null;

  return (
    <section className="relative py-28 pb-36 overflow-hidden border-t border-fd-border/50">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute top-1/4 left-0 h-64 w-64 rounded-full bg-violet-500/5 blur-3xl -translate-x-1/2" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-blue-500/5 blur-3xl translate-x-1/3" />
      </div>

      <div className="container max-w-7xl mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16">
          <div className="max-w-2xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-4 py-1.5 text-xs font-semibold text-fd-muted-foreground mb-6"
            >
              <BookOpen className="h-3.5 w-3.5 text-violet-400" />
              Latest updates
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 }}
              className="text-4xl font-bold tracking-tight text-fd-foreground mb-4"
            >
              From the{" "}
              <span className="bg-linear-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                Blog
              </span>
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-lg text-fd-muted-foreground"
            >
              Deep dives, tutorials, and release notes from the ocpp-ws-io
              ecosystem.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            <Link
              href="/blog"
              className="group inline-flex h-10 items-center justify-center gap-2 rounded-full border border-fd-border bg-fd-card px-5 text-sm font-medium transition-all hover:bg-fd-accent hover:text-fd-accent-foreground shadow-sm"
            >
              View all posts
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </motion.div>
        </div>

        {/* Posts Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
        >
          {posts.slice(0, 3).map((post) => (
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
                    // biome-ignore lint/performance/noImgElement: allow external images
                    <img
                      src={post.image}
                      alt={post.title}
                      className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-violet-500/10 to-blue-500/10">
                      <BookOpen className="h-8 w-8 text-violet-400/50" />
                    </div>
                  )}
                  {/* Image overlay gradient for text legibility if needed */}
                  <div className="absolute inset-0 bg-linear-to-t from-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                </div>

                {/* Content */}
                <div className="flex flex-1 flex-col p-6 relative z-10">
                  <div className="mb-3 flex items-center justify-between text-xs font-semibold text-fd-muted-foreground uppercase tracking-wider">
                    <span className="text-violet-400">Article</span>
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
        </motion.div>
      </div>
    </section>
  );
}
