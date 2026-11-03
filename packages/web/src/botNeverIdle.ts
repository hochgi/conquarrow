/**
 * P84 never-idle guard for the live heuristic seat
 * (docs/spec/heuristic-never-idle/heuristic-never-idle.md). Adapter only — no
 * game rule. Pure: no state beyond its arguments, no clock, no randomness.
 *
 * Ties break on `planKey` ascending, the same total order as `pickBetterComplete`.
 * A scan with that order does not depend on `completes` insertion order.
 *
 * Does not import `botSearch` or `opponent`: `opponent` imports `chooseTurnBeam`,
 * so `chooseMove` and `planKey` are passed in.
 */

import { endTurn } from '@conquarrow/contracts';
import type { GameState, GeometryPort, Move, PlayerId, RulesPort } from '@conquarrow/contracts';

/** A complete plan of the live search: its moves and the terminal state they reach. */
export type NeverIdleComplete = {
  readonly moves: readonly Move[];
  readonly state: GameState;
};

/**
 * What the guard reads from the live search. The callbacks keep this module
 * free of `botSearch.ts` internals (and of an import cycle back into it).
 */
export interface NeverIdleSearch<P extends NeverIdleComplete> {
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
  /** The turn's start state. */
  readonly origin: GameState;
  readonly me: PlayerId;
  /** Every complete the live search kept (after finalist replies; carves included). */
  readonly completes: readonly P[];
  /** Spec Terms "search score": higher is better (`replyScore` when present, else `evaluate`). */
  readonly score: (complete: P) => number;
  /** P59 `isThreatenedKite` under the search's mission context, unchanged. */
  readonly isThreatenedKite: (complete: P) => boolean;
  /** P59 `kiteLength` of the complete's terminal against the origin territory. */
  readonly kiteLength: (complete: P) => number;
  /** Same total order as botSearch `planKey`. Smaller key wins a tie. */
  readonly planKey: (moves: readonly Move[]) => string;
  /**
   * P53 `chooseMove`, reused not copied. Called only when the search kept no
   * stepping complete (decision 4).
   */
  readonly chooseMove: (
    geometry: GeometryPort,
    rules: RulesPort,
    origin: GameState,
    me: PlayerId,
  ) => Move;
}

const hasStep = (moves: readonly Move[]): boolean => moves.some((move) => move.kind === 'step');

const stepIsLegal = <P extends NeverIdleComplete>(search: NeverIdleSearch<P>): boolean =>
  search.rules.legalMoves(search.origin).some((move) => move.kind === 'step');

/** Smaller `planKey` wins. Equal keys are the same moves, so either plan is the same answer. */
const byPlanKey = <P extends NeverIdleComplete>(
  search: NeverIdleSearch<P>,
  a: P,
  b: P,
): P => (search.planKey(a.moves) <= search.planKey(b.moves) ? a : b);

/** Search score, higher better; ties `planKey` ascending (`pickBetterComplete`). */
const byScore = <P extends NeverIdleComplete>(search: NeverIdleSearch<P>, a: P, b: P): P => {
  const left = search.score(a);
  const right = search.score(b);
  if (left > right) return a;
  if (right > left) return b;
  return byPlanKey(search, a, b);
};

/** Smallest `kiteLength`, then smaller `planKey` (P59 edge 12's order, stepping plans only). */
const byLeastKite = <P extends NeverIdleComplete>(
  search: NeverIdleSearch<P>,
  a: P,
  b: P,
): P => {
  const left = search.kiteLength(a);
  const right = search.kiteLength(b);
  if (left < right) return a;
  if (right < left) return b;
  return byPlanKey(search, a, b);
};

/** Order-independent given a total `wins`. Empty input returns undefined. */
const bestBy = <P>(items: readonly P[], wins: (a: P, b: P) => P): P | undefined => {
  let best: P | undefined;
  for (const item of items) best = best === undefined ? item : wins(best, item);
  return best;
};

/**
 * Decision 4. `chooseMove` returns a step whenever one is legal. Follow it
 * with `endTurn` while it is still `me`'s turn and there is no winner.
 */
const chooseMovePlan = <P extends NeverIdleComplete>(
  search: NeverIdleSearch<P>,
): readonly Move[] => {
  const move = search.chooseMove(search.geometry, search.rules, search.origin, search.me);
  const after = search.rules.apply(search.origin, move);
  if (after.winner !== undefined || after.activePlayer !== search.me) return [move];
  return [move, endTurn()];
};

/**
 * The live seat's return seam (spec decisions 2–5).
 *
 * - Decision 2: if `chosen` already steps, or no step is legal at `origin`,
 *   return `chosen` unchanged.
 * - Decision 3: otherwise prefer the best stepping complete (by `score`, ties
 *   `planKey` ascending) that is not a threatened kite; if every stepping
 *   complete is a threatened kite, the one with the smallest `kiteLength`,
 *   then smaller `planKey`.
 * - Decision 4: if no stepping complete exists, `chooseMove`'s move, followed
 *   by `endTurn` while it is still `me`'s turn and there is no winner.
 * - Decision 5: called once from `botSearch.ts`, live seat only.
 */
export const neverIdle = <P extends NeverIdleComplete>(
  search: NeverIdleSearch<P>,
  chosen: readonly Move[],
): readonly Move[] => {
  if (hasStep(chosen) || !stepIsLegal(search)) return chosen;
  const stepping = search.completes.filter((complete) => hasStep(complete.moves));
  const open = stepping.filter((complete) => !search.isThreatenedKite(complete));
  const picked =
    open.length > 0
      ? bestBy(open, (a, b) => byScore(search, a, b))
      : bestBy(stepping, (a, b) => byLeastKite(search, a, b));
  return picked === undefined ? chooseMovePlan(search) : picked.moves;
};
