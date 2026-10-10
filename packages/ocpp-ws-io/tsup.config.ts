import { defineConfig } from "tsup";

// tsup's declaration build always sets `baseUrl`, which TypeScript 6
// reports as deprecated (TS5101). Silenced for that build only; tsc itself
// still type-checks without it. The smart-charge engine uses Node's own
// globals (node:events, setInterval), which that build does not load unless
// asked; the rest reached them through ws's types.
const dts = { compilerOptions: { ignoreDeprecations: "6.0", types: ["node"] } };

const nodeEntries = {
  index: "src/index.ts",
  "adapters/redis": "src/adapters/redis/index.ts",
  logger: "src/logger/index.ts",
  plugins: "src/plugins/index.ts",
  express: "src/frameworks/express/index.ts",
  nestjs: "src/frameworks/nestjs/index.ts",
  fastify: "src/frameworks/fastify/index.ts",
  hono: "src/frameworks/hono/index.ts",
  "smart-charge": "src/smart-charge/index.ts",
  "smart-charge/strategies": "src/smart-charge/strategies/index.ts",
  "smart-charge/builders": "src/smart-charge/builders.ts",
  proxy: "src/proxy/index.ts",
  "proxy/presets": "src/proxy/presets/index.ts",
  "proxy/adapters": "src/proxy/adapters/ocpp-ws-io.adapter.ts",
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
  // The CLI (bin "ocpp"): one ESM file with its own dependencies bundled in,
  // so the library gains none at runtime. `ws` stays out, being one already.
  {
    entry: {
      cli: "src/cli/index.ts",
    },
    format: ["esm"],
    dts: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    outDir: "dist",
    target: "node20",
    platform: "node",
    minify: true,
    treeshake: true,
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
