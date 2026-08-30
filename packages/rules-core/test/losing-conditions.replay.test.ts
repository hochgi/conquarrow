/**
 * Replay fixture — a four-seat match that loses two seats, replayed exactly.
 *
 * The record is an initial state plus a literal ordered move list. Because the
 * core is pure, replaying it must reproduce the same losses at the same round
 * boundaries and the same final board, byte for byte (ADR 0001).
 *
 * What that pins is the boundary arithmetic — the same log loses the same seats
 * at the same boundaries — and **not** map-iteration nondeterminism.
 * `replayIsDeterministic` replays the one implementation twice in a single
 * process, so both runs build every map in the same insertion order and see the
 * same iteration order; a resolution that walked `starvationStreaks` instead of
 * `state.players` would agree with itself here. Nor would it drift elsewhere:
 * per-seat removal gives nobody anything, so removals commute and resolution
 * order has no falsifying observation of its own (invariant 19). Insertion order
 * is instead varied explicitly, in the edge-case and invariant suites.
 *
 * @see docs/spec/losing-conditions/losing-conditions.md
 * @see .claude/skills/rules-invariants/SKILL.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, rational, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move } from '@conquarrow/contracts';
import { replay, replayIsDeterministic } from '../src/replay';
import {
  A,
  B,
  C,
  D,
  aBoard,
  aVertex,
  bareArrow,
  held,
  holdingsOf,
  lostSeats,
  seatState,
  shareArrow,
  streakOf,
} from './losing.support';
import type { Ground } from './losing.support';
import { exitsFrom, snapshot } from './support';

/** An exit from `arrow` that nobody owns — a step that cannot convert itself. */
const clearExit = (ground: Ground, state: GameState, arrow: ArrowId): ArrowId => {
  const found = exitsFrom(ground.geometry, arrow).find(
    (exit) => !state.territory.has(exit) && !state.groups.has(exit),
  );
  if (found === undefined) throw new Error('setup: every exit is owned or occupied');
  return found;
};

/**
 * The record: A and B hold bare ground and heads (destitute), C and D each hold
 * a share. The threshold is two rounds, so A and B go together on the second
 * boundary and the match continues between C and D.
 */
const aMatch = (): { ground: Ground; initial: GameState; moves: readonly Move[] } => {
  const ground = aBoard();
  const aStack = bareArrow(ground, 3);
  const bStack = bareArrow(ground, 4);
  const dStack = shareArrow(ground, 2);
  const initial = seatState({
    players: [A, B, C, D],
    groups: [
      { arrow: aStack, owner: A, heads: 1 },
      { arrow: bStack, owner: B, heads: 1 },
      { arrow: shareArrow(ground, 1), owner: C, heads: 1 },
      { arrow: dStack, owner: D, heads: 2 },
    ],
    territory: [
      ...held([bareArrow(ground, 0)], A),
      ...held([bareArrow(ground, 1)], B),
      { arrow: shareArrow(ground, 1), owner: C },
      { arrow: dStack, owner: D },
    ],
    accumulators: [[shareArrow(ground, 1), rational(2, 3)]],
    spawners: [[aVertex(ground), { force: rational(1, 3), phase: 1 }]],
    dominationN: 2,
  });
  const aExit = clearExit(ground, initial, aStack);
  const dExit = clearExit(ground, initial, dStack);
  const moves: readonly Move[] = [
    // Round 1 — A wanders, B stands (naming no move at all), C waits, D pushes a
    // head out.
    step(aStack, aExit, 1),
    endTurn(),
    endTurn(),
    endTurn(),
    step(dStack, dExit, 1),
    endTurn(),
    // Round 2 — everyone ends. The boundary takes A and B together.
    endTurn(),
    endTurn(),
    endTurn(),
    endTurn(),
  ];
  return { ground, initial, moves };
};

describe('a four-seat match that loses two seats', () => {
  it('loses the same seats at the same boundaries', () => {
    const { ground, initial, moves } = aMatch();

    // Fold once, recording what each boundary did.
    const boundaries: { round: number; lost: readonly string[] }[] = [];
    let state = initial;
    let round = 0;
    for (const move of moves) {
      state = ground.rules.apply(state, move);
      if (move.kind === 'endTurn' && state.activePlayer === state.players[0]) {
        round += 1;
        boundaries.push({ round, lost: lostSeats(state, ground.geometry) });
      }
    }

    expect(boundaries).toEqual([
      { round: 1, lost: [] },
      { round: 2, lost: ['A', 'B'] },
    ]);
    expect(streakOf(state, C)).toBe(0);
    expect(streakOf(state, D)).toBe(0);
    expect(state.winner).toBeUndefined();
  });

  it('reproduces an identical final state', () => {
    const { ground, initial, moves } = aMatch();

    const first = replay(ground.rules, initial, moves);
    const second = replay(ground.rules, initial, moves);

    expect(snapshot(first)).toEqual(snapshot(second));
    expect(replayIsDeterministic(ground.rules, initial, moves, snapshot)).toBe(true);
  });

  it('leaves nothing of the two lost seats and everything of the two survivors', () => {
    const { ground, initial, moves } = aMatch();

    const final = replay(ground.rules, initial, moves);

    for (const gone of [A, B]) {
      expect(holdingsOf(final, gone)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
      expect(final.starvationStreaks.has(gone)).toBe(false);
    }
    expect(holdingsOf(final, C).heads).toBeGreaterThan(0);
    expect(holdingsOf(final, D).heads).toBeGreaterThan(0);
    expect(holdingsOf(final, C).land.length).toBeGreaterThan(0);
    expect(holdingsOf(final, D).land.length).toBeGreaterThan(0);
  });

  it('never rewrites the player list, at any point in the record', () => {
    const { ground, initial, moves } = aMatch();
    const original = [...initial.players].map(String);

    let state = initial;
    for (const move of moves) {
      state = ground.rules.apply(state, move);
      expect([...state.players].map(String)).toEqual(original);
    }
  });

  it('reverts the two lost seats territory to unowned rather than to a survivor', () => {
    const { ground, initial, moves } = aMatch();
    const vacated = [bareArrow(ground, 0), bareArrow(ground, 1)];

    const final = replay(ground.rules, initial, moves);

    for (const arrow of vacated) {
      expect(final.territory.has(arrow)).toBe(false);
      expect(final.accumulators.has(arrow)).toBe(false);
    }
  });
});
