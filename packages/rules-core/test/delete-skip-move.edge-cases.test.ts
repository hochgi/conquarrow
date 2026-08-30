/**
 * docs/spec/delete-skip-move/delete-skip-move.edge-cases.feature — P51.
 *
 * The engine-side edges: a value shaped like a skip is refused rather than
 * absorbed, and a replay re-recorded without its skips reaches the same final
 * state. A differing final state is a defect to report, not a fixture to adjust.
 *
 * The re-recorded fixtures are pinned by their *recorded* final state, written
 * out here, rather than by replaying the old list beside the new one — after the
 * deletion the old list cannot be replayed at all, which is the point.
 *
 * @see docs/spec/delete-skip-move/delete-skip-move.md
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn, speed, step } from '@conquarrow/contracts';
import type { GameState, Move } from '@conquarrow/contracts';
import { MINIMAL, fixtureArrow } from '@conquarrow/geometry-fixtures';
import { replay } from '../src/replay';
import {
  A,
  B,
  headsOn,
  onBoard,
  owned,
  ownerOf,
  snapshot,
  spentOn,
  stateOf,
  totalHeads,
} from './support';
import { everyArrow, skipShaped } from './delete-skip-move.support';

const arrow = (from: string, to: string): ReturnType<typeof fixtureArrow> =>
  fixtureArrow(MINIMAL, from, to);

// The same board and cast as the shipped movement replay fixture.
const A_PAIR = arrow('0', '1');
const A_ADVANCE = arrow('1', '2');
const A_SCOUT = arrow('2', '3');
const A_GARRISON = arrow('3', '4');
const B_HEAD = arrow('4', '5');
const B_ADVANCE = arrow('5', '6');
const A_HOME = arrow('6', '0');
const B_HOME = arrow('2', '6');

const INITIAL = (): GameState =>
  stateOf(
    [
      { arrow: A_PAIR, owner: A, heads: 2 },
      { arrow: A_GARRISON, owner: A, heads: 1 },
      { arrow: B_HEAD, owner: B, heads: 1 },
    ],
    A,
    { territory: [...owned([A_HOME], A), ...owned([B_HOME], B)] },
  );

/** The shipped movement record, re-recorded without its `skip(A_GARRISON)`. */
const ONE_SKIP_REMOVED: readonly Move[] = [
  step(A_PAIR, A_ADVANCE, 2),
  step(A_ADVANCE, A_SCOUT, 1),
  // The garrison simply is not named. That is the whole of declining.
  endTurn(),
  step(B_HEAD, B_ADVANCE, 1),
  endTurn(),
  step(A_ADVANCE, A_SCOUT, 1),
  endTurn(),
];

/** A record in which both seats declined, re-recorded without either decline. */
const BOTH_SEATS_SKIPS_REMOVED: readonly Move[] = [
  // A advances the pair and leaves the garrison standing.
  step(A_PAIR, A_ADVANCE, 2),
  endTurn(),
  // B stands its whole turn.
  endTurn(),
  step(A_ADVANCE, A_SCOUT, 2),
  endTurn(),
];

describe('Applying a deleted kind is not a silent no-op', () => {
  it('An object shaped like a skip is not accepted by apply', () => {
    const table = onBoard();
    const a1 = everyArrow(table)[0];
    if (a1 === undefined) throw new Error('setup: board too small');
    const state = stateOf([{ arrow: a1, owner: A, heads: 2 }]);
    const before = snapshot(state);

    let returned: GameState | undefined;
    let thrown: unknown;
    try {
      returned = table.rules.apply(state, skipShaped(a1));
    } catch (error) {
      thrown = error;
    }

    // The type, not a bare throw: a skeleton's `Error('not implemented')` would
    // satisfy `.toThrow()` and satisfy it forever (contracts/errors.ts).
    expect(thrown).toBeInstanceOf(ContractViolation);
    expect(returned).toBeUndefined();
    // The input is untouched either way — the core never mutates what it is given.
    expect(snapshot(state)).toEqual(before);
  });
});

describe('Re-recorded replays are identical', () => {
  it('Removing a skip from a fixture changes no final state', () => {
    const table = onBoard();

    expect(() => replay(table.rules, INITIAL(), ONE_SKIP_REMOVED)).not.toThrow();
    const state = replay(table.rules, INITIAL(), ONE_SKIP_REMOVED);

    // The final state the shipped fixture recorded, unchanged.
    expect(totalHeads(state)).toBe(4);
    expect(state.activePlayer).toBe(B);
    expect(state.groups.size).toBe(3);
    expect(headsOn(state, A_SCOUT)).toBe(2);
    expect(ownerOf(state, A_SCOUT)).toBe(A);
    expect(spentOn(state, A_SCOUT)).toBe(0);
    expect(headsOn(state, A_GARRISON)).toBe(1);
    expect(ownerOf(state, A_GARRISON)).toBe(A);
    expect(spentOn(state, A_GARRISON)).toBe(0);
    expect(headsOn(state, B_ADVANCE)).toBe(1);
    expect(ownerOf(state, B_ADVANCE)).toBe(B);
    expect(spentOn(state, B_ADVANCE)).toBe(0);
    expect(table.rules.effectiveSpeed(state, A_SCOUT)).toBe(speed(2));
    expect(snapshot(replay(table.rules, INITIAL(), ONE_SKIP_REMOVED))).toEqual(snapshot(state));
  });

  it('Removing several skips changes no final state', () => {
    const table = onBoard();

    expect(() => replay(table.rules, INITIAL(), BOTH_SEATS_SKIPS_REMOVED)).not.toThrow();
    const state = replay(table.rules, INITIAL(), BOTH_SEATS_SKIPS_REMOVED);

    expect(totalHeads(state)).toBe(4);
    expect(state.activePlayer).toBe(B);
    expect(headsOn(state, A_SCOUT)).toBe(2);
    expect(ownerOf(state, A_SCOUT)).toBe(A);
    expect(headsOn(state, A_GARRISON)).toBe(1);
    expect(ownerOf(state, A_GARRISON)).toBe(A);
    // B never stepped, so its head is exactly where the record found it.
    expect(headsOn(state, B_HEAD)).toBe(1);
    expect(ownerOf(state, B_HEAD)).toBe(B);
    expect(snapshot(replay(table.rules, INITIAL(), BOTH_SEATS_SKIPS_REMOVED))).toEqual(
      snapshot(state),
    );
  });
});
