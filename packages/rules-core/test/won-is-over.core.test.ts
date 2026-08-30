/**
 * One test per scenario of docs/spec/won-is-over/won-is-over.core.feature.
 *
 * Two rules and one non-rule. The two rules are gates — `legalMoves` offers
 * nothing and `apply` refuses everything once `winner` is set — and they are the
 * new behaviour. The third Rule, *the deciding move is not truncated*, asserts
 * something P37 already made true and P38 makes load-bearing: the refusal is at
 * the **top** of `apply`, gating the next move, never inside the pass gating the
 * current one. Those tests are regression guards and are expected to pass from the
 * start; the spec says so in as many words ("now load-bearing rather than
 * incidental").
 *
 * Written against the ports. The gate scenarios run on the P02 fixture
 * (`minimal`), where a failure prints; the closure scenarios run on the generated
 * tiling, because *enclosed* means *cannot reach infinity* and a finite board has
 * no infinity to fail to reach (§11 item 4).
 *
 * @see docs/spec/won-is-over/won-is-over.md
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { isLost, territoryCountOf } from '../src/victory';
import { A, B, C } from './losing.support';
import { aWinningClosure, aWonPosition, outcomeOf } from './won-is-over.support';
import { snapshot } from './support';

// ── Rule: A won state offers nothing ─────────────────────────────────────────

describe('a won state offers nothing', () => {
  it('offers no move at all once a winner is set', () => {
    const position = aWonPosition();
    // Not vacuous: the same board without a winner offers a good deal.
    expect(position.rules.legalMoves(position.live).length).toBeGreaterThan(1);

    expect(position.rules.legalMoves(position.won)).toEqual([]);
  });

  it('does not offer even the pass', () => {
    // The one place an empty offer list is the right answer rather than a
    // deadlock. A **lost** seat is offered exactly `[endTurn()]`, because
    // `players[0]` is the round-boundary marker and the round still has to advance
    // through a dead seat's slot (P37 invariant 4). A **won** match has no next
    // turn to advance to, so the pass would mean nothing. The two states look
    // adjacent and the reasoning inverts between them — see the companion
    // assertion, *a lost seat is still offered the pass*, in the edge-case suite.
    const position = aWonPosition();
    expect(position.rules.legalMoves(position.live)).toContainEqual(endTurn());

    const offered = position.rules.legalMoves(position.won);

    expect(offered.filter((move) => move.kind === 'endTurn')).toEqual([]);
  });

  it('offers the winner nothing either, mid-turn and with allowance left', () => {
    // The window item 46 was opened by: at the moment `winner` is set the winning
    // seat is still mid-turn, its stack unspent. That is the seat most likely to be
    // offered a move by a `legalMoves` that never consults `winner`.
    const position = aWonPosition({ winner: A, activePlayer: A });
    const group = position.won.groups.get(position.stack);
    if (group === undefined) throw new Error('setup: the winner holds no stack');
    expect(group.spent).toBe(0);
    expect(position.won.activePlayer).toBe(A);
    expect(position.won.winner).toBe(A);

    expect(position.rules.legalMoves(position.won)).toEqual([]);
  });
});

// ── Rule: A won state refuses every move ─────────────────────────────────────

describe('a won state refuses every move', () => {
  // The Scenario Outline, one Example each. Both kinds, because the gate sits
  // above `dispatch` and a gate written into one branch of the switch would pass
  // for the kind it was written into.
  const kinds: readonly (readonly [string, (position: ReturnType<typeof aWonPosition>) => Move])[] =
    [
      ['a step', (position) => position.good],
      ['an end of turn', () => endTurn()],
    ];

  for (const [name, moveOf] of kinds) {
    it(`refuses ${name} with a ContractViolation, leaving the input state unchanged`, () => {
      const position = aWonPosition();
      const move = moveOf(position);
      const before = snapshot(position.won);
      // Not vacuous: the same move on the same board without a winner is accepted.
      expect(() => position.rules.apply(position.live, move)).not.toThrow();

      expect(() => position.rules.apply(position.won, move)).toThrow(ContractViolation);
      expect(snapshot(position.won)).toEqual(before);
    });
  }

  it('refuses for the match being over, not for the empty source it was handed', () => {
    // The gate is at the top of `apply`, so a caller who mistakes a finished match
    // for a live one is told that, and not handed a movement diagnostic about the
    // arrow it named. Asserted as *the refusal says nothing about the board*: the
    // message is the same one a perfectly well-formed step gets, and it mentions
    // neither the arrow nor the group that is not on it.
    const position = aWonPosition();
    const empty = String(position.emptyArrow);
    // Non-vacuous: on the live board that same step is refused, and refused for
    // exactly the reason this one must not be.
    const live = outcomeOf(position.rules, position.live, position.sourceless);
    expect(live.refused).toBe(true);
    if (live.refused) expect(live.message).toContain(empty);

    const over = outcomeOf(position.rules, position.won, position.sourceless);

    expect(over.refused).toBe(true);
    if (!over.refused) throw new Error('unreachable: asserted refused above');
    expect(over.message).not.toContain(empty);
    expect(over.message).not.toContain('no group');
    const wellFormed = outcomeOf(position.rules, position.won, position.good);
    expect(wellFormed.refused).toBe(true);
    if (wellFormed.refused) expect(over.message).toEqual(wellFormed.message);
  });
});

// ── Rule: The deciding move is not truncated ──────────────────────────────────

describe('the deciding move is not truncated', () => {
  it('claims the ground the winning closure encloses, in the state that step returns', () => {
    const loop = aWinningClosure();
    expect(loop.before.winner).toBeUndefined();
    expect(territoryCountOf(loop.before, C)).toBe(1);
    expect(isLost(loop.before, C, loop.geometry)).toBe(false);

    const after = loop.rules.apply(loop.before, loop.closing);

    expect(after.winner).toBe(A);
    for (const arrow of loop.interior) {
      expect({ arrow: String(arrow), owner: String(after.territory.get(arrow)) }).toEqual({
        arrow: String(arrow),
        owner: String(A),
      });
    }
  });

  it('converts the stack that closure encircled, in the state that step returns', () => {
    const loop = aWinningClosure();
    const held = loop.before.groups.get(loop.victimStack);
    if (held === undefined) throw new Error('setup: no stack stands inside the loop');
    expect(held.owner).toBe(C);
    expect(held.heads).toBe(2);

    const after = loop.rules.apply(loop.before, loop.closing);

    expect(after.winner).toBe(A);
    const converted = after.groups.get(loop.victimStack);
    expect(converted === undefined ? undefined : String(converted.owner)).toBe(String(A));
  });

  it('is never refused for the win it causes', () => {
    // Invariant 4. The gate refuses the *next* move; it must never refuse the move
    // that set `winner`, which is why it sits above `dispatch` rather than anywhere
    // near `resolveLosses`.
    const loop = aWinningClosure();
    expect(loop.before.winner).toBeUndefined();

    const outcome = outcomeOf(loop.rules, loop.before, loop.closing);

    expect(outcome.refused).toBe(false);
    if (outcome.refused) throw new Error('unreachable: asserted accepted above');
    expect(outcome.state.winner).toBe(A);
    // And B, who was lost before the move, is not who won it.
    expect(outcome.state.winner).not.toBe(B);
  });
});
