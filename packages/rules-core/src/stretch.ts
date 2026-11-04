/**
 * Stretches — one connected component of a player's trail, and what holds it live.
 *
 * SPEC §6.1 (anchor grades), P05 D7. Shared by `anchorGrade` (trails.ts), which
 * grades the stretch an arrow sits in, and by the closure strip (closure.ts, P87),
 * which keeps the stretches that shield a raider from conversion (§6.3, §7).
 *
 * Pure: a function of the board and the state it is handed. Every list returned is
 * sorted on a total key, so no caller can inherit a flood's visit order.
 *
 * @see docs/spec/trails/trails.md
 * @see docs/spec/raider-survives-claim/raider-survives-claim.md
 */

import type { AnchorGrade, ArrowId, GameState, GeometryPort, PlayerId } from '@conquarrow/contracts';
import { compareArrows } from './order';

/**
 * The stretch of `trail` holding `seed`: every trail arrow reachable through arrows
 * sharing a point, **either direction** (§6.1, P05 D7). Sorted by arrow id.
 *
 * `seed` is assumed to be in `trail`; callers check membership first.
 */
export const stretchOf = (
  geometry: GeometryPort,
  trail: ReadonlySet<ArrowId>,
  seed: ArrowId,
): readonly ArrowId[] => {
  // Equivalent if emptied: `seed` is in `trail` and among its own endpoints' arrows,
  // so the first pop re-reaches it.
  // Stryker disable next-line ArrayDeclaration
  const reached = new Set<ArrowId>([seed]);
  const pending: ArrowId[] = [seed];
  for (let here = pending.pop(); here !== undefined; here = pending.pop()) {
    for (const point of [geometry.origin(here), geometry.target(here)]) {
      for (const next of [...geometry.inArrows(point), ...geometry.outArrows(point)]) {
        if (reached.has(next) || !trail.has(next)) continue;
        reached.add(next);
        pending.push(next);
      }
    }
  }
  return [...reached].toSorted(compareArrows);
};

/**
 * The grade of one stretch (§6.1): **territory** when some arrow of it departs a
 * point one of the player's own territory arrows feeds; otherwise **stack** when it
 * carries one of the player's groups; otherwise **dormant**.
 *
 * Both are existence questions over the component, so the order it is read in is
 * not observable. `anchorGrade` in trails.ts carries the reasoning for why the
 * departure, not the arrival, is what counts.
 */
export const stretchGrade = (
  geometry: GeometryPort,
  state: GameState,
  stretch: readonly ArrowId[],
  player: PlayerId,
): AnchorGrade => {
  const departsTerritory = stretch.some((arrow) =>
    geometry
      .inArrows(geometry.origin(arrow))
      .some((feeder) => state.territory.get(feeder) === player),
  );
  if (departsTerritory) return 'territory';
  return stretch.some((arrow) => state.groups.get(arrow)?.owner === player) ? 'stack' : 'dormant';
};
