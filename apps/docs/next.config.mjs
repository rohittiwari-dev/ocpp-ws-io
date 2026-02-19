import { createMDX } from "fumadocs-mdx/next";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

const withMDX = createMDX({
  mdxOptions: {
    remarkPlugins: [remarkMath],
    rehypePlugins: (defaultPlugins) => [rehypeKatex, ...defaultPlugins],
  },
});

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/docs/:path*.mdx",
        destination: "/llms.mdx/docs/:path*",
      },
    ];
  },
};

export default withMDX(config);
