/**
 * One test per scenario in movement.core.feature.
 *
 * Everything is observed **through the ports**: the board is a `GeometryPort`, so
 * no test names an adjacency it did not ask for, and the rules are a `RulesPort`,
 * so a second engine would satisfy the same suite. Occupancy, `spent` and the
 * active player are read from the `GameState` DTO — that is the port's own
 * contract, not an implementation detail (P04 D1, D3).
 *
 * @see docs/spec/movement/movement.core.feature
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn, speed, step } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  anArrow,
  anExitFrom,
  arrowAt,
  exitsFrom,
  headsOn,
  isEmpty,
  notAnExitFrom,
  onBoard,
  ownerOf,
  pathFrom,
  spentOn,
  stateOf,
  stepsFrom,
  totalHeads,
  twoDisjointPaths,
  twoExitsFrom,
} from './support';

// ── Rule: a step follows the grain and relocates a portion of a group ─────────

describe('a step follows the grain and relocates a portion of a group', () => {
  it('moves heads onto an empty out-arrow', () => {
    // "A legal step moves heads onto an empty out-arrow".
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const before = stateOf([{ arrow: a1, owner: A, heads: 1 }]);

    const after = table.rules.apply(before, step(a1, e1, 1));

    expect(isEmpty(after, a1)).toBe(true);
    expect(headsOn(after, e1)).toBe(1);
    expect(ownerOf(after, e1)).toBe(A);
    expect(spentOn(after, e1)).toBe(1);
  });

  it('leaves the remainder on the source when only a portion steps', () => {
    // "A partial step leaves the remainder on the source".
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const before = stateOf([{ arrow: a1, owner: A, heads: 3 }]);

    const after = table.rules.apply(before, step(a1, e1, 1));

    expect(headsOn(after, a1)).toBe(2);
    expect(ownerOf(after, a1)).toBe(A);
    expect(headsOn(after, e1)).toBe(1);
    expect(ownerOf(after, e1)).toBe(A);
  });

  it('vacates the source when the whole stack steps', () => {
    // "A whole-stack step vacates the source".
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const before = stateOf([{ arrow: a1, owner: A, heads: 2 }]);

    const after = table.rules.apply(before, step(a1, e1, 2));

    expect(isEmpty(after, a1)).toBe(true);
    expect(headsOn(after, e1)).toBe(2);
  });
});

// ── Rule: allowance is speed(N), spent, and nothing banks ─────────────────────

describe('allowance is speed(N), spent, and nothing banks', () => {
  it.each([
    { n: 1, expected: 1 },
    { n: 2, expected: 2 },
    { n: 3, expected: 2 },
    { n: 4, expected: 3 },
    { n: 8, expected: 4 },
    { n: 16, expected: 5 },
  ])('gives a fresh group of $n heads exactly $expected steps', ({ n, expected }) => {
    // "A fresh group gets exactly speed(N) steps" — speed(N) = 1 + floor(log2 N).
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const state = stateOf([{ arrow: a1, owner: A, heads: n, spent: 0 }]);

    expect(table.rules.effectiveSpeed(state, a1)).toBe(expected);
  });

  it('lets one stack take several steps in a turn while allowance remains', () => {
    // "A stack may take several steps in one turn while allowance remains".
    const table = onBoard();
    const path = pathFrom(table.geometry, anArrow(table.geometry), 4);
    const a1 = arrowAt(path, 0);
    const e1 = arrowAt(path, 1);
    const e2 = arrowAt(path, 2);
    const e3 = arrowAt(path, 3);
    let state = stateOf([{ arrow: a1, owner: A, heads: 4 }]);

    state = table.rules.apply(state, step(a1, e1, 4));
    state = table.rules.apply(state, step(e1, e2, 4));
    state = table.rules.apply(state, step(e2, e3, 4));

    expect(headsOn(state, e3)).toBe(4);
    expect(spentOn(state, e3)).toBe(3);
    // speed(4) is 3, so the fourth step is not there to take.
    expect(stepsFrom(table, state, e3)).toEqual([]);
  });

  it('charges each of two interleaved stacks only for its own steps', () => {
    // "Two stacks may interleave their steps". Both 2-stacks move as a whole, so
    // "steps again from a1" is that group taking its second step — from the arrow
    // it now stands on. The point of the scenario is whose `spent` was charged.
    const table = onBoard();
    const [first, second] = twoDisjointPaths(table.geometry, [3, 2], MINIMAL_DIAMETER);
    const a1 = arrowAt(first, 0);
    const e1 = arrowAt(first, 1);
    const f1 = arrowAt(first, 2);
    const a2 = arrowAt(second, 0);
    const e2 = arrowAt(second, 1);
    let state = stateOf([
      { arrow: a1, owner: A, heads: 2 },
      { arrow: a2, owner: A, heads: 2 },
    ]);

    state = table.rules.apply(state, step(a1, e1, 2));
    state = table.rules.apply(state, step(a2, e2, 2));
    state = table.rules.apply(state, step(e1, f1, 2));

    expect(spentOn(state, f1)).toBe(2);
    expect(spentOn(state, e2)).toBe(1);
    // The second group kept the step it never spent; the first has none left.
    expect(stepsFrom(table, state, e2).length).toBeGreaterThan(0);
    expect(stepsFrom(table, state, f1)).toEqual([]);
  });

  it('discards unused allowance and every merge override when the turn ends', () => {
    // "Ending the turn discards unused allowance".
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const barred = notAnExitFrom(table.geometry, a1, MINIMAL_DIAMETER);
    const before = stateOf([
      { arrow: a1, owner: A, heads: 4, spent: 1 },
      { arrow: barred, owner: A, heads: 2, spent: 1, speedOverride: 0 },
    ]);

    const after = table.rules.apply(before, endTurn());

    expect(after.activePlayer).toBe(B);
    expect(spentOn(after, a1)).toBe(0);
    expect(spentOn(after, barred)).toBe(0);
    // Overrides are gone, so allowance is plain speed(N) again.
    expect(table.rules.effectiveSpeed(after, a1)).toBe(speed(4));
    expect(table.rules.effectiveSpeed(after, barred)).toBe(speed(2));
  });
});

// ── Rule: splitting inherits spent; only the moving part pays ─────────────────

describe('splitting inherits spent, and only the moving part pays', () => {
  it('lets the leftover singleton move after a fresh 3-stack sends its pair', () => {
    // SPEC §3: remainder inherits parent spent (not +1). Fresh 3 at spent 0,
    // send 2: leftover 1 keeps spent 0, speed(1)=1, so it may still step.
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const [e1, e2] = twoExitsFrom(table.geometry, a1);
    const before = stateOf([{ arrow: a1, owner: A, heads: 3, spent: 0 }]);
    expect(e1).not.toBe(e2);

    const after = table.rules.apply(before, step(a1, e1, 2));

    expect(headsOn(after, a1)).toBe(1);
    expect(spentOn(after, a1)).toBe(0);
    expect(headsOn(after, e1)).toBe(2);
    expect(spentOn(after, e1)).toBe(1);
    expect(stepsFrom(table, after, a1).length).toBeGreaterThan(0);
  });

  it('leaves a remainder that may still act after the parent has stepped', () => {
    // "After one step, a split leaves a remainder that may still act".
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const [e1, e2] = twoExitsFrom(table.geometry, a1);
    const before = stateOf([{ arrow: a1, owner: A, heads: 4, spent: 1 }]);
    expect(e1).not.toBe(e2);

    const after = table.rules.apply(before, step(a1, e1, 2));

    expect(headsOn(after, a1)).toBe(2);
    expect(spentOn(after, a1)).toBe(1);
    expect(headsOn(after, e1)).toBe(2);
    expect(spentOn(after, e1)).toBe(2);
    // Both parts inherited spent 1; only the movers paid, so the remainder — a
    // 2-stack at speed 2 — can still go, including down the other exit.
    expect(stepsFrom(table, after, a1).length).toBeGreaterThan(0);
  });

  it('refuses to let a spent stack split into fresh scouts', () => {
    // "A stack that has spent its allowance cannot split into fresh scouts".
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const before = stateOf([{ arrow: a1, owner: A, heads: 4, spent: 3 }]);

    expect(() => table.rules.apply(before, step(a1, e1, 1))).toThrow(ContractViolation);
  });
});

// ── Rule: merging is automatic and costs the turn ─────────────────────────────

describe('merging is automatic and costs the turn', () => {
  it('merges onto own heads without a separate move', () => {
    // "Stepping onto own heads merges without a separate move".
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const before = stateOf([
      { arrow: a1, owner: A, heads: 1 },
      { arrow: e1, owner: A, heads: 2, spent: 0 },
    ]);

    const after = table.rules.apply(before, step(a1, e1, 1));

    expect(headsOn(after, e1)).toBe(3);
    expect(ownerOf(after, e1)).toBe(A);
    expect(isEmpty(after, a1)).toBe(true);
    // A single group on e1, not two co-tenants: all three heads stand in one
    // group with one allowance, and nothing else is left on the board (P04 D1).
    expect(totalHeads(after)).toBe(3);
    expect(after.groups.size).toBe(1);
  });

  it('leaves a minority arrival at speed 1, with one step still to take', () => {
    // "A minority arrival leaves the merged stack at speed 1".
    const table = onBoard();
    const src = anArrow(table.geometry);
    const dest = anExitFrom(table.geometry, src);
    const before = stateOf([
      { arrow: dest, owner: A, heads: 3, spent: 0 },
      { arrow: src, owner: A, heads: 1, spent: 0 },
    ]);

    const after = table.rules.apply(before, step(src, dest, 1));

    expect(headsOn(after, dest)).toBe(4);
    expect(table.rules.effectiveSpeed(after, dest)).toBe(1);
    expect(stepsFrom(table, after, dest).length).toBeGreaterThan(0);
  });

  it('leaves an equal arrival at speed 1', () => {
    // "An equal arrival leaves the merged stack at speed 1". Half of the merged
    // stack is fresh, so it still moves (§3).
    const table = onBoard();
    const src = anArrow(table.geometry);
    const dest = anExitFrom(table.geometry, src);
    const before = stateOf([
      { arrow: dest, owner: A, heads: 2, spent: 0 },
      { arrow: src, owner: A, heads: 2, spent: 0 },
    ]);

    const after = table.rules.apply(before, step(src, dest, 2));

    expect(headsOn(after, dest)).toBe(4);
    expect(table.rules.effectiveSpeed(after, dest)).toBe(1);
  });

  it('bars a majority arrival for the rest of the turn', () => {
    // "A majority arrival bars the merged stack for the turn".
    const table = onBoard();
    const src = anArrow(table.geometry);
    const dest = anExitFrom(table.geometry, src);
    const before = stateOf([
      { arrow: dest, owner: A, heads: 1, spent: 0 },
      { arrow: src, owner: A, heads: 2, spent: 0 },
    ]);

    const after = table.rules.apply(before, step(src, dest, 2));

    expect(headsOn(after, dest)).toBe(3);
    expect(table.rules.effectiveSpeed(after, dest)).toBe(0);
    expect(stepsFrom(table, after, dest)).toEqual([]);
  });
});

// ── Rule: the turn ends explicitly; exhaustion offers only end-turn ───────────

describe('the turn ends explicitly, and exhaustion offers only end-turn', () => {
  it('advances the active player on end-turn', () => {
    // "End-turn advances the active player".
    const table = onBoard();
    const before = stateOf([{ arrow: anArrow(table.geometry), owner: A, heads: 1 }]);

    expect(table.rules.apply(before, endTurn()).activePlayer).toBe(B);
  });

  it('offers only end-turn when no group has a whole step left', () => {
    // "When no group has a whole step left, only end-turn is legal". Exhaustion
    // restricts legalMoves; it does not end the turn behind the player's back
    // (P04 D6, confirmed).
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const a2 = notAnExitFrom(table.geometry, a1, MINIMAL_DIAMETER);
    const state = stateOf([
      { arrow: a1, owner: A, heads: 1, spent: 1 },
      { arrow: a2, owner: A, heads: 2, spent: 2 },
    ]);

    expect(table.rules.legalMoves(state).map((m) => m.kind)).toEqual(['endTurn']);
  });

  it('accepts an end-turn that leaves allowance unspent', () => {
    // "Ending with leftover allowance is legal" (§4: skipping is normal).
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const before = stateOf([{ arrow: a1, owner: A, heads: 4, spent: 0 }]);
    // The stack has all three of its steps and several places to spend them.
    expect(exitsFrom(table.geometry, a1).length).toBe(3);

    const after = table.rules.apply(before, endTurn());

    expect(after.activePlayer).toBe(B);
    expect(headsOn(after, a1)).toBe(4);
  });
});
