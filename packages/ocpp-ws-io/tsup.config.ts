import { defineConfig } from "tsup";

// tsup's declaration build always sets `baseUrl`, which TypeScript 6
// reports as deprecated (TS5101). Silenced for that build only; tsc itself
// still type-checks without it.
const dts = { compilerOptions: { ignoreDeprecations: "6.0" } };

export default defineConfig([
  // Node.js entries (server, client, adapters)
  {
    entry: {
      index: "src/index.ts",
      "adapters/redis": "src/adapters/redis/index.ts",
      logger: "src/logger/index.ts",
      plugins: "src/plugins/index.ts",
      express: "src/frameworks/express/index.ts",
      nestjs: "src/frameworks/nestjs/index.ts",
      fastify: "src/frameworks/fastify/index.ts",
      hono: "src/frameworks/hono/index.ts",
    },
    format: ["cjs", "esm"],
    dts,
    splitting: false,
    sourcemap: false,
    clean: false,
    outDir: "dist",
    target: "node18",
    shims: true,
    minify: true,
    treeshake: true,
    onSuccess: async () => {
      const { copyFileSync } = await import("node:fs");
      copyFileSync("src/parse-worker.cjs", "dist/parse-worker.cjs");
    },
  },
  // Browser entry (no Node.js dependencies)
  {
    entry: {
      browser: "src/browser/index.ts",
    },
    format: ["cjs", "esm"],
    dts,
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
