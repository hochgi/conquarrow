/**
 * Readings the bench takes off a board or a seat-turn. Measurement only: none
 * of these is a rule, and none feeds back into play.
 */

import { add, compare, movesEqual, rational, ZERO } from '@conquarrow/contracts';
import type { GameState, Move, PlayerId, Rational, StepMove } from '@conquarrow/contracts';
import { hasLegalStep } from '../../src/autoEndTurn';
import { annotateMove, movesForLlm } from '../../src/byokBot';
import { geometry, rules } from './board';

export const landOf = (state: GameState, seat: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner === seat) n += 1;
  return n;
};

/** Every claimed arrow, whoever owns it. */
export const totalLand = (state: GameState): number => state.territory.size;

export const headsOf = (state: GameState, seat: PlayerId): number => {
  let n = 0;
  for (const group of state.groups.values()) if (group.owner === seat) n += group.heads;
  return n;
};

/**
 * Nominal income: Σ force × shares the seat holds, in heads per full round (§7).
 * Exact — a sum of rationals is order-free, so map order cannot leak in.
 */
export const incomeRate = (state: GameState, seat: PlayerId): Rational => {
  let sum = ZERO;
  for (const [vertex, spawner] of state.spawners) {
    let held = 0;
    for (const arrow of geometry.borderArrows(vertex)) {
      if (state.territory.get(arrow) === seat) held += 1;
    }
    if (held > 0) sum = add(sum, rational(spawner.force.num * held, spawner.force.den));
  }
  return sum;
};

export const maxRational = (a: Rational, b: Rational): Rational => (compare(b, a) > 0 ? b : a);

export const formatRational = (r: Rational): string => `${String(r.num)}/${String(r.den)}`;

interface TurnOutcome {
  readonly moves: readonly Move[];
  readonly llmFallbacks: number;
}

const playedStep = (turn: TurnOutcome): boolean => turn.moves.some((m) => m.kind === 'step');

/**
 * The audit's paralysis: the model's batch was empty with `endTurn` while the
 * seat had a movable stack. A fallback turn is the heuristic's, so it is never one.
 */
export const isInteriorPass = (start: GameState, turn: TurnOutcome): boolean =>
  turn.llmFallbacks === 0 && hasLegalStep(rules, start) && !playedStep(turn);

const SHARE_GAIN = /^share\+[1-9]\d*$/;

const rowTags = (row: string): readonly string[] => /\btags=(\S+)/.exec(row)?.[1]?.split(',') ?? [];

/** Offer rows the adapter tags `closes` together with `share+N`, N > 0. */
export const shareCloseRows = (state: GameState): readonly StepMove[] => {
  const me = state.activePlayer;
  return movesForLlm(rules.legalMoves(state)).filter((move): move is StepMove => {
    if (move.kind !== 'step') return false;
    const tags = rowTags(annotateMove(geometry, rules, state, me, move));
    return tags.includes('closes') && tags.some((tag) => SHARE_GAIN.test(tag));
  });
};

/** The offer had a share-gaining close and the model's batch played none of them. */
export const isMissedClose = (rows: readonly StepMove[], turn: TurnOutcome): boolean =>
  rows.length > 0 &&
  turn.llmFallbacks === 0 &&
  !turn.moves.some((move) => rows.some((row) => movesEqual(row, move)));
