/**
 * The EARS invariants of docs/spec/combat/combat.md, as properties.
 *
 * @see docs/spec/combat/combat.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn, step } from '@conquarrow/contracts';
import {
  A,
  B,
  anArrow,
  anExitFrom,
  headsOn,
  isTrail,
  onBoard,
  ownerOf,
  pick,
  slotsAt,
  snapshot,
  spentOn,
  stateOf,
  trailOf,
  via,
} from './support';

describe('contact combat triggers only on an enemy-occupied destination', () => {
  it('resolves losses when stepping onto an enemy group', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 3 },
        { arrow: e1, owner: B, heads: 2 },
      ],
      A,
    );

    const after = table.rules.apply(before, step(from, e1, 2));

    expect(ownerOf(after, e1)).toBe(A);
    expect(headsOn(after, e1)).toBe(1);
    expect(spentOn(after, e1)).toBe(1);
    expect(headsOn(after, from)).toBe(1);
  });

  it('does not treat stacks that merely share a point ahead as in combat', () => {
    const table = onBoard();
    const { ins, outs } = slotsAt(table.geometry, table.geometry.target(anArrow(table.geometry)));
    const before = stateOf(
      [
        { arrow: pick(ins, 0), owner: A, heads: 1 },
        { arrow: pick(ins, 1), owner: B, heads: 1 },
      ],
      A,
    );

    const after = table.rules.apply(before, step(pick(ins, 0), pick(outs, 0), 1));

    expect(headsOn(after, pick(ins, 1))).toBe(1);
  });

  it('permits declining — no step is ever compelled', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 3 },
        { arrow: e1, owner: B, heads: 3 },
      ],
      A,
    );

    // Declining is the absence of a move (P51): the offer holds `endTurn`, and
    // taking it leaves both stacks exactly where combat never happened.
    const offer = table.rules.legalMoves(before);
    expect(offer.some((m) => m.kind === 'endTurn')).toBe(true);
    const after = table.rules.apply(before, endTurn());
    expect(headsOn(after, from)).toBe(3);
    expect(headsOn(after, e1)).toBe(3);
  });
});

describe('equals favour the attacker; landing follows remaining heads', () => {
  it.each([1, 2, 3, 4, 5, 6] as const)(
    'leaves the defender at 0 when A = D = %i',
    (n) => {
      const table = onBoard();
      const losses = table.rules.combatLosses(n, n);
      expect(losses.defender).toBe(n);
      expect(n - losses.attacker).toBeGreaterThan(0);
    },
  );

  it('lands when the defender is wiped and refuses when the attacker is wiped', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);

    const wipeDef = table.rules.apply(
      stateOf(
        [
          { arrow: from, owner: A, heads: 4 },
          { arrow: e1, owner: B, heads: 3 },
        ],
        A,
      ),
      step(from, e1, 3),
    );
    expect(ownerOf(wipeDef, e1)).toBe(A);
    expect(isTrail(wipeDef, A, e1)).toBe(true);

    const wipeAtk = table.rules.apply(
      stateOf(
        [
          { arrow: from, owner: A, heads: 2 },
          { arrow: e1, owner: B, heads: 3 },
        ],
        A,
      ),
      step(from, e1, 1),
    );
    expect(ownerOf(wipeAtk, e1)).toBe(B);
    expect(headsOn(wipeAtk, from)).toBe(1);
    expect(isTrail(wipeAtk, A, e1)).toBe(false);
  });

  it('refuses stay-behind violations', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    expect(() =>
      table.rules.apply(
        stateOf(
          [
            { arrow: from, owner: A, heads: 1 },
            { arrow: e1, owner: B, heads: 1 },
          ],
          A,
        ),
        step(from, e1, 1),
      ),
    ).toThrow(ContractViolation);
  });
});

describe('combat before cut; exact arithmetic; purity', () => {
  it('resolves combat before the cut on a trail-arrow contact', () => {
    const table = onBoard();
    const { ins, outs } = slotsAt(table.geometry, table.geometry.target(anArrow(table.geometry)));
    const theirIn = pick(ins, 0);
    const e1 = pick(outs, 0);
    const ourIn = pick(ins, 1);
    const before = stateOf(
      [
        { arrow: ourIn, owner: A, heads: 2 },
        { arrow: e1, owner: B, heads: 1 },
      ],
      A,
      { trail: { A: [ourIn], B: [theirIn, e1] } },
    );
    expect(table.rules.crossesTrail(before, via(ourIn, e1), B)).toBe(true);

    const after = table.rules.apply(before, step(ourIn, e1, 1));

    expect(ownerOf(after, e1)).toBe(A);
    expect(trailOf(after, B).length).toBeLessThan(2);
  });

  it('matches the exact floor table for representative A,D pairs', () => {
    const table = onBoard();
    const cases: readonly { a: number; d: number; atk: number; def: number }[] = [
      { a: 1, d: 1, atk: 0, def: 1 },
      { a: 2, d: 2, atk: 1, def: 2 },
      { a: 3, d: 3, atk: 1, def: 3 },
      { a: 5, d: 3, atk: 0, def: 3 },
      { a: 1, d: 3, atk: 1, def: 1 },
    ];
    for (const { a, d, atk, def } of cases) {
      expect(table.rules.combatLosses(a, d)).toEqual({ attacker: atk, defender: def });
    }
  });

  it('does not mutate the input state and is deterministic', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, from);
    const s0 = stateOf(
      [
        { arrow: from, owner: A, heads: 3 },
        { arrow: e1, owner: B, heads: 2 },
      ],
      A,
    );
    const before = snapshot(s0);
    const move = step(from, e1, 2);

    const s1 = table.rules.apply(s0, move);

    expect(snapshot(s0)).toEqual(before);
    expect(snapshot(table.rules.apply(s0, move))).toEqual(snapshot(s1));
  });
});
