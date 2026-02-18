import { createMDX } from "fumadocs-mdx/next";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

const withMDX = createMDX({
  mdxOptions: {
    remarkPlugins: [remarkMath],
    rehypePlugins: (defaultPlugins) => [rehypeKatex, ...defaultPlugins],
  },
});

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: "export",
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
