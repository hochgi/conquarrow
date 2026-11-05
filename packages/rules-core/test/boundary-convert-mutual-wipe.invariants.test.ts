/**
 * The EARS invariants of docs/spec/boundary-convert-mutual-wipe/boundary-convert-mutual-wipe.md,
 * as properties.
 *
 * Families, all enumerated deterministically through the port, on both fixture boards:
 * - **mutual wipes** (invariants 1, 4): one (step, arm) pair per (from, exit,
 *   interleaves) at the board's first point, 2 attackers into 3 defenders, with the attacker's trail bare, a
 *   tip, or a tip beside a bare sibling arm (optionally stepping onto its own
 *   territory), and the defender standing beside its own spine, on its own spine,
 *   or on a road of its own;
 * - **boundary endTurns** (invariants 2, 3, 4): B stacks on A's territory with no
 *   trail, a stack-grade trail, or a territory-grade road, plus every birth-cut raid
 *   the board offers. Applied by the last seat (closes a round, invariant 2) and by
 *   the first seat (does not, invariant 3).
 *
 * Expected outcomes are never hard-coded per case: invariant 1 reads `floodOf`, the
 * §6.1 halt-at-first oracle of `spec-alignment.support.ts`.
 *
 * @see docs/spec/boundary-convert-mutual-wipe/boundary-convert-mutual-wipe.md
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL,
  MINIMAL_DIAMETER,
  SPACIOUS,
  SPACIOUS_DIAMETER,
  byId,
  exitsFrom,
  onBoard,
  owned,
  snapshot,
  stateOf,
} from './support';
import type { Table } from './support';
import { armsAtPoints, floodOf, marksOf } from './spec-alignment.support';
import type { ArmAtPoint } from './spec-alignment.support';
import {
  END_TURN,
  FIRST_SEAT,
  LAST_SEAT,
  boundaryRaids,
  ownership,
  unanchoredRaiders,
} from './boundary-convert-mutual-wipe.support';

interface Applied {
  readonly name: string;
  readonly table: Table;
  readonly before: GameState;
  readonly move: Move;
  /** `before`, pictured before anything was applied to it. */
  readonly pictured: ReturnType<typeof snapshot>;
  readonly after: GameState;
}

const applied = (name: string, table: Table, before: GameState, move: Move): Applied => {
  const pictured = snapshot(before);
  return { name, table, before, move, pictured, after: table.rules.apply(before, move) };
};

const boards = [
  { label: 'minimal', table: onBoard(MINIMAL), diameter: MINIMAL_DIAMETER },
  { label: 'spacious', table: onBoard(SPACIOUS), diameter: SPACIOUS_DIAMETER },
] as const;

const territoryOfPlayer = (state: GameState, player: typeof A): readonly string[] =>
  [...state.territory]
    .filter(([, owner]) => owner === player)
    .map(([arrow]) => String(arrow))
    .toSorted();

// ── family: mutual wipes (invariants 1, 4) ───────────────────────────────────

interface WipeCase extends Applied {
  readonly arm: ArmAtPoint;
}

/** The third out-arrow of the step's point: neither the exit nor B's arm. */
const siblingOf = (table: Table, arm: ArmAtPoint): ArrowId | undefined =>
  table.geometry
    .outArrows(arm.point)
    .filter((a) => a !== arm.exit && a !== arm.armOut)
    .toSorted(byId)[0];

/** An exit of `exit` that no other arrow of the case names. */
const beyondOf = (table: Table, arm: ArmAtPoint): ArrowId | undefined =>
  exitsFrom(table.geometry, arm.exit)
    .filter((b) => ![arm.from, arm.exit, arm.armIn, arm.armOut].includes(b))
    .toSorted(byId)[0];

interface Attacker {
  readonly label: string;
  readonly trail: readonly ArrowId[];
  readonly home: boolean;
}

