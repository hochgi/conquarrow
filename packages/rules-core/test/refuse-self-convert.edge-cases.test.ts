/**
 * docs/spec/refuse-self-convert/refuse-self-convert.edge-cases.feature — rules
 * scenarios (attacks, portions, opponent convert, purity). Adapter scenarios
 * live in packages/web.
 *
 * @see docs/spec/refuse-self-convert/refuse-self-convert.md
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn, step } from '@conquarrow/contracts';
import type { Move, StepMove } from '@conquarrow/contracts';
import {
  A,
  B,
  aRunFromHome,
  anArrow,
  anExitFrom,
  anInterleaving,
  arrowAt,
  exitsFrom,
  headsOn,
  isTrail,
  MINIMAL_DIAMETER,
  onBoard,
  onTiling,
  owned,
  ownerOf,
  pick,
  snapshot,
  stateOf,
  territoryOf,
} from './support';
import type { ArrowId, GameState } from './support';
import type { Table } from './support';

const WOULD_CONVERT =
  'step onto enemy territory without a territory-grade trail would convert';

const stepsOnto = (
  moves: readonly Move[],
  from: ArrowId,
  exit: ArrowId,
): readonly StepMove[] =>
  moves.filter((m): m is StepMove => m.kind === 'step' && m.from === from && m.exit === exit);

const expectRefused = (run: () => unknown): void => {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ContractViolation);
  expect((thrown as ContractViolation).message).toBe(WOULD_CONVERT);
};

const stackGradeAgainstEnemy = (
  table: Table,
  heads: number,
  occupiedByB = 0,
): { readonly from: ArrowId; readonly exit: ArrowId; readonly state: GameState } => {
  const from = anArrow(table.geometry);
  const exit = anExitFrom(table.geometry, from);
  const placements =
    occupiedByB > 0
      ? [
          { arrow: from, owner: A, heads },
          { arrow: exit, owner: B, heads: occupiedByB },
        ]
      : [{ arrow: from, owner: A, heads }];
  const state = stateOf(placements, A, {
    trail: { A: [from] },
    territory: [{ arrow: exit, owner: B }],
  });
  if (table.rules.anchorGrade(state, from, A) !== 'stack') {
    throw new Error(`setup: expected stack-grade at ${String(from)}`);
  }
  return { from, exit, state };
};

const territoryGradeRaid = (
  table: Table,
  heads: number,
  occupiedByB = 0,
): { readonly from: ArrowId; readonly exit: ArrowId; readonly state: GameState } => {
  const from = anArrow(table.geometry);
  const exit = anExitFrom(table.geometry, from);
  const home = pick(table.geometry.inArrows(table.geometry.origin(from)), 0);
  if (home === exit) throw new Error('setup: home collided with the enemy exit');
  const placements =
    occupiedByB > 0
      ? [
          { arrow: from, owner: A, heads },
          { arrow: exit, owner: B, heads: occupiedByB },
        ]
      : [{ arrow: from, owner: A, heads }];
  const state = stateOf(placements, A, {
    trail: { A: [from] },
    territory: [
      { arrow: home, owner: A },
      { arrow: exit, owner: B },
    ],
  });
  if (table.rules.anchorGrade(state, from, A) !== 'territory') {
    throw new Error(`setup: expected territory-grade at ${String(from)}`);
  }
  return { from, exit, state };
};

// ── Rule: Attacks ────────────────────────────────────────────────────────────

describe('attacks', () => {
  it('refuses an unprotected attack onto an enemy stack on that enemy’s territory, before combat', () => {
    // "Unprotected attack onto an enemy stack standing on that enemy's territory is illegal"
    const table = onBoard();
    const { from, exit, state } = stackGradeAgainstEnemy(table, 3, 2);
    const defenders = headsOn(state, exit);

    expect(stepsOnto(table.rules.legalMoves(state), from, exit)).toEqual([]);
    expectRefused(() => table.rules.apply(state, step(from, exit, 2)));
    expect(headsOn(state, exit)).toBe(defenders);
    expect(ownerOf(state, exit)).toBe(B);
  });

  it('still offers a protected raid attack on enemy territory', () => {
    // "Protected raid may still attack on enemy territory"
    const table = onBoard();
    const { from, exit, state } = territoryGradeRaid(table, 4, 3);

    expect(stepsOnto(table.rules.legalMoves(state), from, exit).length).toBeGreaterThan(0);
    const after = table.rules.apply(state, step(from, exit, 3));
    // 3v3 contact: attacker 2 on exit, stay-behind 1 on from (combat.core).
    expect(ownerOf(after, exit)).toBe(A);
    expect(headsOn(after, exit)).toBe(2);
    expect(headsOn(after, from)).toBe(1);
  });

  it('does not refuse an unprotected attack onto an enemy stack on unclaimed ground', () => {
    // "Unprotected attack onto an enemy stack on neutral ground is not this rule"
    const table = onBoard();
    const from = anArrow(table.geometry);
    const exit = anExitFrom(table.geometry, from);
    const state = stateOf(
      [
        { arrow: from, owner: A, heads: 4 },
        { arrow: exit, owner: B, heads: 3 },
      ],
      A,
      { trail: { A: [from] } },
    );
    if (table.rules.anchorGrade(state, from, A) !== 'stack') {
      throw new Error('setup: expected stack-grade fragment');
    }
    if (territoryOf(state, exit) !== undefined) {
      throw new Error('setup: exit must be unclaimed');
    }

    expect(stepsOnto(table.rules.legalMoves(state), from, exit).length).toBeGreaterThan(0);
    const after = table.rules.apply(state, step(from, exit, 3));
    expect(ownerOf(after, exit)).toBe(A);
    expect(headsOn(after, exit)).toBe(2);
    expect(headsOn(after, from)).toBe(1);
  });
});

// ── Rule: Portions and remainders ────────────────────────────────────────────

describe('portions and remainders', () => {
  it('omits every count onto an enemy-territory grain out', () => {
    // "Every count is omitted"
    const table = onBoard();
    const { from, exit, state } = stackGradeAgainstEnemy(table, 16);
    const offered = stepsOnto(table.rules.legalMoves(state), from, exit);
    for (let count = 1; count <= 16; count += 1) {
      expect(offered.some((m) => m.count === count)).toBe(false);
    }
  });

  it('does not license the advance by leaving a sentry on the fragment', () => {
    // "Leaving a sentry on the fragment does not license the advance"
    const table = onBoard();
    const { from, exit, state } = stackGradeAgainstEnemy(table, 16);

    expect(stepsOnto(table.rules.legalMoves(state), from, exit).some((m) => m.count === 15)).toBe(
      false,
    );
    expectRefused(() => table.rules.apply(state, step(from, exit, 15)));
  });
});

// ── Rule: Opponent-caused conversion unchanged ───────────────────────────────

describe('opponent-caused conversion unchanged', () => {
  it('still converts after a cut drops a raider’s territory grade inside enemy land', () => {
    // "Cut demotion of a raider already inside still converts"
    const table = onBoard();
    const { trailIn, trailOut: mid, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const tip = anExitFrom(table.geometry, mid);
    const home = pick(table.geometry.inArrows(table.geometry.origin(trailIn)), 0);

    const before = stateOf(
      [
        { arrow: ourIn, owner: A, heads: 1 },
        { arrow: tip, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { A: [ourIn], B: [trailIn, mid, tip] },
        territory: [
          { arrow: home, owner: B },
          { arrow: tip, owner: A },
        ],
      },
    );
    expect(table.rules.anchorGrade(before, tip, B)).toBe('territory');

    const after = table.rules.apply(before, step(ourIn, ourExit, 1));

    expect(ownerOf(after, tip)).toBe(A);
    expect(headsOn(after, tip)).toBe(1);
    expect(isTrail(after, B, tip)).toBe(false);
  });

  it('still converts a closure around an unprotected garrison', () => {
    // "Closure around an unprotected garrison still converts"
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const occupied = arrowAt(run, 0);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const before = stateOf(
      [
        { arrow: last, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: 1 },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([home, landing], A) },
    );

    const after = table.rules.apply(before, step(last, landing, 1));

    expect(territoryOf(after, occupied)).toBe(A);
    expect(ownerOf(after, occupied)).toBe(A);
    expect(headsOn(after, occupied)).toBe(1);
  });

  it('does not convert an authored encircled group when nobody steps', () => {
    // "Not stepping still does not convert an authored encircled group"
    const table = onBoard();
    const tip = anArrow(table.geometry);
    const mover = anExitFrom(table.geometry, tip);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        territory: [
          { arrow: tip, owner: A },
          { arrow: mover, owner: A },
        ],
      },
    );
    const pictured = snapshot(before);

    // Conversion is resolved inside a step; nothing stepped this turn.
    const after = table.rules.apply(before, endTurn());

    expect(snapshot(after).groups).toEqual(pictured.groups);
    expect(snapshot(after).territory).toEqual(pictured.territory);
    expect(snapshot(after).trails).toEqual(pictured.trails);
    expect(ownerOf(after, tip)).toBe(B);
  });
});

// ── Rule: Purity / port agreement ────────────────────────────────────────────

describe('purity / port agreement', () => {
  it('does not mutate the input state when a self-convert step is refused', () => {
    // "Refused apply does not mutate the input state"
    const table = onBoard();
    const { from, exit, state } = stackGradeAgainstEnemy(table, 1);
    const before = snapshot(state);

    expectRefused(() => table.rules.apply(state, step(from, exit, 1)));
    expect(snapshot(state)).toEqual(before);
  });

  it('throws equal ContractViolation messages for equal illegal inputs', () => {
    // "Equal illegal inputs throw equal messages"
    const table = onBoard();
    const from = anArrow(table.geometry);
    const exit = anExitFrom(table.geometry, from);
    const ground = {
      trail: { A: [from] } as const,
      territory: [{ arrow: exit, owner: B }] as const,
    };
    const s1 = stateOf([{ arrow: from, owner: A, heads: 1 }], A, ground);
    const s2 = stateOf([{ arrow: from, owner: A, heads: 1 }], A, ground);
    const move = step(from, exit, 1);

    let first: unknown;
    let second: unknown;
    try {
      table.rules.apply(s1, move);
    } catch (error) {
      first = error;
    }
    try {
      table.rules.apply(s2, move);
    } catch (error) {
      second = error;
    }
    expect(first).toBeInstanceOf(ContractViolation);
    expect(second).toBeInstanceOf(ContractViolation);
    expect((first as ContractViolation).message).toBe((second as ContractViolation).message);
    expect((first as ContractViolation).message).toBe(WOULD_CONVERT);
  });

  it('applies every remaining legalMoves step without throw when the filter is in the pool', () => {
    // "Every remaining legalMoves step applies without throw"
    const table = onBoard();
    const { from, exit, state } = stackGradeAgainstEnemy(table, 4);
    if (territoryOf(state, exit) !== B) {
      throw new Error('setup: fragment must neighbour enemy land');
    }
    const free = exitsFrom(table.geometry, from).find((arrow) => arrow !== exit);
    if (free === undefined) throw new Error('setup: need a grain out that is not enemy land');

    for (const move of table.rules.legalMoves(state)) {
      expect(() => table.rules.apply(state, move)).not.toThrow();
    }
  });
});
