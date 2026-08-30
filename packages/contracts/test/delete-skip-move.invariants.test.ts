/**
 * The contracts-side EARS invariants of docs/spec/delete-skip-move/delete-skip-move.md.
 *
 * Invariant 2 — `MOVE_KINDS` shall contain exactly `step` and `endTurn`.
 *
 * Enumerated deterministically, no generator and no seed: a randomised
 * counterexample that only shows up on some runs is worse than none at all in a
 * package whose whole point is that the same inputs give the same answer.
 *
 * Note on shape: the absence of the `skip` *symbol* cannot be asserted as a
 * type-level fact without failing to compile today, which is a red for the
 * wrong reason. It is asserted on the module namespace object instead, which
 * compiles both before and after the deletion.
 *
 * @see docs/spec/delete-skip-move/delete-skip-move.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import * as contracts from '../src/index';
import { MOVE_KINDS, endTurn, mintArrowId, movesEqual, step } from '../src/index';
import type { Move } from '../src/index';

const A1 = mintArrowId('a1');
const A2 = mintArrowId('a2');

/** Every kind the vocabulary admits, each with a witness value. */
const witnesses = (): readonly { readonly kind: string; readonly move: Move }[] => [
  { kind: 'step', move: step(A1, A2, 1) },
  { kind: 'endTurn', move: endTurn() },
];

describe('2. MOVE_KINDS shall contain exactly step and endTurn', () => {
  it('lists two kinds, in order, with no duplicates', () => {
    expect([...MOVE_KINDS]).toEqual(['step', 'endTurn']);
    expect(new Set<string>(MOVE_KINDS).size).toBe(MOVE_KINDS.length);
  });

  it('names no kind that is not step or endTurn', () => {
    for (const kind of MOVE_KINDS) {
      expect(['step', 'endTurn']).toContain(kind);
    }
  });

  it('has a constructible witness for every listed kind, and every witness is listed', () => {
    const built = witnesses();
    expect(built.map((w) => w.kind)).toEqual([...MOVE_KINDS]);
    for (const { kind, move } of built) {
      expect(move.kind).toBe(kind);
      expect(movesEqual(move, move)).toBe(true);
    }
  });

  it('exports no skip constructor', () => {
    const exported: Record<string, unknown> = contracts;
    expect(Object.keys(exported)).not.toContain('skip');
    expect('skip' in exported).toBe(false);
  });
});
