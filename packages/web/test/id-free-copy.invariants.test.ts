/**
 * EARS invariants for docs/spec/id-free-copy/id-free-copy.md.
 *
 * Exhaustive over small tables. No GameState, no fast-check.
 */

import { describe, expect, it } from 'vitest';
import { REFUSAL_TEXT, refusalText } from '../src/fx/present';
import { leftoverNote } from '../src/route';
import { mergeButtons, mergeOptions, selectionLine, stripLines } from '../src/selection/status';
import { showingMoves } from '../src/spectate';
import { COMPASS_WORDS, compassWord } from '../src/stackCopy';
import {
  AGENT_PROMPT_ALLOWLIST,
  centres,
  headsTable,
  idSentences,
  ids,
  webSources,
} from './id-free-copy.support';

const ID_NAMES = ['tiling:a:1,-2,2', 'tiling:a:0,-2,0', 'tiling:a:2,-3,0'] as const;
const ARROWS = ids(...ID_NAMES);
const BOOLS = [false, true] as const;
const noId = (text: string): void => {
  for (const name of ID_NAMES) expect(text.includes(name), text).toBe(false);
  expect(text.includes('tiling:'), text).toBe(false);
};

describe('id-free-copy invariants', () => {
  it('1. no produced string carries an arrow id', () => {
    const [a, b, c] = ARROWS;
    if (a === undefined || b === undefined || c === undefined) throw new Error('setup');
    for (const selected of [undefined, a, b, c]) {
      for (const heads of [0, 1, 2, 7]) {
        for (const movable of [[], [a], [a, b, c], [c, b]]) {
          noId(selectionLine({ selected, heads, movable }));
          for (const locked of BOOLS) {
            const lines = stripLines({ locked, selected, heads, movable, refusal: undefined });
            noId(lines.selection);
            noId(lines.message);
          }
        }
      }
      for (const reason of Object.keys(REFUSAL_TEXT) as (keyof typeof REFUSAL_TEXT)[]) {
        noId(refusalText(reason, selected));
      }
      for (const option of mergeOptions({
        merges: new Set([a, b, c]),
        locked: false,
        selected,
        headsOf: headsTable({ [ID_NAMES[1]]: 2 }),
        centreOf: centres({ [ID_NAMES[0]]: { x: 1, y: 2 }, [ID_NAMES[2]]: { x: -3, y: 0 } }),
      })) {
        noId(option.label);
      }
    }
    for (let ceiling = 0; ceiling <= 4; ceiling += 1) {
      for (let count = 0; count <= 5; count += 1) noId(leftoverNote({ count, ceiling }));
    }
  });

  it('2. the label carries a direction exactly when there is one', () => {
    const [s, t] = ARROWS;
    if (s === undefined || t === undefined) throw new Error('setup');
    const points = [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((y) => ({ x, y })));
    for (const p of points) {
      for (const selected of [undefined, s]) {
        const [option] = mergeOptions({
          merges: new Set([t]),
          locked: false,
          selected,
          headsOf: headsTable({ [ID_NAMES[1]]: 3 }),
          centreOf: centres({ [ID_NAMES[0]]: { x: 0, y: 0 }, [ID_NAMES[1]]: p }),
        });
        const word = selected === undefined ? undefined : compassWord({ x: 0, y: 0 }, p);
        expect(option?.label).toBe(
          word === undefined ? 'Merge into your 3-stack' : `Merge into your 3-stack, ${word}`,
        );
      }
    }
  });

  it('3. options follow mergeButtons order and lock', () => {
    const merges = new Set([...ARROWS].reverse());
    for (const locked of BOOLS) {
      for (const set of [undefined, merges, new Set<(typeof ARROWS)[number]>()]) {
        expect(
          mergeOptions({
            merges: set,
            locked,
            selected: ARROWS[0],
            headsOf: headsTable({}),
            centreOf: centres({}),
          }).map((o) => o.arrow),
        ).toEqual(mergeButtons(set, locked));
      }
    }
  });

  it('4. compass words are total on distinct points and antisymmetric', () => {
    const opposite = new Map([
      ['right', 'left'],
      ['down-right', 'up-left'],
      ['down', 'up'],
      ['down-left', 'up-right'],
    ]);
    for (const [k, v] of [...opposite]) opposite.set(v, k);
    for (let x = -3; x <= 3; x += 1) {
      for (let y = -3; y <= 3; y += 1) {
        const word = compassWord({ x: 0, y: 0 }, { x, y });
        if (x === 0 && y === 0) {
          expect(word).toBeUndefined();
          continue;
        }
        expect(COMPASS_WORDS).toContain(word);
        expect(compassWord({ x, y }, { x: 0, y: 0 })).toBe(opposite.get(word ?? ''));
      }
    }
  });

  it('5. showing moves is the or of its inputs', () => {
    for (const replaying of BOOLS) {
      for (const localPlayback of BOOLS) {
        for (const pendingReplays of [0, 1, 3]) {
          expect(showingMoves({ replaying, pendingReplays, localPlayback })).toBe(
            replaying || localPlayback || pendingReplays > 0,
          );
        }
      }
    }
  });

  it('6. no web sentence template splices an arrow id', () => {
    const offenders = webSources()
      .filter(({ file }) => !AGENT_PROMPT_ALLOWLIST.has(file))
      .flatMap(({ file, code }) => idSentences(code).map((t) => `${file}: ${t}`));
    expect(offenders).toEqual([]);
  });

  it('6a. the scan itself catches the shapes it is for', () => {
    expect(idSentences('const s = `Merge into ${String(arrow)}`;')).toHaveLength(1);
    expect(idSentences('`Selected: ${String(heads)} on ${String(selected)}`')).toHaveLength(1);
    expect(idSentences('`${heads} on ${String(opts.start)}`')).toHaveLength(1);
    expect(idSentences('`step:${String(move.from)}>${String(move.exit)}`')).toHaveLength(0);
    expect(idSentences('`fx-${String(seq)}-refusal-${String(arrow)}`')).toHaveLength(0);
    expect(idSentences('`${String(heads)} heads`')).toHaveLength(0);
  });

  it('6b. the agent prompt still carries ids (MCP and BYOK keep their context)', () => {
    const targets = webSources().find(({ file }) => file === 'targets.ts');
    expect(targets === undefined ? [] : idSentences(targets.code).length).toBeGreaterThan(0);
  });
});
