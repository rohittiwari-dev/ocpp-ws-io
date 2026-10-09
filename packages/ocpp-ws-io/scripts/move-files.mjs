// Consolidation tool (see the Consolidation Plan): moves files or folders with
// `git mv` and rewrites every relative path that pointed at them, in src/,
// test/, scripts/ and the build configs. A path is any quoted string starting
// with ./ or ../ (imports, vi.mock, new URL, path.join), with or without its
// extension; in tsup.config.ts also "src/..." paths. Files that moved get their
// own relative paths recomputed. Remove this script once the plan is done.
//
// Usage, paths relative to the package root:
//   node scripts/move-files.mjs [--dry-run] <from> <to> [<from> <to> ...]
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toPosix = (p) => p.split(sep).join("/");
const abs = (p) => toPosix(resolve(root, p));

const args = process.argv.slice(2);
const dryRun = args[0] === "--dry-run";
const pairs = dryRun ? args.slice(1) : args;
if (pairs.length === 0 || pairs.length % 2 !== 0) {
  console.error("usage: node scripts/move-files.mjs [--dry-run] <from> <to> [...]");
  process.exit(2);
}

const EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"];
const stripExt = (p) => {
  const ext = EXTENSIONS.find((e) => p.endsWith(e));
  return ext ? { base: p.slice(0, -ext.length), ext } : { base: p, ext: "" };
};

/** Each move: a file (matched by its path without extension) or a folder. */
const moves = [];
for (let i = 0; i < pairs.length; i += 2) {
  const from = abs(pairs[i]);
  const to = abs(pairs[i + 1]);
  if (!existsSync(from)) throw new Error(`does not exist: ${pairs[i]}`);
  if (existsSync(to)) throw new Error(`already exists: ${pairs[i + 1]}`);
  const isDir = statSync(from).isDirectory();
  moves.push(
    isDir
      ? { isDir, from, to }
      : { isDir, from, to, fromBase: stripExt(from).base, toBase: stripExt(to).base },
  );
}

/** Where an absolute path (a file, a folder, or a file without extension) ends up. */
function moved(path) {
  for (const m of moves) {
    if (m.isDir) {
      if (path === m.from) return m.to;
      if (path.startsWith(`${m.from}/`)) return m.to + path.slice(m.from.length);
    } else {
      if (path === m.from) return m.to;
      const { base, ext } = stripExt(path);
      if (base === m.fromBase) return m.toBase + ext;
    }
  }
  return path;
}

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(name)) out.push(toPosix(full));
  }
  return out;
}
const files = [
  ...walk(join(root, "src"), []),
  ...walk(join(root, "test"), []),
  ...walk(join(root, "scripts"), []),
  ...["tsup.config.ts", "vitest.config.ts", "vitest.config.mts"]
    .map((f) => abs(f))
    .filter((f) => existsSync(f)),
];

const relativeSpec = (fromFile, target) => {
  const rel = posix.relative(posix.dirname(fromFile), target);
  return rel.startsWith(".") ? rel : `./${rel}`;
};

let rewrittenFiles = 0;
let rewrittenPaths = 0;
const writes = [];
for (const oldFile of files) {
  const newFile = moved(oldFile);
  const text = readFileSync(oldFile, "utf8");
  let changed = 0;
  let next = text.replace(/(["'])(\.{1,2}\/[^"'\n]*)\1/g, (match, quote, spec) => {
    const target = posix.normalize(posix.join(posix.dirname(oldFile), spec));
    const newTarget = moved(target);
    if (newTarget === target && newFile === oldFile) return match;
    let rewritten = relativeSpec(newFile, newTarget);
    if (spec.endsWith("/") && !rewritten.endsWith("/")) rewritten += "/";
    if (rewritten === spec) return match;
    changed++;
    return `${quote}${rewritten}${quote}`;
  });
  if (/(^|\/)(tsup|vitest)\.config\.m?ts$/.test(oldFile)) {
    next = next.replace(/(["'])(src\/[^"'\n]*)\1/g, (match, quote, spec) => {
      const newTarget = moved(abs(spec));
      if (newTarget === abs(spec)) return match;
      changed++;
      return `${quote}${toPosix(relative(root, newTarget))}${quote}`;
    });
  }
  if (changed || newFile !== oldFile) writes.push({ newFile, next, changed });
  if (changed) {
    rewrittenFiles++;
    rewrittenPaths += changed;
  }
}

console.log(
  `${moves.length} move(s); ${rewrittenPaths} path(s) rewritten in ${rewrittenFiles} file(s)`,
);
if (dryRun) {
  for (const w of writes.filter((w) => w.changed))
    console.log(`  ${toPosix(relative(root, w.newFile))}: ${w.changed}`);
  process.exit(0);
}

for (const m of moves) {
  mkdirSync(dirname(m.to), { recursive: true });
  execFileSync("git", ["mv", m.from, m.to], { cwd: root });
}
for (const w of writes) writeFileSync(w.newFile, w.next);

// Any relative path left that points at nothing is printed for a manual look.
const exists = (p) =>
  existsSync(p) ||
  [".ts", ".js", ".cjs", ".json", "/index.ts"].some((e) => existsSync(p + e)) ||
  (/\.(m|c)?js$/.test(p) && existsSync(p.replace(/\.(m|c)?js$/, ".ts")));
let dangling = 0;
for (const w of writes.length ? files.map(moved) : []) {
  const text = readFileSync(w, "utf8");
  for (const [, , spec] of text.matchAll(/(["'])(\.{1,2}\/[^"'\n]*)\1/g)) {
    const target = posix.normalize(posix.join(posix.dirname(w), spec));
    if (!exists(target) && /\.(ts|js|cjs|json)$|^\.\.?\/[^.]*$/.test(spec)) {
      dangling++;
      console.log(`  check: ${toPosix(relative(root, w))} -> ${spec}`);
    }
  }
}
console.log(dangling ? `${dangling} path(s) to check` : "every rewritten path resolves");
