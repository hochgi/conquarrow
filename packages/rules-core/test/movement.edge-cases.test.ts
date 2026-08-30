/**
 * One test per scenario in movement.edge-cases.feature.
 *
 * Refusals assert the **type** `ContractViolation`, never a bare `.toThrow()`.
 * The phase-2 skeleton throws a plain `Error`, so a bare assertion would pass
 * against nothing at all and keep passing in phase 3 whether the check was ever
 * written (contracts/src/errors.ts). A wrong step must fail loudly rather than
 * become a silent wrong board state.
 *
 * @see docs/spec/movement/movement.edge-cases.feature
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn, step } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL,
  MINIMAL_DIAMETER,
  SPACIOUS,
  SPACIOUS_DIAMETER,
  anArrow,
  anExitFrom,
  arrowAt,
  headsOn,
  notAnExitFrom,
  onBoard,
  pathFrom,
  snapshot,
  spentOn,
  stateOf,
  stepsFrom,
  twoSourcesOneDestination,
} from './support';

// ── Rule: illegal steps are refused with a contract violation ─────────────────

describe('illegal steps are refused with a contract violation', () => {
  it('refuses an exit that is not an out-arrow of the source’s target', () => {
    // "A step whose exit is not an out-arrow of the source's target is refused".
    // Movement follows the grain (§2), so an arrow the source's point does not
    // lead to is not a slow step — it is no step at all. Run on `spacious`, whose
    // diameter 2 makes "not adjacent" expressible at all (P02 D3).
    const table = onBoard(SPACIOUS);
    const a1 = anArrow(table.geometry);
    const x1 = notAnExitFrom(table.geometry, a1, SPACIOUS_DIAMETER);
    const before = stateOf([{ arrow: a1, owner: A, heads: 1 }]);

    expect(() => table.rules.apply(before, step(a1, x1, 1))).toThrow(ContractViolation);
  });

  it('refuses a step that overdraws the source', () => {
    // "A step that overdraws the source is refused".
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const before = stateOf([{ arrow: a1, owner: A, heads: 2 }]);

    expect(() => table.rules.apply(before, step(a1, e1, 3))).toThrow(ContractViolation);
  });

  it('refuses a step from an empty arrow', () => {
    // "A step from an empty arrow is refused".
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const before = stateOf([]);

    expect(() => table.rules.apply(before, step(a1, e1, 1))).toThrow(ContractViolation);
  });

  it('refuses a step that moves the opponent’s group', () => {
    // "A step from an opponent's group is refused". Only the active player's
    // groups may step (§4).
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const before = stateOf([{ arrow: a1, owner: B, heads: 2 }], A);

    expect(() => table.rules.apply(before, step(a1, e1, 1))).toThrow(ContractViolation);
  });

  it('resolves contact combat on an opponent-occupied arrow', () => {
    // P06 (§6.2 / item 38): stay-behind; 1v1 lands with count 1 of 2.
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const before = stateOf([
      { arrow: a1, owner: A, heads: 2 },
      { arrow: e1, owner: B, heads: 1 },
    ]);

    const after = table.rules.apply(before, step(a1, e1, 1));
    expect(after.groups.get(e1)?.owner).toBe(A);
    expect(after.groups.get(e1)?.heads).toBe(1);
    expect(after.groups.get(a1)?.heads).toBe(1);
  });

  it('refuses a step with no allowance left', () => {
    // "A step with no allowance left is refused". speed(1) is 1, so a single head
    // that has stepped is done for the turn.
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const before = stateOf([{ arrow: a1, owner: A, heads: 1, spent: 1 }]);

    expect(() => table.rules.apply(before, step(a1, e1, 1))).toThrow(ContractViolation);
  });
});

// ── Rule: once barred, a later arrival cannot un-bar ──────────────────────────

describe('once barred, a later arrival cannot un-bar', () => {
  it('keeps a barred stack barred when a small group joins it afterwards', () => {
    // "A small arrival after a majority merge leaves the stack barred". *Any* is
    // load-bearing (§3): merging big-then-small must not launder the restriction,
    // or the order the player chose would decide the rule.
    const table = onBoard();
    const { big, small, dest } = twoSourcesOneDestination(table.geometry);
    let state = stateOf([
      { arrow: dest, owner: A, heads: 1, spent: 0 },
      { arrow: big, owner: A, heads: 2, spent: 0 },
      { arrow: small, owner: A, heads: 1, spent: 0 },
    ]);

    state = table.rules.apply(state, step(big, dest, 2));
    expect(headsOn(state, dest)).toBe(3);
    expect(table.rules.effectiveSpeed(state, dest)).toBe(0);

    state = table.rules.apply(state, step(small, dest, 1));

    expect(headsOn(state, dest)).toBe(4);
    expect(table.rules.effectiveSpeed(state, dest)).toBe(0);
    expect(stepsFrom(table, state, dest)).toEqual([]);
  });

  it('keeps the destination’s spent on merge and discards the arrivals’', () => {
    // "On merge, destination spent is kept and arrivals' spent is discarded".
    // The arrivals already paid to get there; they are carried, not carrying (§3).
    const table = onBoard();
    const src = anArrow(table.geometry);
    const dest = anExitFrom(table.geometry, src);
    const before = stateOf([
      { arrow: dest, owner: A, heads: 2, spent: 1 },
      { arrow: src, owner: A, heads: 1, spent: 0 },
    ]);

    const after = table.rules.apply(before, step(src, dest, 1));

    expect(headsOn(after, dest)).toBe(3);
    expect(spentOn(after, dest)).toBe(1);
    expect(table.rules.effectiveSpeed(after, dest)).toBe(1);
  });
});

// ── Rule: the conveyor is priced, not banned ──────────────────────────────────

describe('the conveyor is priced, not banned', () => {
  it('bars an equal-link chain on its second merge', () => {
    // "An equal-link chain is barred on the second merge". §3's conveyor: equal
    // links do not free-roll, because the arriving stack grows every link and
    // outnumbers the next parked head. A naive chain gets one hop and stops.
    const table = onBoard();
    const chain = pathFrom(table.geometry, anArrow(table.geometry), 3);
    const c0 = arrowAt(chain, 0);
    const c1 = arrowAt(chain, 1);
    const c2 = arrowAt(chain, 2);
    let state = stateOf([
      { arrow: c0, owner: A, heads: 1 },
      { arrow: c1, owner: A, heads: 1 },
      { arrow: c2, owner: A, heads: 1 },
    ]);

    state = table.rules.apply(state, step(c0, c1, 1));
    expect(headsOn(state, c1)).toBe(2);
    expect(table.rules.effectiveSpeed(state, c1)).toBe(1);

    state = table.rules.apply(state, step(c1, c2, 2));

    expect(headsOn(state, c2)).toBe(3);
    expect(table.rules.effectiveSpeed(state, c2)).toBe(0);
    expect(stepsFrom(table, state, c2)).toEqual([]);
  });
});

// ── Rule: apply is pure ──────────────────────────────────────────────────────

describe('apply is pure', () => {
  it('does not mutate its input state', () => {
    // "apply does not mutate its input state" (ADR 0001, P01 D5). The snapshot is
    // taken before the call and compared after, so an in-place edit of the
    // occupancy map is caught even though the DTO is typed readonly.
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const s0 = stateOf([{ arrow: a1, owner: A, heads: 3 }]);
    const before = snapshot(s0);

    const s1 = table.rules.apply(s0, step(a1, e1, 1));

    expect(snapshot(s0)).toEqual(before);
    expect(snapshot(s1)).not.toEqual(before);
    expect(headsOn(s1, e1)).toBe(1);
    expect(spentOn(s1, e1)).toBe(1);
  });

  it('agrees exactly when two equal states take the same move', () => {
    // "Two equal applies agree exactly". Independently built copies, so an
    // accidental ordering dependence shows up as a mismatch here rather than as
    // replay drift later (ADR 0001).
    const table = onBoard();
    const a1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, a1);
    const placements = [{ arrow: a1, owner: A, heads: 3 }] as const;
    const move = step(a1, e1, 2);

    const left = table.rules.apply(stateOf([...placements]), move);
    const right = table.rules.apply(stateOf([...placements]), move);

    expect(snapshot(right)).toEqual(snapshot(left));
    expect(table.rules.legalMoves(right)).toEqual(table.rules.legalMoves(left));
  });
});

// ── kept honest: the fixture the refusal scenarios lean on ────────────────────

describe('the board the refusal scenarios lean on', () => {
  it.each([
    { label: 'minimal', description: MINIMAL, diameter: MINIMAL_DIAMETER },
    { label: 'spacious', description: SPACIOUS, diameter: SPACIOUS_DIAMETER },
  ])('offers $label an arrow that is not an exit', ({ description, diameter }) => {
    // Not a spec scenario: a guard so that "refused because it is against the
    // grain" can never quietly become "refused because the ids were equal".
    const { geometry } = onBoard(description);
    const a1 = anArrow(geometry);
    const x1 = notAnExitFrom(geometry, a1, diameter);

    expect(x1).not.toBe(a1);
    expect(geometry.outArrows(geometry.target(a1))).not.toContain(x1);
  });

  it('still ends a turn from a state where nothing can move', () => {
    // Not a spec scenario either: end-turn must not require that allowance was
    // exhausted, nor that anything was ever spent (P04 D6).
    const table = onBoard();
    const state = stateOf([{ arrow: anArrow(table.geometry), owner: A, heads: 1, spent: 1 }]);

    expect(table.rules.apply(state, endTurn()).activePlayer).toBe(B);
  });
});
