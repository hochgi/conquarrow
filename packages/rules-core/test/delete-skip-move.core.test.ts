/**
 * docs/spec/delete-skip-move/delete-skip-move.core.feature — P51.
 *
 * The engine half: the offer never holds a skip, declining stays legal, and a
 * stack the engine has nothing to do with is simply not named.
 *
 * Everything is asked of `RulesPort`. `allowanceOf` and `applySkip` are private
 * to `movement.ts` and stay that way.
 *
 * @see docs/spec/delete-skip-move/delete-skip-move.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { A, anExitFrom, headsOn, onBoard, ownerOf, spentOn, stateOf } from './support';
import { everyArrow, namesArrow, stackWithNoLandableExit } from './delete-skip-move.support';

const kindsOf = (moves: readonly Move[]): readonly string[] => [
  ...new Set(moves.map((m) => m.kind)),
];

describe('The move vocabulary has no skip', () => {
  it('No state offers a skip', () => {
    const table = onBoard();
    const arrows = everyArrow(table);
    const first = arrows[0];
    const second = arrows[1];
    if (first === undefined || second === undefined) throw new Error('setup: board too small');
    const state = stateOf([
      { arrow: first, owner: A, heads: 3 },
      { arrow: second, owner: A, heads: 1 },
    ]);

    const offer = table.rules.legalMoves(state);

    expect(offer.length).toBeGreaterThan(0);
    expect(kindsOf(offer).toSorted()).toEqual(['endTurn', 'step']);
    expect(offer.some((m) => m.kind === ('skip' as Move['kind']))).toBe(false);
  });
});

describe('Declining is still legal', () => {
  it('No step is ever compelled', () => {
    const table = onBoard();
    const a1 = everyArrow(table)[0];
    if (a1 === undefined) throw new Error('setup: board too small');
    const state = stateOf([{ arrow: a1, owner: A, heads: 2 }]);

    const offer = table.rules.legalMoves(state);

    expect(offer.some((m) => m.kind === 'endTurn')).toBe(true);
    // And the only way to decline is to not step: nothing in the offer records
    // a decision to leave a1 where it is.
    expect(offer.filter((m) => namesArrow(m, a1) && m.kind !== 'step')).toEqual([]);
  });

  it('A stack may be left where it is', () => {
    const table = onBoard();
    const arrows = everyArrow(table);
    const a1 = arrows[0];
    const a2 = arrows[1];
    if (a1 === undefined || a2 === undefined) throw new Error('setup: board too small');
    const state = stateOf([
      { arrow: a1, owner: A, heads: 2 },
      { arrow: a2, owner: A, heads: 1 },
    ]);
    const exit = anExitFrom(table.geometry, a1);

    const recorded: readonly Move[] = [step(a1, exit, 2), endTurn()];
    const after = recorded.reduce((s, move) => table.rules.apply(s, move), state);

    expect(headsOn(after, a2)).toBe(1);
    expect(ownerOf(after, a2)).toBe(A);
    expect(spentOn(after, a2)).toBe(0);
    // The turn that just happened names a2 nowhere, and no offer the engine made
    // during it could have: nothing but a step names an arrow.
    expect(recorded.some((m) => namesArrow(m, a2))).toBe(false);
    expect(table.rules.legalMoves(state).filter((m) => namesArrow(m, a2) && m.kind !== 'step')).toEqual(
      [],
    );
  });
});

describe('The offer is never empty', () => {
  it('A stack with allowance and no landable exit offers nothing', () => {
    const { table, arrow, state } = stackWithNoLandableExit();

    const offer = table.rules.legalMoves(state);

    expect(offer.filter((m) => namesArrow(m, arrow))).toEqual([]);
    expect(offer.some((m) => m.kind === 'endTurn')).toBe(true);
    expect(offer.length).toBeGreaterThan(0);
  });
});
