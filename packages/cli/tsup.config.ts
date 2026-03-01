import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
  target: "node18",
  minify: true,
  treeshake: true,
  // Don't bundle deps; load at runtime so ESM bundle doesn't hit "Dynamic require of 'events' is not supported" (CJS deps like ws use require())
  external: ["ws", "cac", "picocolors", "json-schema-to-typescript"],
});
