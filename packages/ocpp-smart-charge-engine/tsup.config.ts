import { defineConfig } from "tsup";

// tsup's declaration build always sets `baseUrl`, which TypeScript 6
// reports as deprecated (TS5101). Silenced for that build only.
const dts = { compilerOptions: { ignoreDeprecations: "6.0" } };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "strategies/index": "src/strategies/index.ts",
    builders: "src/builders.ts",
  },
  format: ["cjs", "esm"],
  dts,
  splitting: false,
  sourcemap: false,
  clean: true,
  shims: true,
  minify: true,
  treeshake: true,
  target: "node18",
  outDir: "dist",
});
