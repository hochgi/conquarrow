/**
 * Frozen greedy-v1 — `chooseMove` loop. Copied from web `chooseTurnGreedy`.
 * Does not lift `chooseTurnBeam`.
 */

import { endTurn } from '@conquarrow/contracts';
import type { GameState, GeometryPort, Move, PlayerId, RulesPort } from '@conquarrow/contracts';
import { chooseMove } from './opponent';

const MAX_MOVES_PER_TURN = 64;

export const chooseTurnGreedy = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
): readonly Move[] => {
  if (state.activePlayer !== me || state.winner !== undefined) return [];
  const moves: Move[] = [];
  let at = state;
  for (let i = 0; i < MAX_MOVES_PER_TURN; i += 1) {
    if (at.winner !== undefined || at.activePlayer !== me) break;
    const move = chooseMove(geometry, rules, at, me);
    at = rules.apply(at, move);
    moves.push(move);
  }
  if (at.winner === undefined && at.activePlayer === me) {
    const forced = endTurn();
    at = rules.apply(at, forced);
    moves.push(forced);
  }
  return moves;
};
