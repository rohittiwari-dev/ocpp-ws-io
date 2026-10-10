#!/usr/bin/env node
/**
 * third-party-notices.js
 *
 * The CLI (dist/cli.mjs) bundles its dependencies, so their licences must
 * ship with it. Reads the CLI build's metafile, finds every npm package whose
 * code went into the bundle, and writes dist/THIRD_PARTY_NOTICES.md with each
 * one's name, version, licence and licence text. The metafile is removed so
 * it is not published.
 *
 * Fails the build if the metafile is missing or a bundled package has no
 * licence text to copy.
 */

const { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } =
  require("node:fs");
const { join, resolve } = require("node:path");

const pkgDir = resolve(__dirname, "..");
const metafilePath = join(pkgDir, "dist", "metafile-esm.json");
const outPath = join(pkgDir, "dist", "THIRD_PARTY_NOTICES.md");

if (!existsSync(metafilePath)) {
  console.error(
    `third-party-notices: ${metafilePath} is missing; the CLI build must set metafile: true.`,
  );
  process.exit(1);
}

const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));

/** The package folder an input path belongs to, from its last node_modules segment. */
function packageDirOf(input) {
  const parts = input.split(/[\\/]/);
  const at = parts.lastIndexOf("node_modules");
  if (at === -1) return null;
  const nameParts = parts[at + 1]?.startsWith("@") ? 2 : 1;
  return resolve(pkgDir, ...parts.slice(0, at + 1 + nameParts));
}

const dirs = new Set();
for (const input of Object.keys(metafile.inputs)) {
  const dir = packageDirOf(input);
  if (dir) dirs.add(dir);
}

const packages = [...dirs]
  .map((dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const licenceFile = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
    if (!licenceFile) {
      console.error(
        `third-party-notices: ${manifest.name}@${manifest.version} has no licence file to copy.`,
      );
      process.exit(1);
    }
    return {
      name: manifest.name,
      version: manifest.version,
      license: manifest.license ?? "see text",
      text: readFileSync(join(dir, licenceFile), "utf8").trim(),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

if (packages.length === 0) {
  console.error("third-party-notices: the CLI bundle names no npm packages.");
  process.exit(1);
}

const sections = packages.map(
  (p) => `## ${p.name}@${p.version} (${p.license})\n\n\`\`\`\n${p.text}\n\`\`\``,
);
writeFileSync(
  outPath,
  [
    "# Third-party notices",
    "",
    "`dist/cli.mjs`, the `ocpp` command, bundles the following packages. Their licences follow.",
    "",
    ...sections.join("\n\n").split("\n"),
    "",
  ].join("\n"),
);
rmSync(metafilePath);
console.log(`third-party-notices: ok (${packages.length} packages)`);
