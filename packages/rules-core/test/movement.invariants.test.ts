/**
 * The EARS invariants of docs/spec/movement/movement.md, as properties.
 *
 * A scenario covers the case somebody thought of; a property covers the state
 * nobody did. Everything here is enumerated **deterministically** — every arrow
 * of a fixture board, every group size in a range, every split of a stack. There
 * is no generator and no seed, because a randomised counterexample that only
 * appears on some runs is worse than no counterexample in a codebase whose
 * defining property is that the same inputs give the same answer (ADR 0001).
 *
 * @see docs/spec/movement/movement.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn, speed, step } from '@conquarrow/contracts';
import type { GameState, Move } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  allArrows,
  anArrow,
  anExitFrom,
  arrowAt,
  exitsFrom,
  headsOn,
  isEmpty,
  onBoard,
  owned,
  pathFrom,
  snapshot,
  spentOn,
  stateOf,
  stepsFrom,
  totalHeads,
  twoSourcesOneDestination,
} from './support';

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 31, 32] as const;

/**
 * A small deterministic catalogue of (state, legal move) pairs, spanning every
 * kind of change a P04 move can make: a whole-stack step, a split, a merge and
 * an end-turn.
 *
 * Hand-authored rather than drawn from `legalMoves`, so a property about `apply`
 * cannot be quietly satisfied by an engine that offers no legal moves at all.
 */
const legalPairs = (): readonly { label: string; state: GameState; move: Move }[] => {
  const { geometry } = onBoard();
  const src = anArrow(geometry);
  const dest = anExitFrom(geometry, src);
  return [
    {
      label: 'a whole stack stepping onto empty ground',
      state: stateOf([{ arrow: src, owner: A, heads: 2 }]),
      move: step(src, dest, 2),
    },
    {
      label: 'a split leaving a remainder behind',
      state: stateOf([{ arrow: src, owner: A, heads: 4 }]),
      move: step(src, dest, 1),
    },
    {
      label: 'a minority arrival merging into a larger group',
      state: stateOf([
        { arrow: src, owner: A, heads: 1 },
        { arrow: dest, owner: A, heads: 3 },
      ]),
      move: step(src, dest, 1),
    },
    {
      label: 'a majority arrival barring the group it joins',
      state: stateOf([
        { arrow: src, owner: A, heads: 3 },
        { arrow: dest, owner: A, heads: 1 },
      ]),
      move: step(src, dest, 3),
    },
    {
      label: 'an end-turn with allowance left over',
      state: stateOf([{ arrow: src, owner: A, heads: 4, spent: 1 }]),
      move: endTurn(),
    },
  ];
};

// ── movement follows the grain ────────────────────────────────────────────────

describe('the system moves heads only along the grain', () => {
  it('accepts every exit of every arrow on the board', () => {
    const table = onBoard();
    for (const from of allArrows(table.geometry, MINIMAL_DIAMETER)) {
      for (const exit of exitsFrom(table.geometry, from)) {
        const after = table.rules.apply(
          stateOf([{ arrow: from, owner: A, heads: 1 }]),
          step(from, exit, 1),
        );
        expect(headsOn(after, exit)).toBe(1);
        expect(isEmpty(after, from)).toBe(true);
      }
    }
  });

  it('refuses every arrow that is not an exit, from every arrow', () => {
    const table = onBoard();
    const arrows = allArrows(table.geometry, MINIMAL_DIAMETER);
    for (const from of arrows) {
      const exits = new Set(exitsFrom(table.geometry, from));
      for (const against of arrows) {
        if (against === from || exits.has(against)) continue;
        const state = stateOf([{ arrow: from, owner: A, heads: 1 }]);
        expect(() => table.rules.apply(state, step(from, against, 1))).toThrow(
          ContractViolation,
        );
      }
    }
  });
});

// ── allowance ────────────────────────────────────────────────────────────────

