/**
 * Shared helpers for docs/spec/id-free-copy (P103). Pure: ids are minted, the
 * source scan reads files, nothing touches a DOM.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintArrowId, type ArrowId } from '@conquarrow/contracts';

export const ids = (...names: readonly string[]): readonly ArrowId[] => names.map(mintArrowId);

export const id = (name: string): ArrowId => mintArrowId(name);

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** A centre table keyed by the id's string. Missing ids sit at the origin. */
export const centres =
  (table: Readonly<Record<string, Pt>>) =>
  (arrow: ArrowId): Pt =>
    table[String(arrow)] ?? { x: 0, y: 0 };

/** A heads table keyed by the id's string. Missing ids read 0. */
export const headsTable =
  (table: Readonly<Record<string, number>>) =>
  (arrow: ArrowId): number =>
    table[String(arrow)] ?? 0;

// ---------------------------------------------------------------------------
// Source scan (invariant 6)
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
export const srcRoot = join(here, '../src');

const walk = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

/** Every web source file, relative to `src`, with comments stripped. */
export const webSources = (): readonly { readonly file: string; readonly code: string }[] =>
  walk(srcRoot).map((path) => ({
    file: relative(srcRoot, path),
    code: readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));

/**
 * Agent-facing text, not player copy. MCP and BYOK agents read ids on purpose
 * and must keep getting the same context, so these stay out of the scan.
 */
export const AGENT_PROMPT_ALLOWLIST: ReadonlySet<string> = new Set(['targets.ts']);

/** Names that hold an `ArrowId` across web code. */
const ARROWISH = '(?:[\\w.]*\\.)?(?:arrow|selected|start|cell|target|from|exit|goal|at|tip|head)';

/** A template literal (one line) that interpolates `String(<arrow-ish>)`. */
const TEMPLATE = new RegExp(`\`[^\`\\n]*\\$\\{String\\(${ARROWISH}\\)\\}[^\`\\n]*\``, 'g');

/** Literal text of a template: the `${…}` holes removed. */
const literalText = (template: string): string => template.replace(/\$\{[^}]*\}/g, '');

/**
 * Templates that read as a sentence — their literal text has a space — and
 * splice an arrow id in. Keys like `step:${…}>${…}` have no space and are not copy.
 */
export const idSentences = (code: string): readonly string[] =>
  [...code.matchAll(TEMPLATE)]
    .map((m) => m[0])
    .filter((template) => /\s/.test(literalText(template).slice(1, -1)));
