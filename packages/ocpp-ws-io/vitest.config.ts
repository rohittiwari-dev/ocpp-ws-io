import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Code the CLI generates imports "ocpp-ws-io" by name; its tests load
      // that code from a temporary folder, so the name points at the source.
      {
        find: /^ocpp-ws-io$/,
        replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    include: ["test/**/*.test.ts"],
  },
});
