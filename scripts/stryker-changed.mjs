#!/usr/bin/env node
/**
 * Scoped mutation run: mutate only the source lines this branch changed, with
 * only the tests that can reach them. Every change gets a Stryker run; the
 * whole-package configs are for baselines.
 *
 *   pnpm test:mutation:changed [--base <ref>] [--dry]
 *
 * 1. Base = merge-base of HEAD and `--base` (default: the first of
 *    `hochgi/main`, `upstream/main`, `origin/main` that exists). The diff is
 *    base → working tree, so uncommitted edits count.
 * 2. Mutate = every changed or added line range in `packages/<pkg>/src/**`
 *    `.ts` / `.tsx`, barrels (`src/index.ts`) excepted. Pure deletions add no
 *    range. Passed to Stryker as one `--mutate 'file:start-end,…'`.
 * 3. Tests = every `packages/<pkg>/test/**\/*.test.ts` whose static runtime
 *    import closure reaches a mutated file. `import type` is skipped. A named
 *    import from a package barrel follows only the files that export those
 *    names, so a contracts edit does not drag in every test in the repo.
 *    Written to `vitest.changed.config.mjs` (gitignored) for
 *    `stryker.changed.config.json`.
 * 4. Exit 1 when there is nothing to mutate or no test reaches it — a change
 *    to source with no mutants is a failure, not a pass. Exit 2 when any
 *    mutant survived or had no coverage. Exit 0 only when every mutant was
 *    killed, timed out, or is suppressed with a `// Stryker disable` comment
 *    that states why.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const dry = args.includes('--dry');

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const refExists = (ref) => {
  try {
    git('rev-parse', '--verify', '--quiet', ref);
    return true;
  } catch {
    return false;
  }
};

const baseRef =
  flag('--base') ?? ['hochgi/main', 'upstream/main', 'origin/main'].find(refExists);
if (baseRef === undefined) {
  console.error('stryker-changed: no base ref; pass --base <ref>');
  process.exit(1);
}
const base = git('merge-base', 'HEAD', baseRef);

// ---- 2. changed line ranges ------------------------------------------------
const isSource = (file) =>
  /^packages\/[^/]+\/src\/.+\.tsx?$/.test(file) &&
  !/\/src\/index\.ts$/.test(file) &&
  !file.endsWith('.d.ts');

const diff = git('diff', '-U0', '--no-color', '--no-ext-diff', base, '--', 'packages');
const ranges = new Map();
let current;
for (const line of diff.split('\n')) {
  const file = /^\+\+\+ b\/(.+)$/.exec(line);
  if (file) {
    current = isSource(file[1]) ? file[1] : undefined;
    continue;
  }
  if (line.startsWith('+++ /dev/null')) current = undefined;
  const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (hunk && current !== undefined) {
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count === 0) continue;
    if (!ranges.has(current)) ranges.set(current, []);
    ranges.get(current).push([start, start + count - 1]);
  }
}
// Untracked new source files: the whole file.
for (const file of git('ls-files', '--others', '--exclude-standard', 'packages').split('\n')) {
  if (file && isSource(file)) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n').length;
    ranges.set(file, [[1, lines]]);
  }
}

if (ranges.size === 0) {
  console.error(`stryker-changed: no changed source lines under packages/*/src since ${baseRef} — nothing to mutate is a failure, not a pass.`);
  process.exit(1);
}

// ---- 3. tests that reach a mutated file ------------------------------------
const pkgExports = new Map();
for (const pkg of readdirSync(join(root, 'packages'))) {
  const pj = join(root, 'packages', pkg, 'package.json');
  if (!existsSync(pj)) continue;
  const json = JSON.parse(readFileSync(pj, 'utf8'));
  const exp = json.exports ?? { '.': json.main ?? './src/index.ts' };
  const map = typeof exp === 'string' ? { '.': exp } : exp;
  for (const [sub, target] of Object.entries(map)) {
    const t = typeof target === 'string' ? target : target.import ?? target.default;
    if (typeof t !== 'string') continue;
    const spec = sub === '.' ? json.name : `${json.name}/${sub.replace(/^\.\//, '')}`;
    pkgExports.set(spec, relative(root, join(root, 'packages', pkg, t)));
  }
}

const asFile = (abs) => {
  for (const cand of [abs, `${abs}.ts`, `${abs}.tsx`, join(abs, 'index.ts')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return relative(root, cand);
  }
  return undefined;
};
const resolveSpec = (from, spec) => {
  if (spec.startsWith('.')) return asFile(resolve(root, dirname(from), spec.replace(/\.js$/, '')));
  return pkgExports.get(spec);
};

const IMPORT_RE =
  /(?:^|\n|;)\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
const namesOf = (clause) => {
  const m = /\{([\s\S]*)\}/.exec(clause);
  if (!m || /\*|^\s*[A-Za-z_$][\w$]*\s*,/.test(clause.replace(/\{[\s\S]*\}/, ''))) {
    if (!m) return undefined; // namespace or default: the whole module
  }
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('type '))
    .map((s) => s.split(/\s+as\s+/)[0].trim());
};

