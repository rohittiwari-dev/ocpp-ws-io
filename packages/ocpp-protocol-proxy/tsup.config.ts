import { defineConfig } from "tsup";

// tsup's declaration build always sets `baseUrl`, which TypeScript 6
// reports as deprecated (TS5101). Silenced for that build only.
const dts = { compilerOptions: { ignoreDeprecations: "6.0" } };

// The published paths are kept, so "./presets" and "./adapters" resolve as
// before, now in both module formats.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "presets/index": "src/presets/index.ts",
    "adapters/ocpp-ws-io.adapter": "src/adapters/ocpp-ws-io.adapter.ts",
  },
  format: ["cjs", "esm"],
  target: "node20",
  dts,
  clean: true,
  splitting: false,
});
