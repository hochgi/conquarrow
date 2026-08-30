/**
 * What a player does.
 *
 * SPEC §4 (turn structure), §5 (sentries are counts), §11 items 19 and 21.
 *
 *   A move takes a portion of one arrow's heads one step along an out-arrow.
 *   A turn is an ordered list of moves, ended explicitly.
 *
 * Two variants and no others. Splitting, merging, forking and dropping a
 * sentry are all the same move with a different `count` — a third variant
 * would mean a mechanic had been invented rather than expressed.
 *
 * Declining is not one of them: no step is ever compelled, so leaving a stack
 * where it is means naming no move for it (P51).
 *
 * This module owns the SHAPE of a move. Legality — whether the exit is really
 * an out-arrow of the source's target point, whether the mover has allowance
 * left, whether a crossing is won — is P04 and later.
 *
 * @see docs/spec/move/move.md
 */

import { reject } from './errors';
import type { ArrowId } from './ids';

/**
 * An id is opaque (P01 decision D1), so the only thing this can check is that
 * something arrived at all. The guard exists for data crossing a boundary the
 * compiler cannot see — a replay file, a stored fixture, an adapter.
 */
const requireArrow = (id: ArrowId, field: string): void => {
  if (typeof id !== 'string' || id.length === 0) {
    reject(`a move needs a ${field} arrow, got ${String(id)}`);
  }
};

export interface StepMove {
  readonly kind: 'step';
  readonly from: ArrowId;
  readonly exit: ArrowId;
  readonly count: number;
}

export interface EndTurnMove {
  readonly kind: 'endTurn';
}

export type Move = StepMove | EndTurnMove;

/** Exactly two, and the suite asserts it. */
export const MOVE_KINDS = ['step', 'endTurn'] as const;

/**
 * Construct a step.
 *
 * Throws {@link ContractViolation} on a count that is not a positive integer,
 * and on a step whose source and exit are the same arrow — a step goes
 * somewhere, and staying put is not a move at all.
 */
export const step = (from: ArrowId, exit: ArrowId, count: number): StepMove => {
  requireArrow(from, 'source');
  requireArrow(exit, 'exit');
  if (!Number.isInteger(count) || count < 1) {
    reject(`a step moves a whole positive portion, got ${String(count)}`);
  }
  if (from === exit) {
    reject(`a step goes somewhere; staying put is no move (${String(from)})`);
  }
  return { kind: 'step', from, exit, count };
};

export const endTurn = (): EndTurnMove => ({ kind: 'endTurn' });

/**
 * Can this move be satisfied by a source arrow holding `headsOnSource` heads?
 *
 * Separate from construction because it is the one well-formedness question
 * that needs to look at the board. Keeping it a pure function of a single
 * number keeps P01 free of any dependency on game state.
 */
export const isSatisfiableBy = (move: Move, headsOnSource: number): boolean => {
  // An end-turn asks nothing of the board, so nothing can make it
  // unsatisfiable. Only a step names a portion.
  if (move.kind !== 'step') return true;
  return Number.isInteger(headsOnSource) && headsOnSource >= move.count;
};

/** Structural equality. Never object identity — replay comparison depends on it. */
export const movesEqual = (a: Move, b: Move): boolean => {
  switch (a.kind) {
    case 'step':
      return (
        b.kind === 'step' && a.from === b.from && a.exit === b.exit && a.count === b.count
      );
    case 'endTurn':
      return b.kind === 'endTurn';
  }
};

/**
 * A turn is an ordered list, and the order is data.
 *
 * The per-step model was chosen precisely so that no within-turn resolution
 * order has to be invented (SPEC §11 item 19). Reinforcing a stack before
 * another commits to a crossing is a legal and intended play, so two turns with
 * the same moves in different orders are different turns.
 */
export type Turn = readonly Move[];

export const turnsEqual = (a: Turn, b: Turn): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    // `noUncheckedIndexedAccess` makes these possibly-undefined. The length check
    // above already rules it out, but asserting it beats a non-null assertion in a
    // module whose whole job is that illegal shapes are unrepresentable.
    if (left === undefined || right === undefined) return false;
    if (!movesEqual(left, right)) return false;
  }
  return true;
};

/**
 * A group's movement allowance for one turn: `speed(N) = 1 + floor(log2 N)`.
 *
 * SPEC §3. A whole number, and nothing carries between turns — the harmonic
 * curve this replaced needed exact rationals and a bank, and was unreadable at
 * the table because you could not tell how far a stack moved without knowing
 * what it saved last turn.
 *
 * Two properties phase 3 must not break:
 *   - `speed(N) <= N` for all N, so splitting never loses on throughput (§3).
 *   - `speed(2) === 2`, so a pair moves exactly as far as two loose heads. That
 *     makes the pair the natural atom — the smallest garrison that halts an
 *     evaporation front (§6.1), reached at no cost in speed.
 *
 * Integer arithmetic only. `Math.log2` is float arithmetic and rounds wrong at
 * exact powers of two on some inputs — a determinism bug of exactly the kind
 * ADR 0001 calls the realistic one, since it would pass unit tests and surface
 * as replay drift.
 */
export const speed = (heads: number): number => {
  if (!Number.isInteger(heads) || heads < 1) {
    reject(`a group is a whole positive number of heads, got ${String(heads)}`);
  }
  // Halve until nothing is left to halve, counting the halvings. That is
  // floor(log2 heads) by definition, computed in integers — `Math.log2` is float
  // arithmetic, and a rounding slip at a power of two would pass every value in
  // the table and surface only as replay drift (ADR 0001, P10).
  let steps = 1;
  for (let n = heads; n >= 2; n = (n - (n % 2)) / 2) {
    steps += 1;
  }
  return steps;
};