const parsed = new Map();
const parse = (file) => {
  if (parsed.has(file)) return parsed.get(file);
  const text = readFileSync(join(root, file), 'utf8');
  const edges = []; // { target, names | undefined }
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[4] ?? m[5] ?? m[6];
    const target = resolveSpec(file, spec);
    if (target === undefined) continue;
    if (m[2]) continue; // import type / export type
    const names = m[3] === undefined ? undefined : namesOf(m[3]);
    if (names !== undefined && names.length === 0) continue; // only `type` names
    edges.push({ target, names, reexport: m[1] === 'export' });
  }
  const result = { edges };
  parsed.set(file, result);
  return result;
};

/** For a barrel-like file: the files that runtime-export `name`. */
const providersOf = (file, name) => {
  const out = [];
  for (const e of parse(file).edges) {
    if (!e.reexport) continue;
    if (e.names === undefined || e.names.includes(name)) out.push(e.target);
  }
  return out;
};

const closure = (start) => {
  const seen = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const e of parse(file).edges) {
      const isBarrel = /\/src\/(testing\/)?index\.ts$/.test(e.target);
      if (isBarrel && e.names !== undefined && !e.reexport) {
        for (const n of e.names) for (const p of providersOf(e.target, n)) stack.push(p);
      } else {
        stack.push(e.target);
      }
    }
  }
  return seen;
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
const tests = readdirSync(join(root, 'packages'))
  .map((p) => join(root, 'packages', p, 'test'))
  .filter((d) => existsSync(d))
  .flatMap(walk)
  .map((f) => relative(root, f))
  .filter((f) => f.endsWith('.test.ts'));

const mutated = new Set(ranges.keys());
const selected = tests.filter((t) => [...closure(t)].some((f) => mutated.has(f)));

const mutate = [...ranges].flatMap(([file, rs]) => rs.map(([a, b]) => `${file}:${a}-${b}`));
console.log(`stryker-changed: base ${baseRef} (${base.slice(0, 7)})`);
console.log(`  mutate (${mutate.length} ranges in ${ranges.size} files):`);
for (const m of mutate) console.log(`    ${m}`);
console.log(`  tests (${selected.length}):`);
for (const t of selected) console.log(`    ${t}`);

if (selected.length === 0) {
  console.error('stryker-changed: no test reaches the changed source — every mutant would be NoCoverage. Failure.');
  process.exit(1);
}

writeFileSync(
  join(root, 'vitest.changed.config.mjs'),
  `// Generated by scripts/stryker-changed.mjs — do not edit, do not commit.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { docs: resolve(repoRoot, 'docs') } },
  test: {
    include: ${JSON.stringify(selected, null, 2).replace(/\n/g, '\n    ')},
    environment: 'node',
    globals: false,
  },
});
`,
);
if (dry) process.exit(0);

// ---- 4. run and judge -------------------------------------------------------
const run = spawnSync(
  'pnpm',
  ['exec', 'stryker', 'run', 'stryker.changed.config.json', '--mutate', mutate.join(',')],
  { cwd: root, stdio: 'inherit' },
);
if (run.status !== 0) process.exit(run.status ?? 1);

const report = JSON.parse(
  readFileSync(join(root, 'reports/mutation-changed/mutation.json'), 'utf8'),
);
const counts = {};
const bad = [];
for (const [file, entry] of Object.entries(report.files)) {
  for (const m of entry.mutants) {
    counts[m.status] = (counts[m.status] ?? 0) + 1;
    if (m.status === 'Survived' || m.status === 'NoCoverage') {
      bad.push(`${m.status} ${relative(root, resolve(root, file))}:${m.location.start.line}:${m.location.start.column} ${m.mutatorName} → ${JSON.stringify(m.replacement ?? '')}`);
    }
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (total === 0) {
  console.error('stryker-changed: Stryker produced zero mutants for the changed lines — failure, not a pass.');
  process.exit(1);
}
const detected = (counts.Killed ?? 0) + (counts.Timeout ?? 0);
const valid = detected + (counts.Survived ?? 0) + (counts.NoCoverage ?? 0);
console.log(`\nstryker-changed: ${JSON.stringify(counts)}`);
console.log(`stryker-changed: score ${valid === 0 ? 'n/a' : ((100 * detected) / valid).toFixed(2)}% (${detected}/${valid} detected; ignored ${counts.Ignored ?? 0})`);
if (bad.length > 0) {
  console.error(`stryker-changed: ${bad.length} survivor(s) — kill each with a test or suppress it with its invariant:`);
  for (const b of bad) console.error(`  ${b}`);
  process.exit(2);
}
console.log('stryker-changed: PASS — no survivors on the changed lines.');
