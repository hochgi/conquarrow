/**
 * Cuts and evaporation — bidirectional fire from a crossing (P12 / P47).
 *
 * SPEC §6.1: fronts destroy the connected component of unoccupied, non-territory
 * victim trail in the incidence graph (arrows adjacent when they share a point),
 * grown from the cut's seeds. Halt-at-first is victim occupation; territory is a
 * wall; the cutter is not a firebreak. No kills. Orphan dormant components stand
 * (P22 — no scrub). Wipe and territory-root cuts share this flood.
 *
 * @see docs/spec/cuts/cuts.md
 * @see docs/design/packets/P12-trail-fire-anchors.md
 * @see docs/design/packets/P47-fork-cut-floods-every-arm.md
 */

import type {
  ArrowId,
  GameState,
  GeometryPort,
  Group,
  Move,
  PlayerId,
  PointId,
  Traversal,
} from '@conquarrow/contracts';
import { compareArrows } from './order';

export interface CutRules {
  /**
   * Resolve crossing cuts for this step (and nothing else).
   * Call after combat + mark; root-feeder cuts are separate.
   */
  readonly evaporate: (state: GameState, move: Move, mover: PlayerId) => GameState;

  /**
   * Evaporate `victim`'s trail from `cutPoint` both ways under the halt-at-first
   * rule. Used for crossings and territory-root cuts.
   */
  readonly evaporateFrom: (
    state: GameState,
    victim: PlayerId,
    cutPoint: PointId,
  ) => GameState;

  /**
   * Evaporate from an emptied trail arrow (combat wipe): destroy that arrow if
   * present, then run both ways under the halt-at-first rule.
   */
  readonly evaporateFromArrow: (
    state: GameState,
    victim: PlayerId,
    emptied: ArrowId,
  ) => GameState;

  /**
   * After `mover` marked `marked`, if that was the last clean territory feeder
   * into a victim trail root, evaporate that victim from the root point.
   */
  readonly territoryRootCuts: (
    state: GameState,
    mover: PlayerId,
    marked: ArrowId,
  ) => GameState;
}

type Direction = 'forward' | 'backward';

interface Front {
  readonly arrow: ArrowId;
  readonly direction: Direction;
}

const canonical = (arrows: readonly ArrowId[]): ReadonlySet<ArrowId> =>
  new Set([...new Set(arrows)].toSorted(compareArrows));

const trailArrowsAt = (
  geometry: GeometryPort,
  point: PointId,
  trail: ReadonlySet<ArrowId>,
): readonly ArrowId[] => [
  ...geometry.inArrows(point).filter((a) => trail.has(a)),
  ...geometry.outArrows(point).filter((a) => trail.has(a)),
];

/**
 * Remaining victim-trail arrows that share either endpoint of `arrow`.
 * All-to-all at both points (P47); `arrow` itself is never a neighbour.
 */
const continuations = (
  geometry: GeometryPort,
  arrow: ArrowId,
  trail: ReadonlySet<ArrowId>,
): readonly ArrowId[] => {
  const next = new Set<ArrowId>([
    ...trailArrowsAt(geometry, geometry.origin(arrow), trail),
    ...trailArrowsAt(geometry, geometry.target(arrow), trail),
  ]);
  next.delete(arrow);
  return [...next].toSorted(compareArrows);
};