describe('allowance is speed(N), spent, and carries nothing', () => {
  it.each(SIZES)('gives a fresh group of %i heads exactly speed(N)', (heads) => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const state = stateOf([{ arrow: from, owner: A, heads }]);

    expect(table.rules.effectiveSpeed(state, from)).toBe(speed(heads));
  });

  it.each([1, 2, 4, 8])('lets a group of %i heads take exactly that many steps', (heads) => {
    // The allowance is not merely reported, it is enforced: the walk stops on the
    // step after speed(N), wherever the group happens to have got to.
    const table = onBoard();
    const allowance = speed(heads);
    const path = pathFrom(table.geometry, anArrow(table.geometry), allowance + 2);
    let state = stateOf([{ arrow: arrowAt(path, 0), owner: A, heads }]);

    for (let taken = 0; taken < allowance; taken += 1) {
      state = table.rules.apply(
        state,
        step(arrowAt(path, taken), arrowAt(path, taken + 1), heads),
      );
    }
    const exhausted = state;

    expect(spentOn(exhausted, arrowAt(path, allowance))).toBe(allowance);
    expect(() =>
      table.rules.apply(
        exhausted,
        step(arrowAt(path, allowance), arrowAt(path, allowance + 1), heads),
      ),
    ).toThrow(ContractViolation);
  });

  it.each(SIZES)('refuses a step once a group of %i heads has spent its speed', (heads) => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const exit = anExitFrom(table.geometry, from);
    const state = stateOf([{ arrow: from, owner: A, heads, spent: speed(heads) }]);

    expect(() => table.rules.apply(state, step(from, exit, 1))).toThrow(ContractViolation);
  });

  it.each(SIZES)('refuses a step that overdraws a group of %i heads', (heads) => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const exit = anExitFrom(table.geometry, from);
    const state = stateOf([{ arrow: from, owner: A, heads }]);

    expect(() => table.rules.apply(state, step(from, exit, heads + 1))).toThrow(
      ContractViolation,
    );
  });
});

// ── splitting ────────────────────────────────────────────────────────────────

describe('a split gives both parts the parent’s spent, and charges only the mover', () => {
  const splits: readonly { heads: number; count: number; spent: number }[] = [
    { heads: 2, count: 1, spent: 0 },
    { heads: 3, count: 1, spent: 1 },
    { heads: 3, count: 2, spent: 0 },
    { heads: 4, count: 1, spent: 1 },
    { heads: 4, count: 2, spent: 0 },
    { heads: 4, count: 3, spent: 2 },
    { heads: 8, count: 5, spent: 3 },
  ];

  it.each(splits)(
    'splits $count of $heads heads at spent $spent without charging the remainder',
    ({ heads, count, spent }) => {
      const table = onBoard();
      const from = anArrow(table.geometry);
      const exit = anExitFrom(table.geometry, from);
      const before = stateOf([{ arrow: from, owner: A, heads, spent }]);

      const after = table.rules.apply(before, step(from, exit, count));

      expect(headsOn(after, from)).toBe(heads - count);
      expect(headsOn(after, exit)).toBe(count);
      expect(spentOn(after, from)).toBe(spent);
      expect(spentOn(after, exit)).toBe(spent + 1);
      expect(totalHeads(after)).toBe(heads);
      const rem = heads - count;
      if (spent < speed(rem)) {
        expect(stepsFrom(table, after, from).length).toBeGreaterThan(0);
      }
    },
  );
});

// ── merging ──────────────────────────────────────────────────────────────────

