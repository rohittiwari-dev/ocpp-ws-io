import { defineConfig } from "tsup";

export default defineConfig([
  // Node.js entries (server, client, adapters)
  {
    entry: {
      index: "src/index.ts",
      "adapters/redis": "src/adapters/redis/index.ts",
      logger: "src/logger/index.ts",
      plugins: "src/plugins/index.ts",
    },
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: true,
    outDir: "dist",
    target: "node18",
    shims: true,
    minify: true,
    treeshake: true,
  },
  // Browser entry (no Node.js dependencies)
  {
    entry: {
      browser: "src/browser/index.ts",
    },
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: false,
    outDir: "dist",
    target: "esnext",
    platform: "browser",
    minify: true,
    treeshake: true,
  },
]);
