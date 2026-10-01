import { defineConfig } from "tsup";

// tsup's declaration build always sets `baseUrl`, which TypeScript 6
// reports as deprecated (TS5101). Silenced for that build only.
const dts = { compilerOptions: { ignoreDeprecations: "6.0" } };

export default defineConfig({
  entry: {
    index: "src/external/index.ts",
    nest: "src/external/adapters/nest.ts",
  },
  format: ["cjs", "esm"],
  dts,
  splitting: false,
  sourcemap: false,
  clean: false,
  outDir: "dist",
  target: "node18",
  shims: true,
  treeshake: true,
  tsconfig: "tsconfig.external.json",
  external: ["ocpp-ws-io"],
});
