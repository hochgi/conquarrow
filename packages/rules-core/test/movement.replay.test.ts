/**
 * A replay fixture for the P04 turn loop.
 *
 * A match is an initial state plus an ordered list of moves, and because the core
 * is pure, replaying it must reproduce the final state exactly. One fixture
 * exercises far more rule surface per line than an example does, and it is the
 * only reliable detector of accidental nondeterminism: if this drifts after a
 * refactor, an ordering dependence was introduced — find it, do not re-record the
 * golden (rules-invariants; P10 lands the harness itself).
 *
 * The moves name arrows literally, because a recorded match is a *record*. Every
 * grain relationship it assumes is checked against `GeometryPort` first, so a
 * mistyped arrow fails as a setup error rather than as a rules failure.
 *
 * **The record follows `legalMoves`, not the wider `apply`.** A golden that leaned
 * on a move the engine never offered would record a turn no player could have
 * played, so a guard below asserts every recorded move was on offer when it was
 * made (movement.md, "legalMoves is the narrower half of the port").
 *
 * The turn it records: a pair advances and splits off a scout, while a garrison
 * elsewhere stands its ground — which it does by being named nowhere at all,
 * declining being the absence of a move (P51). The opponent takes an ordinary
 * single step. Next turn the rearguard walks into the scout — an equal merge.
 */

import { describe, expect, it } from 'vitest';
import { endTurn, speed, step } from '@conquarrow/contracts';
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

const arrow = (from: string, to: string): ReturnType<typeof fixtureArrow> =>
  fixtureArrow(MINIMAL, from, to);

const A_PAIR = arrow('0', '1');
const A_ADVANCE = arrow('1', '2');
const A_SCOUT = arrow('2', '3');
const A_GARRISON = arrow('3', '4');
const B_HEAD = arrow('4', '5');
const B_ADVANCE = arrow('5', '6');
// Off the recorded path — land so the round wrap does not vanish either seat
// (P36: no territory is a loss). The record itself is still a movement record.
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

const MOVES: readonly Move[] = [
  // Player A: the pair advances as one (speed 2), then sends one head on and
  // leaves the other standing — the remainder inherited spent 1 and is done.
  step(A_PAIR, A_ADVANCE, 2),
  step(A_ADVANCE, A_SCOUT, 1),
  // The garrison is untouched and still has its whole step. It is simply never
  // named: that is the whole of declining, and it is why the record is shorter
  // than the turn felt.
  endTurn(),
  // Player B: one step, one head.
  step(B_HEAD, B_ADVANCE, 1),
  endTurn(),
  // Player A: the rearguard walks into the scout. Equal arrival, so the merged
  // pair has speed 1 — spent 0, so it could still move; the player ends instead.
  step(A_ADVANCE, A_SCOUT, 1),
  endTurn(),
];

describe('a recorded turn loop replays to the same state', () => {
  it('assumes only grain relationships the board actually has', () => {
    // A setup guard, not a scenario: every step in the record must follow the
    // grain, or a typo in an arrow id would masquerade as a rules bug.
    const { geometry } = onBoard(MINIMAL);
    for (const move of MOVES) {
      if (move.kind !== 'step') continue;
      expect(geometry.outArrows(geometry.target(move.from))).toContain(move.exit);
    }
  });

  it('records only moves the engine offered at the time', () => {
    const table = onBoard(MINIMAL);
    // `replay` throws if any move is off-menu — that is the P10 guard.
    expect(() => replay(table.rules, INITIAL(), MOVES)).not.toThrow();
  });

  it('reaches the recorded final state', () => {
    const table = onBoard(MINIMAL);
    const state = replay(table.rules, INITIAL(), MOVES);

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
  });

  it('reproduces that state exactly on a second replay', () => {
    const table = onBoard(MINIMAL);
    expect(snapshot(replay(table.rules, INITIAL(), MOVES))).toEqual(
      snapshot(replay(table.rules, INITIAL(), MOVES)),
    );
  });
});
