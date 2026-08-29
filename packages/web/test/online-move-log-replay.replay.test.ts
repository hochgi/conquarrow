/**
 * P49 replay fixture — a queue of batches is an ordered move list, and draining
 * it reproduces one exact final position.
 *
 * This is where accidental nondeterminism in the client would surface: a queue
 * that drained out of order, a digest that read `Set` order, or a drain that
 * folded a batch twice all show up as a mismatch here rather than as a desync
 * a player reports later.
 */

import { describe, expect, it } from 'vitest';
import type { GameState, Move } from '@conquarrow/contracts';
import { replay, replayIsDeterministic } from '@conquarrow/rules-core';
import { commitSequence, stateDigest } from '../src/online-replay';
import { batch, openingThree, pass, rules } from './online-move-log-replay.support';

/** Occupancy as a sorted, printable list — the shape a golden can be read in. */
const occupancy = (state: GameState): readonly string[] =>
  [...state.groups.entries()]
    .map(([arrow, group]) => `${String(arrow)} ${String(group.owner)}×${String(group.heads)}`)
    .toSorted();

/** Three batches of passes: one full round, seat by seat, as three wakes would deliver it. */
const queued = [
  batch(4, 5, [pass()]),
  batch(5, 6, [pass()]),
  batch(6, 7, [pass()]),
];

describe('draining the replay queue reproduces one exact position', () => {
  it('the commit sequence is the batches concatenated, in arrival order', () => {
    const expected: readonly Move[] = [pass(), pass(), pass()];
    expect(commitSequence(queued)).toEqual(expected);
  });

  it('replaying it lands on one occupancy, and does not drift', () => {
    const opening = openingThree();
    const moves = commitSequence(queued);

    const final = replay(rules, opening, moves);

    expect(replayIsDeterministic(rules, opening, moves, occupancy)).toBe(true);
    expect(occupancy(final)).toEqual(occupancy(replay(rules, opening, moves)));
    // A full round of passes returns the turn to the seat that started it.
    expect(String(final.activePlayer)).toBe(String(opening.activePlayer));
  });

  it('the digest of the replayed position is stable across two drains', () => {
    const opening = openingThree();
    const left = replay(rules, opening, commitSequence(queued));
    const right = replay(rules, opening, commitSequence(queued));
    expect(stateDigest(left)).toBe(stateDigest(right));
    expect(stateDigest(left)).not.toBe(stateDigest(opening));
  });
});
