import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import {
  defineCollections,
  defineConfig,
  defineDocs,
} from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import {
  createFileSystemGeneratorCache,
  createGenerator,
  remarkAutoTypeTable,
} from "fumadocs-typescript";
import * as z from "zod";

export const docs = defineDocs({
  dir: "./content/docs",
  docs: {
    schema: pageSchema.extend({
      keywords: z.array(z.string()).optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export const changelogCollection = defineCollections({
  type: "doc",
  dir: "./content/changelogs",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.date(),
  }),
});

export const blogCollection = defineCollections({
  type: "doc",
  dir: "./content/blogs",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.date(),
    author: z.object({
      name: z.string(),
      avatar: z.string(),
      twitter: z.string().optional(),
    }),
    image: z.string(),
    tags: z.array(z.string()),
  }),
});

const generator = createGenerator({
  cache: createFileSystemGeneratorCache(".next/fumadocs-typescript"),
});

export default defineConfig({
  mdxOptions: {
    remarkNpmOptions: {
      persist: {
        id: "persist-install",
      },
    },
    remarkPlugins: [[remarkAutoTypeTable, { generator }]],
  },
  plugins: [lastModified()],
});
