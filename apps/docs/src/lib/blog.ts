import fs from "fs";
import path from "path";
import matter from "gray-matter";

const BLOG_DIR = path.join(process.cwd(), "content/blogs");

export interface BlogPage {
  title: string;
  description: string;
  date: Date;
  author: {
    name: string;
    avatar: string;
    twitter?: string;
  };
  image: string;
  tags: string[];
  url: string;
  slug: string;
  content: string; // Raw MDX content for next-mdx-remote
}

export const blogSource = {
  getPages: (): BlogPage[] => {
    try {
      const files = fs.readdirSync(BLOG_DIR);
      return files
        .filter((file) => file.endsWith(".mdx"))
        .map((file) => {
          const filePath = path.join(BLOG_DIR, file);
          const fileContent = fs.readFileSync(filePath, "utf-8");
          const { data, content } = matter(fileContent);
          const slug = file.replace(/\.mdx?$/, "");

          return {
            title: data.title || "Untitled",
            description: data.description || "",
            date: data.date ? new Date(data.date) : new Date(),
            author: data.author || { name: "Anonymous", avatar: "" },
            image: data.image || "",
            tags: data.tags || [],
            url: `/blog/${slug}`,
            slug,
            content,
          } as BlogPage;
        })
        .sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch (error) {
      console.error("Error reading blog directory:", error);
      return [];
    }
  },
  getPage: (slugs: string[]): BlogPage | undefined => {
    const slug = slugs[0];
    const pages = blogSource.getPages();
    return pages.find((p) => p.slug === slug);
  },
};
