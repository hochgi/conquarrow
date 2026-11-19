/**
 * Oracles for P99 big-stack selection.
 *
 * The golden is the live full reach — `reachFrom` with no portion — not a
 * snapshot of arrow ids. `washCalls` and `fullCalls` are the overview's
 * definitions, and the subtraction is the empty-draft open field only.
 *
 * @see docs/spec/big-stack-selection/big-stack-selection.md
 */

import { speed } from '@conquarrow/contracts';
import type { ArrowId, GameState } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import type { RoutePhase } from '../src/input/modes';
import { reachFrom } from '../src/reach';
import type { Reach } from '../src/reach';
import { buildRouteOffer, routePaint, walkedArrows } from '../src/route';
import type { ClickableSet, RouteOffer } from '../src/route';
import {
  countingRules,
  geometry,
  inputsAt,
  openField,
  rules,
  sortedIds,
  sourceArrow,
} from './ray-run-input.support';
import type { Board, CountingRules } from './ray-run-input.support';

export {
  countingRules,
  geometry,
  inputsAt,
  openField,
  rules,
  sortedIds,
  sourceArrow,
  speed,
  walkedArrows,
};
export type { Board, CountingRules, Reach };

/** The generated tiling — the board the open field and the opening board live on. */
export const tiling: Board = { geometry, rules };

/** The tiling's seed out-arrow. The spec's open-field `a0`. */
export const a0: ArrowId = sourceArrow(geometry);

/** Arrows whose plan map contains `portion`. Membership, not walk order. */
export const arrowsWithPlan = (reach: Reach, portion: number): readonly ArrowId[] => {
  const arrows: ArrowId[] = [];
  for (const [arrow, entry] of reach) {
    if (entry.plans.has(portion)) arrows.push(arrow);
  }
  return arrows;
};

/**
 * The golden wash for `carry`: full-reach arrows that plan it, minus the tip,
 * the clickable set and the walked arrows (D3).
 */
export const goldenWash = (
  reach: Reach,
  carry: number,
  tip: ArrowId,
  clickable: ClickableSet,
  walked: ReadonlySet<ArrowId>,
): ReadonlySet<ArrowId> => {
  const wash = new Set<ArrowId>();
  for (const arrow of arrowsWithPlan(reach, carry)) {
    if (arrow === tip || clickable.has(arrow) || walked.has(arrow)) continue;
    wash.add(arrow);
  }
  return wash;
};

/** `routePaint` of an empty draft holding `offer` — the painted wash. */
export const paintedWash = (
  offer: RouteOffer,
  from: ArrowId,
  carry: number,
  tipHeads: number,
): ReadonlySet<ArrowId> => {
  const phase: RoutePhase = {
    kind: 'route',
    from,
    tip: offer.tip,
    carry,
    tipHeads,
    draft: [],
    runLengths: [],
    offer,
  };
  return routePaint({ phase, pointer: 'fine' }).reachWash;
};

/**
 * `rules.apply` calls of `buildRouteOffer` at `carry = heads`, minus the same
 * offer at `carry = 0`. Empty-draft open field only — rays do not read `carry`
 * there, so the difference is the wash.
 */
export const washCalls = (heads: number): number => {
  const state = openField(a0, heads);
  const counting = countingRules(rules);
  const probed: Board = { geometry, rules: counting.rules };
  counting.zero();
  buildRouteOffer(inputsAt(probed, state, a0, heads));
  const atCarry = counting.calls;
  counting.zero();
  buildRouteOffer(inputsAt(probed, state, a0, 0));
  return atCarry - counting.calls;
};

/** `rules.apply` calls of the full reach (no portion) on that same field and tip. */
export const fullCalls = (heads: number): number => {
  const state = openField(a0, heads);
  const counting = countingRules(rules);
  counting.zero();
  reachFrom(geometry, counting.rules, state, a0);
  return counting.calls;
};

/**
 * `makeMatch()`, with the active player's one stack rewritten to `heads` and
 * `spent` 0. Other groups, territory and spawners stay as setup left them.
 */
export const openingBoard = (
  heads: number,
): { readonly state: GameState; readonly from: ArrowId } => {
  const opening = makeMatch();
  const owned = [...opening.groups.entries()].filter(
    ([, group]) => group.owner === opening.activePlayer,
  );
  if (owned.length !== 1) {
    throw new Error(`setup: expected one active stack, found ${String(owned.length)}`);
  }
  const only = owned[0];
  if (only === undefined) throw new Error('setup: expected one active stack');
  const [from, group] = only;
  const groups = new Map(opening.groups);
  groups.set(from, { owner: group.owner, heads, spent: 0 });
  return { state: { ...opening, groups }, from };
};
