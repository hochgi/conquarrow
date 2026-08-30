/**
 * docs/spec/combat/combat.core.feature — one test per scenario.
 *
 * Contact combat replaces P04's refusal of enemy-occupied destinations (§11 items
 * 37–38). Stay-behind, fight-to-wipe, mark only on land.
 *
 * @see docs/spec/combat/combat.md
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn, step } from '@conquarrow/contracts';
import {
  A,
  B,
  anExitFrom,
  anArrow,
  headsOn,
  isTrail,
  onBoard,
  ownerOf,
  pick,
  slotsAt,
  spentOn,
  stateOf,
  trailOf,
  via,
} from './support';

const junction = (table: ReturnType<typeof onBoard>) =>
  slotsAt(table.geometry, table.geometry.target(anArrow(table.geometry)));

// ── Rule: the only combat trigger is stepping onto an enemy group ────────────

describe('the only combat trigger is stepping onto an enemy group', () => {
  it('resolves contact combat when stepping onto an enemy-occupied arrow', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 4 },
        { arrow: e1, owner: B, heads: 3 },
      ],
      A,
    );

    const after = table.rules.apply(before, step(from, e1, 3));

    // 3v3 → attacker 2, defender 0; attacker occupies e1; stay-behind 1; one allowance.
    expect(ownerOf(after, e1)).toBe(A);
    expect(headsOn(after, e1)).toBe(2);
    expect(spentOn(after, e1)).toBe(1);
    expect(headsOn(after, from)).toBe(1);
  });

  it('does not fight when two stacks merely point into the same point', () => {
    // §11 item 37: contested-point combat is withdrawn. Shadowing survives.
    const table = onBoard();
    const { ins, outs } = junction(table);
    const aIn = pick(ins, 0);
    const bIn = pick(ins, 1);
    const emptyOut = pick(outs, 0);
    const before = stateOf(
      [
        { arrow: aIn, owner: A, heads: 2 },
        { arrow: bIn, owner: B, heads: 2 },
      ],
      A,
    );

    const after = table.rules.apply(before, step(aIn, emptyOut, 2));

    expect(headsOn(after, emptyOut)).toBe(2);
    expect(headsOn(after, bIn)).toBe(2);
    expect(ownerOf(after, bIn)).toBe(B);
  });

  it('fights nothing when standing beside an enemy-occupied arrow', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 2 },
        { arrow: e1, owner: B, heads: 2 },
      ],
      A,
    );

    // No step is forced (§6.2), so a stack may stand beside an enemy all turn.
    // Declining is the absence of a move: the seat simply ends its turn.
    expect(table.rules.legalMoves(before).some((m) => m.kind === 'endTurn')).toBe(true);
    const after = table.rules.apply(before, endTurn());

    expect(headsOn(after, from)).toBe(2);
    expect(headsOn(after, e1)).toBe(2);
  });
});

// ── Rule: stay-behind on attack ──────────────────────────────────────────────

describe('stay-behind on attack', () => {
  it('refuses when a lone head would attack', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 1 },
        { arrow: e1, owner: B, heads: 1 },
      ],
      A,
    );

    expect(() => table.rules.apply(before, step(from, e1, 1))).toThrow(ContractViolation);
    expect(
      table.rules.legalMoves(before).some(
        (m) => m.kind === 'step' && m.from === from && m.exit === e1,
      ),
    ).toBe(false);
  });

  it('refuses an attack that would empty from', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 3 },
        { arrow: e1, owner: B, heads: 1 },
      ],
      A,
    );

    expect(() => table.rules.apply(before, step(from, e1, 3))).toThrow(ContractViolation);
  });
});

// ── Rule: threat-weighted floor losses ───────────────────────────────────────

describe('threat-weighted floor losses', () => {
  it.each([
    { A_step: 1, D: 1, A_left: 1, D_left: 0 },
    { A_step: 2, D: 2, A_left: 1, D_left: 0 },
    { A_step: 3, D: 3, A_left: 2, D_left: 0 },
    // 4v4 → A_left 2 under max=D scaling (wa:wd = 1:2 → atk_loss = floor(4/2) = 2).
    { A_step: 4, D: 4, A_left: 2, D_left: 0 },
  ] as const)(
    'equal stacks favour the attacker ($A_step v $D → $A_left : $D_left)',
    ({ A_step, D, A_left, D_left }) => {
      const table = onBoard();
      const from = anArrow(table.geometry);
      const e1 = anExitFrom(table.geometry, from);
      const before = stateOf(
        [
          { arrow: from, owner: A, heads: A_step + 1 },
          { arrow: e1, owner: B, heads: D },
        ],
        A,
      );

      const after = table.rules.apply(before, step(from, e1, A_step));

      expect(headsOn(after, e1)).toBe(A_left);
      expect(ownerOf(after, e1)).toBe(A);
      expect(headsOn(after, from)).toBe(1);
      expect(D_left).toBe(0);
    },
  );

  it('may take zero floor loss when the attacker is moderately larger (5v3)', () => {
    // Accepted PoC (§6.2): do not add min-1. Stay-behind: heads 6, count 5.
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 6 },
        { arrow: e1, owner: B, heads: 3 },
      ],
      A,
    );

    const after = table.rules.apply(before, step(from, e1, 5));

    expect(ownerOf(after, e1)).toBe(A);
    expect(headsOn(after, e1)).toBe(5);
    expect(headsOn(after, from)).toBe(1);
  });

  it('does not land a wiped attacker and does not mark the destination', () => {
    // Stay-behind 1, step 1 vs D=3 → attacker wipe; bounce; no trail mark on e1.
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 2 },
        { arrow: e1, owner: B, heads: 3 },
      ],
      A,
    );

    const after = table.rules.apply(before, step(from, e1, 1));

    expect(ownerOf(after, e1)).toBe(B);
    expect(headsOn(after, e1)).toBeGreaterThan(0);
    expect(headsOn(after, from)).toBe(1);
    expect(isTrail(after, A, e1)).toBe(false);
  });

  it('yields the arrow to the attacker when the defender is wiped', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 4 },
        { arrow: e1, owner: B, heads: 3 },
      ],
      A,
    );

    const after = table.rules.apply(before, step(from, e1, 3));

    expect(ownerOf(after, e1)).toBe(A);
    expect(headsOn(after, e1)).toBe(2);
    expect(isTrail(after, A, e1)).toBe(true);
  });
});

// ── Rule: combat then cut on the same step ───────────────────────────────────

describe('combat then cut on the same step', () => {
  it('resolves combat before evaporation when contacting a trail arrow', () => {
    const table = onBoard();
    const { ins, outs } = junction(table);
    const theirIn = pick(ins, 0);
    const e1 = pick(outs, 0);
    const ourIn = pick(ins, 1);
    const before = stateOf(
      [
        { arrow: ourIn, owner: A, heads: 2 },
        { arrow: e1, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { A: [ourIn], B: [theirIn, e1] },
      },
    );
    expect(table.rules.crossesTrail(before, via(ourIn, e1), B)).toBe(true);

    const after = table.rules.apply(before, step(ourIn, e1, 1));

    // Combat first: 1v1 attacker lands with 1; stay-behind on ourIn.
    expect(ownerOf(after, e1)).toBe(A);
    expect(headsOn(after, e1)).toBe(1);
    expect(headsOn(after, ourIn)).toBe(1);
    // Then cut: B's trail evaporates.
    expect(trailOf(after, B).length).toBeLessThan(2);
  });
});
