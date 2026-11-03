/**
 * P84 never-idle guard for the live heuristic seat
 * (docs/spec/heuristic-never-idle/heuristic-never-idle.md). Adapter only — no
 * game rule. Pure: no state beyond its arguments.
 *
 * SKELETON (phase 2): signatures only. Phase 3 implements decisions 2–5 and
 * wires the one call into `botSearch.ts`'s return seam.
 */

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
}

/**
 * The live seat's return seam (spec decisions 2–5).
 *
 * - Decision 2: if `chosen` already steps, or no step is legal at `origin`,
 *   return `chosen` unchanged.
 * - Decision 3: otherwise prefer the best stepping complete (by `score`, ties
 *   `planKey` ascending) that is not a threatened kite; if every stepping
 *   complete is a threatened kite, the one with the smallest `kiteLength`,
 *   then smaller `planKey`.
 * - Decision 4: if no stepping complete exists, `chooseMove(origin, me)`'s
 *   move, followed by `endTurn` while it is still `me`'s turn and there is no
 *   winner.
 * - Decision 5: called once from `botSearch.ts`, live seat only.
 */
export const neverIdle = <P extends NeverIdleComplete>(
  _search: NeverIdleSearch<P>,
  _chosen: readonly Move[],
): readonly Move[] => {
  throw new Error('P84: not implemented');
};
