/**
 * Rebuild the per-move chain behind an applied batch.
 *
 * The adapter commits a whole trip — or a bot's turn — in one go, so all it holds
 * afterwards is the state either side of the batch. A single before/after diff
 * collapses everything that happened into one indistinguishable blob: a trip that
 * split on step one and closed on step three would present as a split *and* a
 * closure at the same instant, which is the opposite of showing a causal chain.
 *
 * So the chain is rebuilt by re-applying the moves. That is exact rather than
 * approximate for one specific reason: `apply` is a pure, deterministic function of
 * `(state, move)` (ADR 0001), so replaying a batch that already succeeded reproduces
 * the same intermediate states it produced the first time. This is the same property
 * P10's replay harness rests on, used one turn at a time.
 *
 * Presentation only: the returned states decorate a board that already renders the
 * authoritative `after`, and a failed rebuild degrades to one coarse step rather
 * than to a wrong board.
 */

import type { GameState, Move, RulesPort } from '@conquarrow/contracts';
import type { AppliedStep } from '@conquarrow/contracts';

/**
 * The chain for `moves` applied from `before`, ending at `after`.
 *
 * Falls back to a single `before → after` step if the rebuild diverges — which
 * would mean the batch was produced somewhere other than this engine (an online
 * seat, say) and the local replay disagreed. The last move is kept as the cause so
 * effects still have somewhere to anchor.
 */
export const replaySteps = (
  rules: RulesPort,
  before: GameState,
  moves: readonly Move[],
  after: GameState,
): readonly AppliedStep[] => {
  if (moves.length === 0) return [];
  const coarse = (): readonly AppliedStep[] => {
    const last = moves[moves.length - 1];
    return last === undefined ? [] : [{ before, after, move: last }];
  };
  if (moves.length === 1) {
    const only = moves[0];
    return only === undefined ? [] : [{ before, after, move: only }];
  }
  const chain: AppliedStep[] = [];
  let at = before;
  for (const move of moves) {
    try {
      const next = rules.apply(at, move);
      chain.push({ before: at, after: next, move });
      at = next;
    } catch {
      return coarse();
    }
  }
  return chain;
};
