/**
 * Hot-seat QoL: when the active player has no legal step, apply `endTurn`.
 *
 * The rules core still requires an explicit `endTurn` (P04) — this is the adapter
 * sending it, so replays stay honest. Nothing is required first: declining is the
 * absence of a move, so a spent-out board offers `endTurn` and nothing else (P51).
 *
 * Returns the moves it applied so a match log can record them (playtest review).
 */

import { endTurn } from '@conquarrow/contracts';
import type { GameState, Move, RulesPort } from '@conquarrow/contracts';

export const hasLegalStep = (rules: RulesPort, state: GameState): boolean =>
  rules.legalMoves(state).some((m) => m.kind === 'step');

/**
 * Online auto-pass (P26): the move to POST when the GET board has no legal
 * `step`. Must not `apply` — the adapter POSTs via `submitMove`.
 */
export const onlinePassMove = (rules: RulesPort, state: GameState): Move | undefined => {
  if (state.winner !== undefined || hasLegalStep(rules, state)) return undefined;
  return endTurn();
};

export interface PassResult {
  readonly state: GameState;
  readonly moves: readonly Move[];
}

/**
 * Apply `endTurn` until someone can step, or every player has been passed once
 * (mutual soft-lock). `moves` is empty when nothing changed.
 */
export const passIfExhausted = (rules: RulesPort, state: GameState): PassResult => {
  if (state.winner !== undefined || hasLegalStep(rules, state)) {
    return { state, moves: [] };
  }
  let current: GameState = state;
  const moves: Move[] = [];
  const passed = new Set<string>();
  while (current.winner === undefined && !hasLegalStep(rules, current)) {
    const who = String(current.activePlayer);
    if (passed.has(who)) return { state: current, moves };
    passed.add(who);
    const move = endTurn();
    current = rules.apply(current, move);
    moves.push(move);
  }
  return { state: current, moves };
};
