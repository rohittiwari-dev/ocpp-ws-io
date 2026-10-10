#!/usr/bin/env node
/**
 * generate-types.js
 *
 * Writes the library's OCPP types, src/generated/*.ts, from its JSON
 * schemas. The generator is TypeScript, in src/codegen, and `ocpp generate`
 * uses the same one; this builds it with tsup into node_modules/.cache and
 * runs it.
 *
 * Usage:  node scripts/generate-types.js   (or: npm run generate)
 * Output: src/generated/ocpp16.ts, ocpp201.ts, ocpp21.ts, index.ts
 */

const path = require("node:path");
const { build } = require("tsup");

const packageDir = path.resolve(__dirname, "..");
const outDir = path.join(packageDir, "node_modules", ".cache", "ocpp-codegen");

build({
  entry: { library: path.join(packageDir, "src", "codegen", "library.ts") },
  format: ["cjs"],
  platform: "node",
  target: "node20",
  outDir,
  tsconfig: path.join(packageDir, "tsconfig.json"),
  config: false,
  dts: false,
  clean: true,
  silent: true,
})
  .then(() => {
    require(path.join(outDir, "library.js")).generateLibraryTypes(packageDir);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
