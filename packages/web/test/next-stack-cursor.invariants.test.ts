/**
 * EARS invariants for docs/spec/next-stack-cursor/next-stack-cursor.md — P50.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/botPlayback.invariants.test.ts).
 */

import { describe, expect, it } from 'vitest';
import type { ArrowId } from '@conquarrow/contracts';
import {
  advanceCursor,
  emptyRecency,
  movableArrows,
  pushRecency,
  turnAnchor,
} from '../src/selection/cursor';
import {
  A,
  appSource,
  arrow,
  arrows,
  codeOf,
  hudSource,
  stubRules,
  stubRulesOrdered,
  stubRulesWithDuplicates,
  stubState,
} from './next-stack-cursor.support';

/** Deterministic id pools — no Math.random anywhere in this suite. */
const pool = (n: number): readonly string[] =>
  Array.from({ length: n }, (_, i) => `a${String(i + 1)}`);

const rotations = <T,>(xs: readonly T[]): readonly (readonly T[])[] =>
  xs.map((_, i) => [...xs.slice(i), ...xs.slice(0, i)]);

describe('next-stack-cursor invariants', () => {
  it('1. The system shall place the cursor only on a movable arrow, or on nothing.', () => {
    for (const size of [0, 1, 2, 3, 5, 8]) {
      const movable = arrows(...pool(size));
      const keys = new Set(movable.map(String));
      const starts: (ArrowId | undefined)[] = [undefined, arrow('zz'), ...movable];
      for (const start of starts) {
        for (const committed of [
          undefined,
          { from: arrow('a1'), exit: arrow('zz') },
          { from: arrow('zz'), exit: arrow('a1') },
          { from: arrow('a2'), exit: arrow('a3') },
        ]) {
          const next =
            committed === undefined
              ? advanceCursor(start, movable)
              : advanceCursor(start, movable, committed);
          const label = `size=${String(size)} start=${String(start)}`;
          if (size === 0) {
            expect(next, label).toBeUndefined();
            continue;
          }
          // Invariant 6's contrapositive: something is movable, so the cursor
          // lands on an arrow — and only ever on a movable one.
          expect(next, label).toBeDefined();
          expect(keys.has(String(next)), label).toBe(true);
        }
      }
    }
  });

  it('2. The system shall visit every movable arrow at least once before visiting any a second time, given a stable movable set.', () => {
    for (const size of [1, 2, 3, 4, 7]) {
      const movable = arrows(...pool(size));
      for (const start of [undefined, ...movable]) {
        const seen: string[] = [];
        let at = start;
        for (let i = 0; i < size; i += 1) {
          at = advanceCursor(at, movable);
          seen.push(String(at));
        }
        expect(new Set(seen).size, `size=${String(size)} start=${String(start)}`).toBe(size);
      }
    }
  });

  it('3. When Next stack is pressed, the system shall emit no move and shall leave the GameState identical.', () => {
    const state = stubState();
    const snapshot = JSON.stringify(state);
    const movable = movableArrows(stubRules('a1', 'a2', 'a3'), state);
    let at: ArrowId | undefined;
    for (let i = 0; i < 6; i += 1) at = advanceCursor(at, movable);
    expect(at).toBeDefined();
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('4. When a turn begins for a seat whose recency stack holds a still-movable arrow, the cursor is the most recently acted such arrow.', () => {
    const cases = [
      { acted: ['a1', 'a2', 'a3'], movable: ['a1', 'a2', 'a3'], want: 'a3' },
      { acted: ['a1', 'a2', 'a3'], movable: ['a1', 'a2'], want: 'a2' },
      { acted: ['a1', 'a2', 'a3'], movable: ['a1', 'a5'], want: 'a1' },
      { acted: ['a3', 'a1'], movable: ['a1', 'a3'], want: 'a1' },
      { acted: ['a1', 'a2', 'a1'], movable: ['a1', 'a2'], want: 'a1' },
    ] as const;
    for (const { acted, movable, want } of cases) {
      let recency = emptyRecency();
      for (const id of acted) recency = pushRecency(recency, A, arrow(id));
      const { cursor } = turnAnchor(recency, A, arrows(...movable));
      expect(cursor, acted.join('>')).toBe(arrow(want));
    }
  });

  it('5. When a turn begins for a seat whose recency stack is empty or holds no movable arrow, the cursor is the first movable arrow in baseline order.', () => {
    const cases = [
      { acted: [] as readonly string[], movable: ['a2', 'a1'], want: 'a1' },
      { acted: ['a9'], movable: ['a7', 'a5'], want: 'a5' },
      { acted: ['a9', 'a8'], movable: ['a3'], want: 'a3' },
    ] as const;
    for (const { acted, movable, want } of cases) {
      let recency = emptyRecency();
      for (const id of acted) recency = pushRecency(recency, A, arrow(id));
      const { cursor } = turnAnchor(recency, A, arrows(...movable));
      expect(cursor, acted.join('>')).toBe(arrow(want));
    }
  });

  it('6. While no arrow is movable, the system shall place the cursor on nothing.', () => {
    let recency = emptyRecency();
    for (const id of ['a1', 'a2']) recency = pushRecency(recency, A, arrow(id));
    expect(turnAnchor(recency, A, []).cursor).toBeUndefined();
    expect(turnAnchor(emptyRecency(), A, []).cursor).toBeUndefined();
    expect(advanceCursor(arrow('a1'), [])).toBeUndefined();
    expect(advanceCursor(undefined, [])).toBeUndefined();
    expect(
      advanceCursor(arrow('a1'), [], { from: arrow('a1'), exit: arrow('a9') }),
    ).toBeUndefined();
  });

  it('7. If a committed step leaves a movable stack at its destination, the cursor shall be that destination.', () => {
    const cases = [
      { movable: ['a1', 'a9'], from: 'a1', exit: 'a9' },
      { movable: ['a2', 'a9'], from: 'a1', exit: 'a9' },
      { movable: ['a1', 'a2', 'a3', 'a9'], from: 'a3', exit: 'a9' },
      { movable: ['a1'], from: 'a2', exit: 'a1' },
    ] as const;
    for (const { movable, from, exit } of cases) {
      const next = advanceCursor(arrow(from), arrows(...movable), {
        from: arrow(from),
        exit: arrow(exit),
      });
      expect(next, `${from}->${exit}`).toBe(arrow(exit));
    }
  });

  it('8. If a committed step leaves no movable destination but a movable remainder at its source, the cursor shall be that source.', () => {
    const cases = [
      { movable: ['a1', 'a2'], from: 'a1', exit: 'a9' },
      { movable: ['a3'], from: 'a3', exit: 'a9' },
      { movable: ['a1', 'a2', 'a3'], from: 'a2', exit: 'z0' },
    ] as const;
    for (const { movable, from, exit } of cases) {
      const next = advanceCursor(arrow(from), arrows(...movable), {
        from: arrow(from),
        exit: arrow(exit),
      });
      expect(next, `${from}->${exit}`).toBe(arrow(from));
    }
  });

  it('9. The system shall produce the same cursor sequence for the same committed steps, independent of map or set iteration order.', () => {
    const ids = pool(5);
    const state = stubState();
    const baseline = movableArrows(stubRulesOrdered(ids), state);
    const sequenceFor = (movable: readonly ArrowId[]): readonly string[] => {
      const out: string[] = [];
      let at: ArrowId | undefined;
      for (let i = 0; i < 8; i += 1) {
        at = advanceCursor(at, movable);
        out.push(String(at));
      }
      return out;
    };
    const want = sequenceFor(baseline);
    expect(baseline).toEqual(arrows(...ids));
    for (const order of rotations(ids)) {
      const movable = movableArrows(stubRulesOrdered(order), state);
      expect(movable, order.join(',')).toEqual(baseline);
      expect(sequenceFor(movable), order.join(',')).toEqual(want);
    }
    // Several legal steps out of one arrow still yield one cursor position.
    expect(movableArrows(stubRulesWithDuplicates('a2', 'a1'), state)).toEqual(
      arrows('a1', 'a2'),
    );
  });

  it('10. The system shall write no `skip` move to a match log.', () => {
    const app = codeOf(appSource());
    expect(app.includes('requestSkip'), 'App.tsx still calls requestSkip').toBe(false);
    expect(/\bskip\s*\(/.test(app), 'App.tsx still builds a skip move').toBe(false);
    expect(app.includes("'skip'"), 'App.tsx still names the skip move kind').toBe(false);
    const hud = codeOf(hudSource());
    expect(hud.includes('Skip group'), 'Hud.tsx still labels the button Skip group').toBe(false);
    expect(hud.includes('Next stack'), 'Hud.tsx does not label the button Next stack').toBe(true);
  });
});
