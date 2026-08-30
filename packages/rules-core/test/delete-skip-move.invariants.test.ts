/**
 * The engine-side EARS invariants of docs/spec/delete-skip-move/delete-skip-move.md.
 *
 *   1. The system shall offer no move of kind `skip` for any state.
 *   3. The legal-move offer shall be non-empty for every live state.
 *   6. While a stack has allowance and no landable exit, the system shall offer
 *      no move naming that stack.
 *   8. The system shall compel no step: for every live state, `endTurn` is legal.
 *
 * The state space is enumerated **deterministically** — every arrow of the
 * fixture board, every seat, a fixed ladder of group sizes. There is no
 * generator and no seed: a counterexample that only appears on some runs is
 * worse than none in a codebase whose defining property is that the same inputs
 * give the same answer (ADR 0001).
 *
 * @see docs/spec/delete-skip-move/delete-skip-move.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import type { ArrowId, GameState, Move, PlayerId } from '@conquarrow/contracts';
import { A, B, anExitFrom, exitsFrom, onBoard, owned, stateOf } from './support';
import type { Table } from './support';
import { blockedStateOn, everyArrow, namesArrow } from './delete-skip-move.support';

const SIZES = [1, 2, 3, 5, 8] as const;
const SEATS: readonly PlayerId[] = [A, B];

interface Case {
  readonly label: string;
  readonly state: GameState;
  /** Present when the case is a stack with allowance and no landable exit. */
  readonly blocked?: ArrowId;
}

/**
 * A deterministic catalogue of live states: a lone stack of each size on each
 * arrow for each seat, the same with an enemy alongside, and — separately — the
 * blocked stack invariant 6 is about.
 */
const liveStates = (table: Table): readonly Case[] => {
  const cases: Case[] = [];
  for (const arrow of everyArrow(table)) {
    const exit = anExitFrom(table.geometry, arrow);
    for (const seat of SEATS) {
      for (const heads of SIZES) {
        cases.push({
          label: `${String(seat)} ${String(heads)} heads on ${String(arrow)}`,
          state: stateOf([{ arrow, owner: seat, heads }], seat),
        });
        cases.push({
          label: `${String(seat)} ${String(heads)} on ${String(arrow)} facing an enemy`,
          state: stateOf(
            [
              { arrow, owner: seat, heads },
              { arrow: exit, owner: seat === A ? B : A, heads: 2 },
            ],
            seat,
          ),
        });
      }
      cases.push({
        label: `${String(seat)} holding land at ${String(arrow)}`,
        state: stateOf([{ arrow, owner: seat, heads: 2 }], seat, {
          territory: owned([arrow], seat),
        }),
      });
    }
    cases.push({
      label: `a lone head boxed in on ${String(arrow)}`,
      state: blockedStateOn(table, arrow),
      blocked: arrow,
    });
  }
  return cases;
};

const isSkip = (move: Move): boolean => (move.kind as string) === 'skip';

describe('the offer, over every live state of the fixture board', () => {
  const table = onBoard();
  const cases = liveStates(table);

  it('enumerates a state space worth calling a property', () => {
    expect(cases.length).toBeGreaterThan(50);
    for (const { state } of cases) expect(state.winner).toBeUndefined();
  });

  it('1. offers no move of kind skip for any state', () => {
    for (const { label, state } of cases) {
      const offer = table.rules.legalMoves(state);
      expect(offer.filter(isSkip), label).toEqual([]);
      expect([...new Set(offer.map((m) => m.kind))].toSorted(), label).not.toContain('skip');
    }
  });

  it('3. offers something for every live state', () => {
    for (const { label, state } of cases) {
      expect(table.rules.legalMoves(state).length, label).toBeGreaterThan(0);
    }
  });

  it('8. compels no step — endTurn is legal for every live state', () => {
    for (const { label, state } of cases) {
      const offer = table.rules.legalMoves(state);
      expect(
        offer.some((m) => m.kind === 'endTurn'),
        label,
      ).toBe(true);
      // And it is applicable, not merely listed.
      expect(() => table.rules.apply(state, { kind: 'endTurn' }), label).not.toThrow();
    }
  });

  it('6. names no stack that has allowance and no landable exit', () => {
    const blocked = cases.filter((c) => c.blocked !== undefined);
    expect(blocked.length).toBe(everyArrow(table).length);
    for (const { label, state, blocked: arrow } of blocked) {
      if (arrow === undefined) continue;
      // Setup guard: the stack really is unable to land anywhere.
      for (const exit of exitsFrom(table.geometry, arrow)) {
        expect(state.groups.get(exit)?.owner, `${label}: ${String(exit)} is not blocked`).toBe(B);
      }
      const offer = table.rules.legalMoves(state);
      expect(
        offer.filter((m) => namesArrow(m, arrow)),
        label,
      ).toEqual([]);
      expect(
        offer.some((m) => m.kind === 'endTurn'),
        label,
      ).toBe(true);
    }
  });
});
