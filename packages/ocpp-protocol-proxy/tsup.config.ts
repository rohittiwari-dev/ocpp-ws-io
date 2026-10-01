import { defineConfig } from "tsup";

// tsup's declaration build always sets `baseUrl`, which TypeScript 6
// reports as deprecated (TS5101). Silenced for that build only.
const dts = { compilerOptions: { ignoreDeprecations: "6.0" } };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts,
  clean: true,
  splitting: false,
});