describe('merging overrides the merged group’s speed for the turn', () => {
  const merges: readonly { joined: number; arriving: number; override: number }[] = [
    { joined: 1, arriving: 1, override: 1 },
    { joined: 2, arriving: 1, override: 1 },
    { joined: 2, arriving: 2, override: 1 },
    { joined: 4, arriving: 3, override: 1 },
    { joined: 1, arriving: 2, override: 0 },
    { joined: 2, arriving: 3, override: 0 },
    { joined: 3, arriving: 8, override: 0 },
  ];

  it.each(merges)(
    '$arriving arriving on $joined leaves effective speed $override',
    ({ joined, arriving, override }) => {
      const table = onBoard();
      const src = anArrow(table.geometry);
      const dest = anExitFrom(table.geometry, src);
      const before = stateOf([
        { arrow: dest, owner: A, heads: joined },
        { arrow: src, owner: A, heads: arriving },
      ]);

      const after = table.rules.apply(before, step(src, dest, arriving));

      expect(headsOn(after, dest)).toBe(joined + arriving);
      expect(totalHeads(after)).toBe(joined + arriving);
      expect(table.rules.effectiveSpeed(after, dest)).toBe(override);
    },
  );

  it.each([2, 4, 8])(
    'keeps the override on %i heads that step off the arrow they merged on',
    (heads) => {
      // SPEC §11 item 33, resolved: the price rides with the heads. Read instead
      // as a fact about the arrow the merge happened on, one ordinary step onto
      // empty ground would refund the whole merge price — the free mid-turn
      // upgrade the rule exists to close. So this asserts 1, where the rejected
      // reading gives speed(heads).
      const table = onBoard();
      const path = pathFrom(table.geometry, anArrow(table.geometry), 4);
      const src = arrowAt(path, 0);
      const dest = arrowAt(path, 1);
      const onward = arrowAt(path, 2);
      const beyond = arrowAt(path, 3);
      const arriving = heads / 2;

      const merged = table.rules.apply(
        stateOf([
          { arrow: dest, owner: A, heads: heads - arriving },
          { arrow: src, owner: A, heads: arriving },
        ]),
        step(src, dest, arriving),
      );
      expect(table.rules.effectiveSpeed(merged, dest)).toBe(1);

      const after = table.rules.apply(merged, step(dest, onward, heads));

      expect(headsOn(after, onward)).toBe(heads);
      expect(spentOn(after, onward)).toBe(1);
      expect(table.rules.effectiveSpeed(after, onward)).toBe(1);
      // And the price is genuinely paid: the one step was the whole allowance.
      expect(() => table.rules.apply(after, step(onward, beyond, heads))).toThrow(
        ContractViolation,
      );
    },
  );

  it.each([
    { heads: 4, count: 2 },
    { heads: 6, count: 3 },
    { heads: 8, count: 2 },
  ])('gives both parts the override when $count of $heads split after a merge', ({
    heads,
    count,
  }) => {
    // The split half of §11 item 33: both parts inherit the override exactly as
    // both inherit `spent` (§3). Every part here holds at least 2 heads, so
    // `speed(part)` is at least 2 and the assertion cannot pass by coincidence.
    const table = onBoard();
    const path = pathFrom(table.geometry, anArrow(table.geometry), 3);
    const src = arrowAt(path, 0);
    const dest = arrowAt(path, 1);
    const onward = arrowAt(path, 2);

    const merged = table.rules.apply(
      stateOf([
        { arrow: dest, owner: A, heads: heads - 1 },
        { arrow: src, owner: A, heads: 1 },
      ]),
      step(src, dest, 1),
    );
    expect(table.rules.effectiveSpeed(merged, dest)).toBe(1);

    const after = table.rules.apply(merged, step(dest, onward, count));

    expect(headsOn(after, dest)).toBe(heads - count);
    expect(headsOn(after, onward)).toBe(count);
    expect(spentOn(after, dest)).toBe(0);
    expect(spentOn(after, onward)).toBe(1);
    expect(table.rules.effectiveSpeed(after, dest)).toBe(1);
    expect(table.rules.effectiveSpeed(after, onward)).toBe(1);
  });

  it.each([1, 2, 3])('does not let a later arrival of %i un-bar a barred group', (later) => {
    const table = onBoard();
    const { big, small, dest } = twoSourcesOneDestination(table.geometry);
    let state = stateOf([
      { arrow: dest, owner: A, heads: 1 },
      { arrow: big, owner: A, heads: 2 },
      { arrow: small, owner: A, heads: later },
    ]);

    state = table.rules.apply(state, step(big, dest, 2));
    expect(table.rules.effectiveSpeed(state, dest)).toBe(0);

    state = table.rules.apply(state, step(small, dest, later));

    expect(table.rules.effectiveSpeed(state, dest)).toBe(0);
  });
});

// ── enemy occupancy is contact combat (P06) ──────────────────────────────────

