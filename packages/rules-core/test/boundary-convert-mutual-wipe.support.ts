/**
 * Shared scaffolding for the P89 suite — conversion at the round boundary; a
 * mutual wipe does not land.
 *
 * Builds on `support.ts` (authoring and observing) and `spec-alignment.support.ts`
 * (the §6.1 flood oracle and the step-through-a-point enumeration). No arrow is
 * named literally; every configuration is searched for through `GeometryPort`.
 *
 * @see docs/spec/boundary-convert-mutual-wipe/boundary-convert-mutual-wipe.md
 */

import { endTurn, rational } from '@conquarrow/contracts';
import type { ArrowId, GameState, GeometryPort, VertexId } from '@conquarrow/contracts';
import { A, B, allArrows, byId, exitsFrom, owned, stateOf } from './support';
import type { Table } from './support';

/** The rules' own players: `A` is `players[0]`, so `B`'s `endTurn` closes the round. */
export const LAST_SEAT = B;
export const FIRST_SEAT = A;

/** `endTurn` as one value, so a family can name the move it applies. */
export const END_TURN = endTurn();

/**
 * A spawner border in round-robin order (SPEC §7): `borderArrows` sorted by arrow
 * id, which is the order `phase` indexes (contracts `game-state.ts`).
 */
const bordersOf = (geometry: GeometryPort, vertex: VertexId): readonly ArrowId[] =>
  [...geometry.borderArrows(vertex)].toSorted(byId);

/**
 * A raid the next round boundary demotes (§6.1 birth-cut, §6.3).
 *
 * - `x` — the border a phase-0 spawner of A feeds this round: A's territory and a
 *   bare arrow of B's road. Its accumulator sits at 2/3, so the 1/3 tick births.
 * - `raider` — an exit of `x`, A's territory, where B's stack stands.
 * - `feeder` — another border of the same spawner, B's territory (so B holds a
 *   share and does not vanish on losing its heads) and an in-arrow of
 *   `origin(x)`: the clean feeder that lifts the road `{x, raider}` to territory
 *   grade. It is **not** an in-arrow of `origin(raider)`, so once the birth-cut
 *   takes `x` the stretch `{raider}` has no clean feeder and is stack grade.
 */
export interface BoundaryRaid {
  readonly vertex: VertexId;
  readonly x: ArrowId;
  readonly raider: ArrowId;
  readonly feeder: ArrowId;
  /** The authored board, active seat `B` (the last seat), raider of `heads`. */
  readonly before: (heads: number) => GameState;
}

const raidAt = (geometry: GeometryPort, vertex: VertexId): BoundaryRaid | undefined => {
  const borders = bordersOf(geometry, vertex);
  const x = borders[0];
  if (x === undefined || borders.length !== 3) return undefined;
  const feeder = borders
    .filter((f) => f !== x)
    .filter((f) => geometry.inArrows(geometry.origin(x)).includes(f))
    .find((f) => !geometry.inArrows(geometry.target(x)).includes(f));
  if (feeder === undefined) return undefined;
  const raider = exitsFrom(geometry, x)
    .filter((r) => r !== x && r !== feeder)
    .toSorted(byId)[0];
  if (raider === undefined) return undefined;
  return {
    vertex,
    x,
    raider,
    feeder,
    before: (heads) =>
      stateOf([{ arrow: raider, owner: B, heads }], LAST_SEAT, {
        trail: { B: [x, raider] },
        territory: [...owned([x, raider], A), ...owned([feeder], B)],
        accumulators: [[x, rational(2, 3)]],
        spawners: [[vertex, { force: rational(1, 3), phase: 0 }]],
      }),
  };
};

/** Every boundary raid a board offers, in vertex order. */
export const boundaryRaids = (table: Table, diameter: number): readonly BoundaryRaid[] => {
  const { geometry } = table;
  const vertices = [
    ...new Set(allArrows(geometry, diameter).flatMap((a) => geometry.flankVertices(a))),
  ].toSorted(byId);
  return vertices.flatMap((vertex) => {
    const raid = raidAt(geometry, vertex);
    return raid === undefined ? [] : [raid];
  });
};

/** The first boundary raid on a board, or a setup failure. */
export const aBoundaryRaid = (table: Table, diameter: number): BoundaryRaid => {
  const raid = boundaryRaids(table, diameter)[0];
  if (raid === undefined) throw new Error('setup: no spawner border feeds a road onto its own land');
  return raid;
};

/** Every group's owner and heads, by arrow, as sorted strings. */
export const ownership = (state: GameState): readonly string[] =>
  [...state.groups]
    .map(([arrow, group]) => `${String(arrow)}=${String(group.owner)}x${String(group.heads)}`)
    .toSorted();

/**
 * The stacks standing on another player's territory whose arrow is not on a
 * territory-grade stretch of their owner's trail (§6.3: no life line).
 */
export const unanchoredRaiders = (table: Table, state: GameState): readonly ArrowId[] =>
  [...state.groups]
    .filter(([arrow, group]) => {
      const land = state.territory.get(arrow);
      if (land === undefined || land === group.owner) return false;
      const onTrail = state.trails.get(group.owner)?.has(arrow) === true;
      return !onTrail || table.rules.anchorGrade(state, arrow, group.owner) !== 'territory';
    })
    .map(([arrow]) => arrow)
    .toSorted(byId);
