#!/usr/bin/env node
/**
 * verify-dist.js
 *
 * Fails the build if any file referenced by package.json "exports",
 * "main", "module" or "types" is missing from dist/.
 *
 * Guards against silent publishes of an incomplete dist (e.g. a missing
 * subpath .d.ts, which makes TypeScript consumers fall back to `any`).
 */

const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

const pkgDir = resolve(__dirname, "..");
const pkg = require(join(pkgDir, "package.json"));

const expected = new Set();

const collect = (value) => {
  if (typeof value === "string") {
    if (value.startsWith("./")) expected.add(value.slice(2));
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) collect(nested);
  }
};

collect(pkg.exports);
for (const field of ["main", "module", "types"]) {
  if (pkg[field]) expected.add(pkg[field].replace(/^\.\//, ""));
}

const missing = [...expected].filter((rel) => !existsSync(join(pkgDir, rel)));

if (missing.length > 0) {
  console.error(
    `\nverify-dist: ${missing.length} file(s) declared in package.json are missing from the build:`,
  );
  for (const rel of missing) console.error(`  - ${rel}`);
  console.error("");
  process.exit(1);
}

console.log(`verify-dist: ok (${expected.size} declared files present)`);
