// Lists what each entry point of the built package exports: the names its
// type declarations export (as a type or a value) and the keys of its module at
// runtime, through `require` and through `import`. Two runs compared prove that
// a refactor left the public API as it was.
//
// Usage (after a build, from the package root):
//   node scripts/api-snapshot.mjs <out.json>
//   node scripts/api-snapshot.mjs <out.json> --compare <baseline.json>
//   node scripts/api-snapshot.mjs <out.json> --root <another package's folder>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv.splice(i, 2)[1];
};
const rootArg = option("--root");
const own = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = rootArg ? resolve(rootArg) : own;
const require = createRequire(join(root, "package.json"));
const ts = createRequire(join(own, "package.json"))("typescript");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** The types, require and import files of one `exports` entry. */
function filesOf(entry) {
  const pick = (condition) =>
    typeof condition === "string" ? condition : condition?.default;
  return {
    types: entry.import?.types ?? entry.types ?? entry.require?.types,
    require: pick(entry.require),
    import: pick(entry.import),
  };
}

/** Exported names of a declaration file, each marked type or value. */
function declarationExports(program, file) {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`not in the program: ${file}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return [];
  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const kind = target.flags & ts.SymbolFlags.Value ? "value" : "type";
      return `${symbol.getName()}:${kind}`;
    })
    .sort();
}

const entries = Object.entries(pkg.exports).filter(
  ([key]) => key !== "./package.json",
);
const typeFiles = entries.map(([, entry]) =>
  join(root, filesOf(entry).types),
);
const program = ts.createProgram(typeFiles, {
  noEmit: true,
  skipLibCheck: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
});

const snapshot = {};
for (const [key, entry] of entries) {
  const files = filesOf(entry);
  const required = require(join(root, files.require));
  const imported = await import(pathToFileURL(join(root, files.import)).href);
  snapshot[key] = {
    types: declarationExports(program, join(root, files.types)),
    require: Object.keys(required).sort(),
    import: Object.keys(imported).sort(),
  };
}

const [out, flag, baseline] = argv;
if (!out) {
  console.error("usage: node scripts/api-snapshot.mjs <out.json> [--compare <baseline.json>]");
  process.exit(2);
}
writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
const count = (part) =>
  Object.values(snapshot).reduce((n, e) => n + e[part].length, 0);
console.log(
  `${entries.length} entries: ${count("types")} declared exports, ${count("require")} require keys, ${count("import")} import keys`,
);

if (flag === "--compare") {
  const before = JSON.parse(readFileSync(baseline, "utf8"));
  let differences = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(snapshot)])) {
    for (const part of ["types", "require", "import"]) {
      const a = new Set(before[key]?.[part] ?? []);
      const b = new Set(snapshot[key]?.[part] ?? []);
      const gone = [...a].filter((name) => !b.has(name));
      const added = [...b].filter((name) => !a.has(name));
      if (gone.length || added.length) {
        differences++;
        console.log(`${key} ${part}: -[${gone.join(", ")}] +[${added.join(", ")}]`);
      }
    }
  }
  console.log(differences ? `${differences} difference(s)` : "identical to the baseline");
  process.exit(differences ? 1 : 0);
}