describe('a step onto an opponent-occupied arrow is contact combat', () => {
  it('resolves every exit the opponent stands on, whatever the counts', () => {
    // The P06 seam (§6.2 / item 38): stay-behind required. Outcomes vary with A,D.
    const table = onBoard();
    const src = anArrow(table.geometry);
    for (const exit of exitsFrom(table.geometry, src)) {
      // 1v1 with stay-behind → attacker lands with 1
      {
        const state = stateOf([
          { arrow: src, owner: A, heads: 2 },
          { arrow: exit, owner: B, heads: 1 },
        ]);
        const after = table.rules.apply(state, step(src, exit, 1));
        expect(after.groups.get(exit)?.owner).toBe(A);
        expect(after.groups.get(exit)?.heads).toBe(1);
        expect(after.groups.get(src)?.heads).toBe(1);
      }
      // stay-behind 1, step 1 vs 3 → attacker wiped; defender keeps remainder
      {
        const state = stateOf([
          { arrow: src, owner: A, heads: 2 },
          { arrow: exit, owner: B, heads: 3 },
        ]);
        const after = table.rules.apply(state, step(src, exit, 1));
        expect(after.groups.get(exit)?.owner).toBe(B);
        expect(after.groups.get(exit)?.heads).toBeGreaterThan(0);
        expect(after.groups.get(src)?.heads).toBe(1);
      }
      // 3 of 4 vs 1 → defender wiped; attacker lands; stay-behind remains
      {
        const state = stateOf([
          { arrow: src, owner: A, heads: 4 },
          { arrow: exit, owner: B, heads: 1 },
        ]);
        const after = table.rules.apply(state, step(src, exit, 3));
        expect(after.groups.get(exit)?.owner).toBe(A);
        expect(after.groups.get(src)?.heads).toBe(1);
      }
    }
  });
});

// ── the turn loop ────────────────────────────────────────────────────────────

describe('the turn loop', () => {
  it('offers only end-turn once every owned group has spent its speed', () => {
    const table = onBoard();
    const arrows = allArrows(table.geometry, MINIMAL_DIAMETER);
    for (const heads of [1, 2, 4, 8]) {
      const state = stateOf([
        { arrow: arrowAt(arrows, 0), owner: A, heads, spent: speed(heads) },
        { arrow: arrowAt(arrows, 1), owner: A, heads: 1, spent: 1 },
        { arrow: arrowAt(arrows, 2), owner: B, heads: 4, spent: 0 },
      ]);

      expect(table.rules.legalMoves(state).map((m) => m.kind)).toEqual(['endTurn']);
    }
  });

  it('offers a step whenever any owned group still has allowance', () => {
    const table = onBoard();
    const arrows = allArrows(table.geometry, MINIMAL_DIAMETER);
    const state = stateOf([
      { arrow: arrowAt(arrows, 0), owner: A, heads: 1, spent: 1 },
      { arrow: arrowAt(arrows, 1), owner: A, heads: 4, spent: 1 },
    ]);

    expect(table.rules.legalMoves(state).some((m) => m.kind === 'step')).toBe(true);
  });

  it('advances the active player and clears every counter on end-turn', () => {
    const table = onBoard();
    const arrows = allArrows(table.geometry, MINIMAL_DIAMETER);
    const before = stateOf([
      { arrow: arrowAt(arrows, 0), owner: A, heads: 4, spent: 2 },
      { arrow: arrowAt(arrows, 1), owner: A, heads: 3, spent: 1, speedOverride: 1 },
      { arrow: arrowAt(arrows, 2), owner: B, heads: 2, spent: 1, speedOverride: 0 },
    ]);

    const after = table.rules.apply(before, endTurn());

    expect(after.activePlayer).toBe(B);
    for (const [arrow, group] of after.groups) {
      expect(group.spent).toBe(0);
      expect(table.rules.effectiveSpeed(after, arrow)).toBe(speed(group.heads));
    }
    expect(totalHeads(after)).toBe(totalHeads(before));
  });

  it('returns to the first player after two end-turns, with nothing banked', () => {
    // Nothing survives the turn boundary — not a fraction, not an unused whole
    // step (§3, SPEC §11 item 20).
    const table = onBoard();
    const from = anArrow(table.geometry);
    // A scrap of land so the round boundary does not vanish the stack (P36:
    // no territory is a loss). This case is about spent resetting, not losing.
    const before = stateOf([{ arrow: from, owner: A, heads: 4, spent: 3 }], A, {
      territory: owned([from], A),
    });

    const after = table.rules.apply(table.rules.apply(before, endTurn()), endTurn());

    expect(after.activePlayer).toBe(A);
    expect(spentOn(after, from)).toBe(0);
    expect(table.rules.effectiveSpeed(after, from)).toBe(speed(4));
  });
});

