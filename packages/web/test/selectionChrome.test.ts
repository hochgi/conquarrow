/**
 * `selectionChrome.ts` — what survives of P31 after P34 trimmed it.
 *
 * P31's source → destination → portion ladder died with the `portion` phase, and
 * its min-count numeral and path wash went with it: there is no destination to
 * price and no dialog to wash a path under. Two things survive, and they are
 * asserted here rather than in P34's Gherkin suite because they are P31's
 * behaviour, not P34's:
 *
 * - the **halo** that says *this stack is selected*, in every phase that has a
 *   source (`route` and `blocked` alike);
 * - the **wash constants** the route's faintest tier is drawn at (`route.ts`,
 *   `Board.tsx`) — a mutation to either is a visible paint change with nothing
 *   else watching it.
 *
 * Moved here from the retired `selection-chrome.{core,edge-cases,invariants}`
 * trio; every assertion below was live behaviour in one of them.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mintArrowId } from '@conquarrow/contracts';
import type { ArrowId } from '@conquarrow/contracts';
import type { InputHighlights, InputPhase } from '../src/input/modes';
import {
  REACH_WASH_FLOOR,
  REACH_WASH_PEAK,
  SELECTED_HALO_STROKE,
  SELECTED_STROKE_WIDTH,
  SELECTED_WASH,
  selectionPaint,
  type PointerKind,
} from '../src/selectionChrome';

const from: ArrowId = mintArrowId('p31-from');
const other: ArrowId = mintArrowId('p31-other');

const chromeSource = (): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/selectionChrome.ts'), 'utf8');

const highlights = (selected?: ArrowId): InputHighlights =>
  selected === undefined ? { targets: new Set() } : { selected, targets: new Set() };

const paint = (
  phase: InputPhase,
  selected: ArrowId | undefined,
  pointer: PointerKind = 'fine',
  hoverArrow?: ArrowId,
) =>
  hoverArrow === undefined
    ? selectionPaint({ phase, highlights: highlights(selected), pointer })
    : selectionPaint({ phase, highlights: highlights(selected), pointer, hoverArrow });

describe('selection chrome — the selected halo', () => {
  it('marks a selected source with halo emphasis', () => {
    const marked = paint({ kind: 'blocked', from }, from);
    expect(marked.selected).toBe(from);
    expect(marked.selectedEmphasis).toBe(true);
  });

  it('marks nothing when nothing is selected', () => {
    const bare = paint({ kind: 'idle' }, undefined);
    expect(bare.selected).toBeUndefined();
    expect(bare.selectedEmphasis).toBe(false);
  });

  it('is a halo, not a wash on the reach — the pointer and the hover cannot move it', () => {
    // P31's finding: washing the source made the *reach* read as the selection.
    // Nothing in the paint depends on where the pointer is any more, which is why
    // the hover-leak family of scenarios has no live behaviour left to guard.
    const pointers: readonly PointerKind[] = ['fine', 'coarse'];
    for (const pointer of pointers) {
      for (const hover of [undefined, from, other]) {
        const marked = paint({ kind: 'blocked', from }, from, pointer, hover);
        expect(marked.selected, `pointer=${pointer}`).toBe(from);
        expect(marked.selectedEmphasis).toBe(true);
      }
    }
  });

  it('paints equal inputs equally', () => {
    const left = paint({ kind: 'blocked', from }, from);
    const right = paint({ kind: 'blocked', from }, from);
    expect(left).toEqual(right);
  });
});

describe('selection chrome — the wash constants the route tiers are drawn at', () => {
  it('keeps the quiet peak and floor', () => {
    expect(REACH_WASH_PEAK).toBe(0.22);
    expect(REACH_WASH_FLOOR).toBe(0.08);
    expect(REACH_WASH_FLOOR).toBeLessThan(REACH_WASH_PEAK);
  });

  it('keeps the halo stroke, wash and width', () => {
    expect(SELECTED_HALO_STROKE).toBe('#f4efe4');
    expect(SELECTED_WASH).toBe('rgba(255, 236, 180, 0.30)');
    // P77 widens the marker so it reads on any fill at default zoom (≥ 6).
    expect(SELECTED_STROKE_WIDTH).toBeGreaterThanOrEqual(6);
  });
});

describe('selection chrome — purity', () => {
  it('consults no clock and no randomness, and reaches for no engine', () => {
    const source = chromeSource();
    for (const banned of ['Date.now', 'new Date', 'Math.random', 'performance.now', 'crypto']) {
      expect(source.includes(banned), banned).toBe(false);
    }
    expect(source.includes('rules-core')).toBe(false);
    expect(source.includes('rules.apply')).toBe(false);
  });
});
