/**
 * How far a portion of a stack can get **this turn**, and what it costs to send.
 *
 * SPEC §3: allowance is `speed(N) = 1 + floor(log₂ N)` whole steps, so distance is
 * bought with heads — 1 head reaches one arrow, 2 reach two, 4 reach three, 8 reach
 * four. That is the most important thing about a stack and the board never said it
 * out loud; this module is what lets the renderer show it.
 *
 * **Computed by simulation, never by re-deriving the rules.** The no-portion walk
 * still tries every portion because bigger is not always further. A present
 * portion walks only that count, because the caller already chose it. Either way
 * this walks the real `apply` and keeps whatever it accepted, so allowance,
 * enemy-occupied ground (§6.2) and a closure landing mid-path (§7) are all
 * respected because the engine was asked rather than imitated. An adapter that
 * recomputed `speed()` here would drift the moment a rule moved.
 *
 * A portion travels **as a unit and does not merge on the way**: stepping onto your
 * own group merges under §3 and the portion stops being separable, so a hop onto
 * occupied ground is recorded as a destination and never extended. That is also what
 * a player means by "send these six there".
 */

import { speed, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, GeometryPort, Move, RulesPort } from '@conquarrow/contracts';

/** One arrow a portion could reach, and the price of reaching it. */
export interface ReachEntry {
  /** Fewest steps any accepted route took — what the fade is drawn from. */
  readonly distance: number;
  /** Fewest heads that get there this turn. `2^(distance-1)` in the open field. */
  readonly minCount: number;
  /** Most heads that get there — normally the whole stack, less if a merge bars it. */
  readonly maxCount: number;
  /** Exits to walk, per portion size. The renderer hands one back to be applied. */
  readonly plans: ReadonlyMap<number, readonly ArrowId[]>;
  /**
   * Always false under P22 (branching is free). Kept so the Board paint API stays
   * stable without teaching a withdrawn toll.
   */
  readonly paysBranchToll: boolean;
  /**
   * Always false under P22 (no size-1 freeze / merge trap). Kept for API stability.
   */
  readonly mergeTrap: boolean;
}

export type Reach = ReadonlyMap<ArrowId, ReachEntry>;

/** A depth cap, so a pathological board cannot spin the renderer. */
const MAX_DEPTH = 8;

interface Mutable {
  distance: number;
  minCount: number;
  maxCount: number;
  plans: Map<number, readonly ArrowId[]>;
}

/**
 * Counts one query tries. Absent portion: 1..heads, because bigger is not always
 * further. A present portion: that count alone, because the caller already chose
 * it — or nothing, when it is not an integer in 1..heads (no `apply`).
 */
const portionSpan = (
  heads: number,
  portion: number | undefined,
): { readonly low: number; readonly high: number } | undefined => {
  if (portion === undefined) return { low: 1, high: heads };
  if (!Number.isInteger(portion) || portion < 1 || portion > heads) return undefined;
  return { low: portion, high: portion };
};

/**
 * Every arrow the group on `from` could reach this turn, keyed by arrow.
 *
 * With no portion, counts are tried from 1 upward because *bigger is not always
 * further*: a portion that outnumbers the group it merges into is barred for the
 * rest of the turn (§3), so `minCount` and `maxCount` are both measured rather
 * than assumed. A present portion walks only that count, because the caller
 * already chose it.
 */
export const reachFrom = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  from: ArrowId,
  options?: { readonly portion?: number },
): Reach => {
  const group = state.groups.get(from);
  if (group === undefined || group.owner !== state.activePlayer) return new Map();
  const span = portionSpan(group.heads, options?.portion);
  if (span === undefined) return new Map();

  const found = new Map<ArrowId, Mutable>();
  const record = (
    arrow: ArrowId,
    distance: number,
    count: number,
    plan: readonly ArrowId[],
  ): void => {
    const seen = found.get(arrow);
    if (seen === undefined) {
      found.set(arrow, {
        distance,
        minCount: count,
        maxCount: count,
        plans: new Map([[count, plan]]),
      });
      return;
    }
    if (distance < seen.distance) seen.distance = distance;
    if (count < seen.minCount) seen.minCount = count;
    if (count > seen.maxCount) seen.maxCount = count;
    // The shortest plan for a given portion is the one worth walking.
    const best = seen.plans.get(count);
    if (best === undefined || plan.length < best.length) seen.plans.set(count, plan);
  };

  for (let count = span.low; count <= span.high; count += 1) {
    // `speed(count)` only bounds the search — the engine still decides every hop.
    const cap = Math.min(MAX_DEPTH, group.speedOverride ?? speed(count));
    const visited = new Set<string>();

    const walk = (scratch: GameState, at: ArrowId, plan: readonly ArrowId[]): void => {
      if (plan.length >= cap) return;
      const key = `${String(at)}|${String(plan.length)}`;
      if (visited.has(key)) return;
      visited.add(key);

      for (const exit of geometry.outArrows(geometry.target(at))) {
        const occupied = scratch.groups.get(exit) !== undefined;
        let next: GameState;
        try {
          next = rules.apply(scratch, step(at, exit, count));
        } catch {
          continue;
        }
        const route = [...plan, exit];
        record(exit, route.length, count, route);
        // A hop onto occupied ground merges (§3), so the portion ends there.
        if (!occupied) walk(next, exit, route);
      }
    };

    walk(state, from, []);
  }

  const out = new Map<ArrowId, ReachEntry>();
  for (const [arrow, seen] of found) {
    out.set(arrow, {
      distance: seen.distance,
      minCount: seen.minCount,
      maxCount: seen.maxCount,
      plans: seen.plans,
      paysBranchToll: false,
      mergeTrap: false,
    });
  }
  return out;
};

/** The moves that carry `count` heads along a reach plan, in order. */
export const planMoves = (
  from: ArrowId,
  plan: readonly ArrowId[],
  count: number,
): readonly Move[] => {
  const moves: Move[] = [];
  let at = from;
  for (const exit of plan) {
    moves.push(step(at, exit, count));
    at = exit;
  }
  return moves;
};

/*
 * `planArrowSet` and `pathForDestination` lived here until P34 and are **deleted**,
 * not deprecated. They answered "which of several equal-length routes did the
 * adapter pick for this destination?" — the question P34 removes rather than
 * answers, by making the player name every run. `plans` is still read, but only to
 * ask *whether* a carry arrives (`route.ts`'s faintest tier); nothing chooses a
 * route from it any more, and nothing should.
 */

/**
 * How solid a reach arrow should look: nearest full, further fainter.
 *
 * The fade *is* the price. One step costs one head and four steps cost eight, so a
 * pale arrow is a arrow you can only take by committing most of the stack.
 */
export const reachOpacity = (distance: number): number =>
  Math.max(0.08, 0.22 - (distance - 1) * 0.03);