export const makeCutRules = (
  geometry: GeometryPort,
  crossesTrail: (state: GameState, traversal: Traversal, victim: PlayerId) => boolean,
): CutRules => {
  const trailOuts = (point: PointId, trail: ReadonlySet<ArrowId>): readonly ArrowId[] =>
    geometry.outArrows(point).filter((a) => trail.has(a));

  const trailIns = (point: PointId, trail: ReadonlySet<ArrowId>): readonly ArrowId[] =>
    geometry.inArrows(point).filter((a) => trail.has(a));

  const runFronts = (
    state: GameState,
    victim: PlayerId,
    groups: Map<ArrowId, Group>,
    trail: Set<ArrowId>,
    seed: readonly Front[],
  ): void => {
    const queue: Front[] = [...seed];
    const seen = new Set<string>();
    const markSeen = (arrow: ArrowId, direction: Direction): boolean => {
      const key = `${direction}:${String(arrow)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };

    while (queue.length > 0) {
      const front = queue.shift();
      if (front === undefined) break;
      const { arrow, direction } = front;
      if (!trail.has(arrow)) continue;
      if (!markSeen(arrow, direction)) continue;

      if (state.territory.get(arrow) === victim) continue;

      const standing = groups.get(arrow);
      if (standing !== undefined && standing.owner === victim && standing.heads > 0) {
        continue;
      }

      trail.delete(arrow);
      for (const next of continuations(geometry, arrow, trail)) {
        queue.push({ arrow: next, direction });
      }
    }
  };

  const evaporateAtPoint = (
    state: GameState,
    victim: PlayerId,
    cutPoint: PointId,
    groups: Map<ArrowId, Group>,
    trail: Set<ArrowId>,
  ): void => {
    const seed: Front[] = [];
    for (const out of [...trailOuts(cutPoint, trail)].toSorted(compareArrows)) {
      seed.push({ arrow: out, direction: 'forward' });
    }
    for (const into of [...trailIns(cutPoint, trail)].toSorted(compareArrows)) {
      seed.push({ arrow: into, direction: 'backward' });
    }
    runFronts(state, victim, groups, trail, seed);
  };

  const withTrailUpdate = (
    state: GameState,
    victim: PlayerId,
    mutate: (groups: Map<ArrowId, Group>, trail: Set<ArrowId>) => void,
  ): GameState => {
    const current = state.trails.get(victim);
    if (current === undefined || current.size === 0) return state;
    const groups = new Map(state.groups);
    const working = new Set(current);
    mutate(groups, working);
    const trails = new Map(state.trails);
    if (working.size === 0) trails.delete(victim);
    else trails.set(victim, canonical([...working]));
    return { ...state, groups, trails };
  };

  const evaporateFrom = (
    state: GameState,
    victim: PlayerId,
    cutPoint: PointId,
  ): GameState =>
    withTrailUpdate(state, victim, (groups, trail) => {
      evaporateAtPoint(state, victim, cutPoint, groups, trail);
    });

  const evaporateFromArrow = (
    state: GameState,
    victim: PlayerId,
    emptied: ArrowId,
  ): GameState =>
    withTrailUpdate(state, victim, (groups, trail) => {
      if (!trail.has(emptied)) return;
      // Empty arrow cannot be a firebreak — destroy it and fan from both ends.
      const seed: Front[] = [];
      for (const next of continuations(geometry, emptied, trail)) {
        seed.push({ arrow: next, direction: 'forward' });
        seed.push({ arrow: next, direction: 'backward' });
      }
      trail.delete(emptied);
      runFronts(state, victim, groups, trail, seed);
    });

  const evaporate = (state: GameState, move: Move, mover: PlayerId): GameState => {
    if (move.kind !== 'step') return state;

    // Same predicate as RulesPort.crossesTrail — including stub-out coincide (§2).
    const victims = state.players.filter(
      (player) => player !== mover && crossesTrail(state, move, player),
    );
    if (victims.length === 0) return state;

    let next = state;
    for (const victim of victims) {
      next = evaporateFrom(next, victim, geometry.target(move.from));
    }
    return next;
  };

  const enemyMarks = (state: GameState, owner: PlayerId, arrow: ArrowId): boolean => {
    for (const [player, trail] of state.trails) {
      if (player === owner) continue;
      if (trail.has(arrow)) return true;
    }
    return false;
  };

  const territoryRootCuts = (
    state: GameState,
    mover: PlayerId,
    marked: ArrowId,
  ): GameState => {
    // Only a mark on someone else's territory can be a feeder paint-over.
    const owner = state.territory.get(marked);
    if (owner === undefined || owner === mover) return state;

    const p0 = geometry.target(marked);
    const feeders = geometry
      .inArrows(p0)
      .filter((a) => state.territory.get(a) === owner)
      .toSorted(compareArrows);
    if (feeders.length === 0) return state;
    if (!feeders.includes(marked)) return state;

    // Trail must originate from P0 (at least one trail out of P0).
    const ownerTrail = state.trails.get(owner);
    if (ownerTrail === undefined) return state;
    const outs = trailOuts(p0, ownerTrail);
    if (outs.length === 0) return state;

    const clean = feeders.filter((a) => !enemyMarks(state, owner, a));
    // This step just marked `marked`; if it was the last clean feeder, cut.
    if (clean.length > 0) return state;
    return evaporateFrom(state, owner, p0);
  };

  return {
    evaporate,
    evaporateFrom,
    evaporateFromArrow,
    territoryRootCuts,
  };
};
