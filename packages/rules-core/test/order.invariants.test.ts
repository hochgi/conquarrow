/**
 * Totality of the engine's id order (ADR 0001).
 *
 * `order.ts` is the determinism module: a surviving mutant here is a replay that
 * can drift. The suite pins the **exact** -1 / 0 / +1 contract, including equal
 * ids — a comparator that never returns 0 is not total, and a sort of unique
 * keys will not notice.
 *
 * Enumerated, not generated: a randomised counterexample that only appears on
 * some runs is worse than none in a codebase whose defining property is that
 * the same inputs give the same answer.
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId, mintPlayerId, mintVertexId } from '@conquarrow/contracts';
import { compareArrows, comparePlayers, compareVertices } from '../src/order';

/** Prefixes, numerics-as-strings, and the empty id — compared, never parsed. */
const SAMPLES = ['', '0', '10', '2', 'a', 'a10', 'a2', 'b'] as const;

type Cmp = (left: string, right: string) => number;

const want = (left: string, right: string): -1 | 0 | 1 =>
  left < right ? -1 : left > right ? 1 : 0;

const pin = (compare: Cmp): void => {
  for (const left of SAMPLES) {
    for (const right of SAMPLES) {
      expect(compare(left, right), `${left} vs ${right}`).toBe(want(left, right));
    }
  }
};

const asArrows: Cmp = (left, right) => compareArrows(mintArrowId(left), mintArrowId(right));
const asPlayers: Cmp = (left, right) =>
  comparePlayers(mintPlayerId(left), mintPlayerId(right));
const asVertices: Cmp = (left, right) =>
  compareVertices(mintVertexId(left), mintVertexId(right));

describe('id order is total and exact', () => {
  it.each([
    ['compareArrows', asArrows],
    ['comparePlayers', asPlayers],
    ['compareVertices', asVertices],
  ] as const)('%s returns -1, 0, or 1 for every pair, including equals', (_name, compare) => {
    pin(compare);
  });

  it('the three comparators agree on the same string forms, so they cannot drift', () => {
    for (const left of SAMPLES) {
      for (const right of SAMPLES) {
        const arrows = asArrows(left, right);
        expect(asPlayers(left, right), `${left} vs ${right}`).toBe(arrows);
        expect(asVertices(left, right), `${left} vs ${right}`).toBe(arrows);
      }
    }
  });

  it('sorts a bag of ids independently of input order, including duplicates', () => {
    const raw = ['c', 'a', 'b', 'a', 'c'] as const;
    const expected = ['a', 'a', 'b', 'c', 'c'];
    const arrows = raw.map(mintArrowId);
    for (let k = 0; k < arrows.length; k += 1) {
      const rotated = [...arrows.slice(k), ...arrows.slice(0, k)];
      expect(rotated.toSorted(compareArrows).map(String)).toEqual(expected);
    }
    expect([...raw].map(mintPlayerId).toSorted(comparePlayers).map(String)).toEqual(
      expected,
    );
    expect([...raw].map(mintVertexId).toSorted(compareVertices).map(String)).toEqual(
      expected,
    );
  });

  it('orders opaque ids lexicographically, never as numbers or coordinates', () => {
    // '10' < '2' as strings, because '1' < '2'. A natural-sort "fix" would
    // invert this (2 before 10) and parse an identifier, which P01 D1 forbids.
    expect(asArrows('10', '2')).toBe(-1);
    expect(asArrows('a10', 'a2')).toBe(-1);
  });
});
