import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/external/index.ts",
    nest: "src/external/adapters/nest.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
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