const attackersOf = (table: Table, arm: ArmAtPoint): readonly Attacker[] => {
  const sibling = siblingOf(table, arm);
  return [
    { label: 'bare', trail: [], home: false },
    { label: 'tip', trail: [arm.from], home: false },
    { label: 'tip-home', trail: [arm.from], home: true },
    ...(sibling === undefined
      ? []
      : [{ label: 'tip+sibling', trail: [arm.from, sibling], home: false }]),
  ];
};

const defendersOf = (
  table: Table,
  arm: ArmAtPoint,
): readonly { readonly label: string; readonly trail: readonly ArrowId[] }[] => {
  const beyond = beyondOf(table, arm);
  return [
    { label: 'beside-spine', trail: [arm.armIn, arm.armOut] },
    { label: 'on-spine', trail: [arm.armIn, arm.armOut, arm.exit] },
    ...(beyond === undefined ? [] : [{ label: 'on-road', trail: [arm.exit, beyond] }]),
  ];
};

/**
 * One arm per (from, exit, interleaves) at the board's first point: the defender
 * shapes vary the spine already, and every arm at a point would multiply the family
 * twelvefold for no new shape.
 */
const armsOf = (table: Table, diameter: number): readonly ArmAtPoint[] => {
  const seen = new Set<string>();
  return armsAtPoints(table.geometry, diameter, 1).filter((arm) => {
    const key = `${String(arm.from)}|${String(arm.exit)}|${String(arm.interleaves)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const mutualWipes: readonly WipeCase[] = boards.flatMap(({ label, table, diameter }) =>
  armsOf(table, diameter).flatMap((arm) =>
    attackersOf(table, arm).flatMap((attacker) =>
      defendersOf(table, arm).map((defender) => {
        const before = stateOf(
          [
            { arrow: arm.from, owner: A, heads: 3 },
            { arrow: arm.exit, owner: B, heads: 3 },
          ],
          A,
          {
            trail: { A: attacker.trail, B: defender.trail },
            ...(attacker.home ? { territory: owned([arm.exit], A) } : {}),
          },
        );
        return {
          ...applied(
            `${label} ${String(arm.from)}→${String(arm.exit)} arm ${String(arm.armIn)}→${String(arm.armOut)} A:${attacker.label} B:${defender.label}`,
            table,
            before,
            step(arm.from, arm.exit, 2),
          ),
          arm,
        };
      }),
    ),
  ),
);

// ── family: boundary endTurns (invariants 2, 3, 4) ───────────────────────────

interface Raid {
  readonly name: string;
  readonly table: Table;
  /** The board with the seat to move left unset: each invariant names it. */
  readonly at: (active: typeof A) => GameState;
}

const raids: readonly Raid[] = boards.flatMap(({ label, table, diameter }) => {
  const { geometry } = table;
  const authored = [...new Set(armsAtPoints(geometry, diameter, 2).map((a) => a.exit))]
    .toSorted(byId)
    .flatMap((raider): readonly Raid[] => {
      const feeder = geometry
        .inArrows(geometry.origin(raider))
        .filter((f) => f !== raider)
        .toSorted(byId)[0];
      const placed = [{ arrow: raider, owner: B, heads: 2 }];
      const named = `${label} raider ${String(raider)}`;
      return [
        {
          name: `${named} no trail`,
          table,
          at: (active) => stateOf(placed, active, { territory: owned([raider], A) }),
        },
        {
          name: `${named} stack-grade`,
          table,
          at: (active) =>
            stateOf(placed, active, { trail: { B: [raider] }, territory: owned([raider], A) }),
        },
        ...(feeder === undefined
          ? []
          : [
              {
                name: `${named} territory-grade via ${String(feeder)}`,
                table,
                at: (active: typeof A) =>
                  stateOf(placed, active, {
                    trail: { B: [raider] },
                    territory: [...owned([raider], A), ...owned([feeder], B)],
                  }),
              },
            ]),
      ];
    });
  const birthCuts = boundaryRaids(table, diameter).map(
    (raid): Raid => ({
      name: `${label} birth-cut raid ${String(raid.x)}→${String(raid.raider)}`,
      table,
      at: (active) => ({ ...raid.before(2), activePlayer: active }),
    }),
  );
  return [...authored, ...birthCuts];
});

const closing: readonly Applied[] = raids.map((r) =>
  applied(`${r.name} (closes the round)`, r.table, r.at(LAST_SEAT), END_TURN),
);

const notClosing: readonly Applied[] = raids.map((r) =>
  applied(`${r.name} (mid-round)`, r.table, r.at(FIRST_SEAT), END_TURN),
);

// ── the families are not vacuous ──────────────────────────────────────────────

describe('the families are not vacuous', () => {
  it('hold mutual wipes and boundary raids of every shape', () => {
    expect(boards[0].table.rules.combatLosses(2, 3)).toEqual({ attacker: 2, defender: 3 });
    for (const shape of ['bare', 'tip', 'tip-home', 'tip+sibling']) {
      expect(mutualWipes.filter((c) => c.name.includes(`A:${shape} `)).length).toBeGreaterThan(0);
    }
    for (const shape of ['beside-spine', 'on-spine', 'on-road']) {
      expect(mutualWipes.filter((c) => c.name.endsWith(`B:${shape}`)).length).toBeGreaterThan(0);
    }
    expect(mutualWipes.filter((c) => c.arm.interleaves).length).toBeGreaterThan(0);
    expect(closing.filter((c) => c.name.includes('birth-cut raid')).length).toBeGreaterThan(0);
    expect(closing.filter((c) => c.name.includes('territory-grade')).length).toBeGreaterThan(0);
    // Some boards start with a stack the boundary must convert.
    expect(
      closing.filter((c) => unanchoredRaiders(c.table, c.before).length > 0).length,
    ).toBeGreaterThan(5);
    for (const c of closing) expect(c.before.activePlayer).toBe(c.before.players.at(-1));
    for (const c of notClosing) expect(c.before.activePlayer).toBe(c.before.players[0]);
  });
});

// ── invariant 1 ───────────────────────────────────────────────────────────────

describe("invariant 1 — a mutual wipe changes no trail or territory but the defender's wipe", () => {
  it.each(mutualWipes)('$name', (c) => {
    // §6.1 evaporation from the defender's wiped arrow, on the board the battle left.
    const trailB = c.before.trails.get(B) ?? new Set<ArrowId>();
    const flood = new Set(
      [...floodOf(c.table.geometry, c.after, B, trailB, { arrow: c.arm.exit })].map(String),
    );
    expect(c.after.groups.has(c.arm.exit)).toBe(false);
    expect(marksOf(c.after, A)).toEqual(marksOf(c.before, A));
    expect(territoryOfPlayer(c.after, A)).toEqual(territoryOfPlayer(c.before, A));
    expect(marksOf(c.after, B)).toEqual(marksOf(c.before, B).filter((a) => !flood.has(a)));
  });
});

// ── invariant 2 ───────────────────────────────────────────────────────────────

describe('invariant 2 — an endTurn that closes a round leaves no raider without a life line', () => {
  it.each(closing)('$name', (c) => {
    expect(c.after.activePlayer).toBe(c.after.players[0]);
    expect(unanchoredRaiders(c.table, c.after)).toEqual([]);
  });
});

// ── invariant 3 ───────────────────────────────────────────────────────────────

describe('invariant 3 — an endTurn that does not close a round changes no ownership', () => {
  it.each(notClosing)('$name', (c) => {
    expect(c.after.activePlayer).not.toBe(c.after.players[0]);
    expect(ownership(c.after)).toEqual(ownership(c.before));
  });
});

// ── invariant 4 ───────────────────────────────────────────────────────────────

describe('invariant 4 — apply does not mutate its input and is a function of it', () => {
  it.each([...mutualWipes, ...closing, ...notClosing])('$name', (c) => {
    const again = c.table.rules.apply(c.before, c.move);
    expect(snapshot(c.before)).toEqual(c.pictured);
    expect(snapshot(again)).toEqual(snapshot(c.after));
  });
});