// ── conservation ─────────────────────────────────────────────────────────────

describe('no P04 move mints or kills a head', () => {
  it.each(legalPairs())('conserves the total head count through $label', ({ state, move }) => {
    // Heads are lives (§3). P04 has no event that changes the total — spawning is
    // P08, combat is P06, conversion is P07 — so the count is an invariant here.
    const table = onBoard();

    expect(totalHeads(table.rules.apply(state, move))).toBe(totalHeads(state));
  });
});

// ── purity and determinism ───────────────────────────────────────────────────

describe('apply is pure and determinate', () => {
  it.each(legalPairs())('leaves its input untouched through $label', ({ state, move }) => {
    const table = onBoard();
    const before = snapshot(state);

    table.rules.apply(state, move);

    expect(snapshot(state)).toEqual(before);
  });

  it.each(legalPairs())('returns the same state twice for $label', ({ state, move }) => {
    const table = onBoard();

    expect(snapshot(table.rules.apply(state, move))).toEqual(
      snapshot(table.rules.apply(state, move)),
    );
  });

  it('does not depend on the order the state’s groups were authored in', () => {
    // P04 definition of done: no insertion-order dependence in ordered outputs.
    // This is the failure ADR 0001 calls the realistic one — it passes every
    // example test and surfaces as replay drift.
    const table = onBoard();
    const arrows = allArrows(table.geometry, MINIMAL_DIAMETER);
    const placements = [
      { arrow: arrowAt(arrows, 0), owner: A, heads: 2 },
      { arrow: arrowAt(arrows, 1), owner: A, heads: 4, spent: 1 },
      { arrow: arrowAt(arrows, 2), owner: B, heads: 3 },
    ];
    const forwards = stateOf(placements);
    const backwards = stateOf([...placements].reverse());

    expect(table.rules.legalMoves(backwards)).toEqual(table.rules.legalMoves(forwards));
    expect(snapshot(table.rules.apply(backwards, endTurn()))).toEqual(
      snapshot(table.rules.apply(forwards, endTurn())),
    );
  });

  it('only ever offers moves it will accept', () => {
    // The two halves of the port must agree: anything legalMoves names must apply
    // without a ContractViolation, or a player following the engine's own advice
    // gets refused.
    const table = onBoard();
    const arrows = allArrows(table.geometry, MINIMAL_DIAMETER);
    const state = stateOf([
      { arrow: arrowAt(arrows, 0), owner: A, heads: 4 },
      { arrow: arrowAt(arrows, 1), owner: A, heads: 1, spent: 1 },
      { arrow: arrowAt(arrows, 2), owner: B, heads: 2 },
    ]);

    for (const move of table.rules.legalMoves(state)) {
      expect(() => table.rules.apply(state, move)).not.toThrow();
    }
  });

  it('only ever offers moves it will accept, on a board carrying a branch too', () => {
    // P22: branch toll is gone — a lone head on a join may still step, and every
    // offered move must still apply cleanly.
    const table = onBoard();
    const point = table.geometry.target(anArrow(table.geometry));
    const ins = table.geometry.inArrows(point);
    const outs = table.geometry.outArrows(point);
    const pinned = arrowAt(ins, 1);
    const state = stateOf([{ arrow: pinned, owner: A, heads: 1 }], A, {
      trail: { A: [arrowAt(ins, 0), pinned, arrowAt(outs, 0)] },
    });

    for (const move of table.rules.legalMoves(state)) {
      expect(() => table.rules.apply(state, move)).not.toThrow();
    }

    const offered = table.rules.legalMoves(state);
    expect(offered.some((m) => m.kind === 'step')).toBe(true);
    expect(offered.some((m) => m.kind === 'endTurn')).toBe(true);
  });
});
