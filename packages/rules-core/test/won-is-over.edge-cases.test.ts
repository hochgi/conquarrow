/**
 * One test per scenario of docs/spec/won-is-over/won-is-over.edge-cases.feature,
 * bar two Rules that live elsewhere:
 *
 * - *A record that runs past the win stops there* — the 2026-08-20 log is a P47
 *   prefix golden (fold stops at 233); P38's empty-offer / throw-on-apply gates
 *   are on `aWonPosition` here and in `won-is-over.core.test.ts`. The log's
 *   remaining fold assertions live in `won-is-over.replay.test.ts`.
 * - *The celebration waits for the effects that won the match* — six scenarios,
 *   all six adapter-side, in `packages/web/test/won-is-over.celebration.test.ts`.
 *
 * What is left is the boundary of the refusal itself: that it says nothing about
 * the board, that it is the same refusal whatever it was handed, and that a **lost**
 * seat and a **won** match are not the same state.
 *
 * @see docs/spec/won-is-over/won-is-over.md
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn } from '@conquarrow/contracts';
import type { GameState } from '@conquarrow/contracts';
import { makeRules } from '../src/index';
import { isLost, territoryCountOf } from '../src/victory';
import { countingMap } from './immediate.support';
import { A, B, C } from './losing.support';
import { snapshot } from './support';
import {
  aLostSeatPosition,
  aWinningClosure,
  aWonPosition,
  countingBoard,
  outcomeOf,
  readsOf,
} from './won-is-over.support';

// ── Rule: Refusal is total and says nothing about the board ──────────────────

describe('a won state refuses totally, and says nothing about the board', () => {
  it('refuses a step against the grain for the match being over', () => {
    // Illegal twice over. The engine must give the reason that is *about the
    // match* rather than the one about the arrow, because the caller's mistake is
    // the first one.
    const position = aWonPosition();
    const live = outcomeOf(position.rules, position.live, position.bad);
    expect(live.refused).toBe(true);

    const over = outcomeOf(position.rules, position.won, position.bad);

    expect(over.refused).toBe(true);
    if (!over.refused) throw new Error('unreachable: asserted refused above');
    expect(over.error).toBeInstanceOf(ContractViolation);
    const wellFormed = outcomeOf(position.rules, position.won, position.good);
    expect(wellFormed.refused).toBe(true);
    if (wellFormed.refused) expect(over.message).toEqual(wellFormed.message);
  });

  it('refuses a step every other rule permits', () => {
    // The other half of *total*: the gate is not a filter over illegal moves, it
    // is a gate over all of them. Non-vacuous by construction — the identical
    // move on the identical board without a winner is accepted.
    const position = aWonPosition();
    const accepted = outcomeOf(position.rules, position.live, position.good);
    expect(accepted.refused).toBe(false);

    const over = outcomeOf(position.rules, position.won, position.good);

    expect(over.refused).toBe(true);
    if (over.refused) expect(over.error).toBeInstanceOf(ContractViolation);
  });

  it('refuses equally from two equal won states', () => {
    // Invariant 8. Two states built independently and asserted equal first, so
    // "equal messages" is a statement about the refusal and not about two names
    // for one object.
    const left = aWonPosition();
    const right = aWonPosition();
    expect(snapshot(right.won)).toEqual(snapshot(left.won));

    const one = outcomeOf(left.rules, left.won, left.good);
    const other = outcomeOf(right.rules, right.won, right.good);

    expect(one.refused).toBe(true);
    expect(other.refused).toBe(true);
    if (!one.refused || !other.refused) throw new Error('unreachable: asserted refused above');
    expect({ name: other.name, message: other.message }).toEqual({
      name: one.name,
      message: one.message,
    });
  });

  it('reads no arrow and no vertex when asked for the moves of a won state', () => {
    // The gate is one `undefined` check on a field already in hand, before any
    // board read — so a won state is *cheaper* to ask than a live one. Consistent
    // with P37 invariant 16, which this does not disturb: nothing here touches the
    // spawner lattice either.
    //
    // Counted on both lattices (`countingBoard`) **and** on the state's own maps
    // (`countingMap`, P37), because "reads no arrow" is a claim about the port and
    // "before any board read" is a claim about the state — an implementation that
    // walked `groups` to build an empty list would satisfy the first and not the
    // second.
    const position = aWonPosition();
    const groups = countingMap(position.won.groups);
    const territory = countingMap(position.won.territory);
    const won: GameState = { ...position.won, groups: groups.map, territory: territory.map };
    const counted = countingBoard(position.geometry);
    const rules = makeRules(counted.geometry);

    const reads = readsOf(counted, () => void rules.legalMoves(won));

    expect({ ...reads, maps: groups.traversals() + territory.traversals() }).toEqual({
      arrows: 0,
      vertices: 0,
      maps: 0,
    });
    // Not vacuous: the same question on the same board without a winner does read it.
    const liveCounted = countingBoard(position.geometry);
    const liveRules = makeRules(liveCounted.geometry);
    const liveReads = readsOf(liveCounted, () => void liveRules.legalMoves(position.live));
    expect(liveReads.arrows).toBeGreaterThan(0);
  });
});

// ── Rule: A lost seat and a won match are different states ───────────────────

describe('a lost seat and a won match are different states', () => {
  it('still offers a lost seat the pass, and offers a won match nothing', () => {
    // P37 invariant 4, unchanged, next to the P38 rule that inverts it. Both
    // assertions on one board and on consecutive lines on purpose: the next person
    // to touch `legalMoves` needs the *reason* the two differ on the record, and a
    // comment in one file about a test in another is not that record.
    const position = aLostSeatPosition();
    expect(isLost(position.lost, C, position.ground.geometry)).toBe(true);
    expect(position.lost.winner).toBeUndefined();
    expect(position.lost.activePlayer).toBe(C);
    // Two of three seats are still playing, so the round has somewhere to go.
    expect([A, B].filter((seat) => !isLost(position.lost, seat, position.ground.geometry))).toEqual([
      A,
      B,
    ]);

    // A lost seat: the round must still advance through its slot.
    expect(position.rules.legalMoves(position.lost)).toEqual([endTurn()]);
    // A won match: there is no next turn for a pass to reach.
    expect(position.rules.legalMoves(position.won)).toEqual([]);
  });

  it('loses the last seat and crowns the winner on one move, then refuses the next', () => {
    const loop = aWinningClosure();
    expect(territoryCountOf(loop.before, C)).toBe(1);
    expect(isLost(loop.before, C, loop.geometry)).toBe(false);
    expect(loop.before.winner).toBeUndefined();

    const after = loop.rules.apply(loop.before, loop.closing);

    expect(isLost(after, C, loop.geometry)).toBe(true);
    expect(after.winner).toBe(A);
    expect(() => loop.rules.apply(after, endTurn())).toThrow(ContractViolation);
  });
});
