import { defineConfig } from "tsup";

// tsup's declaration build always sets `baseUrl`, which TypeScript 6
// reports as deprecated (TS5101). Silenced for that build only; tsc itself
// still type-checks without it.
const dts = { compilerOptions: { ignoreDeprecations: "6.0" } };

const nodeEntries = {
  index: "src/index.ts",
  "adapters/redis": "src/adapters/redis/index.ts",
  logger: "src/logger/index.ts",
  plugins: "src/plugins/index.ts",
  express: "src/frameworks/express/index.ts",
  nestjs: "src/frameworks/nestjs/index.ts",
  fastify: "src/frameworks/fastify/index.ts",
  hono: "src/frameworks/hono/index.ts",
};

export default defineConfig([
  {
    entry: nodeEntries,
    format: ["cjs", "esm"],
    dts: {
      ...dts,
      entry: { ...nodeEntries, browser: "src/browser/index.ts" },
    },
    splitting: false,
    sourcemap: false,
    clean: false,
    outDir: "dist",
    target: "node20",
    shims: true,
    minify: true,
    treeshake: true,
    onSuccess: async () => {
      const { copyFileSync } = await import("node:fs");
      copyFileSync("src/server/parse-worker.cjs", "dist/parse-worker.cjs");
    },
  },
  // Browser entry (no Node.js dependencies)
  {
    entry: {
      browser: "src/browser/index.ts",
    },
    format: ["cjs", "esm"],
    dts: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    outDir: "dist",
    target: "esnext",
    platform: "browser",
    minify: true,
    shims: true,
    treeshake: true,
  },
]);
