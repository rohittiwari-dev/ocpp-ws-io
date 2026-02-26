import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace package to source so tests run without building ocpp-ws-io first (e.g. in CI)
      "ocpp-ws-io": path.resolve(__dirname, "../ocpp-ws-io/src/index.ts"),
    },
  },
  test: {
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    include: ["test/**/*.test.ts"],
  },
});
