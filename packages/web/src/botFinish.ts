/**
 * The heuristic seat's finisher (P81, docs/spec/heuristic-finishes). Adapter
 * only — no game rule.
 *
 * Pure: no clocks, no RNG, no I/O. Ties break on arrow ids, never on Map or
 * Set iteration order. Called from `chooseTurnBeamWithBudget` only for the live
 * seat (`withReplies: true`); `botSearch` holds the wiring, this module the
 * logic (spec decision 7).
 *
 * PHASE-2 SKELETON: signatures only. Phase 3 implements decisions 4–6.
 */

import type { GameState, GeometryPort, Move, PlayerId, RulesPort } from '@conquarrow/contracts';

/** Decision 4: dominant when `heads(me) ≥ FINISH_RATIO × max(1, Σ heads of every other seat)`. */
export const FINISH_RATIO = 2;

/** Decision 5: at most this many validated carves join the search. */
export const CARVE_TOP = 4;

/**
 * A complete plan for `me` — the moves and the state they reach. Structurally a
 * `CompletePlan` (botSearch) without a reply score; declared here so this
 * module does not import the search that calls it.
 */
export type FinishPlan = {
  readonly moves: readonly Move[];
  readonly state: GameState;
};

/**
 * Decision 4 — `me` holds at least `FINISH_RATIO` times every other seat's heads
 * combined (floored at 1), and some other seat owns territory.
 */
export const isDominant = (_state: GameState, _me: PlayerId): boolean => {
  throw new Error('not implemented');
};

/**
 * Decision 5 — up to `CARVE_TOP` validated carves for a dominant seat, best
 * claim first. Each is a complete plan ending `me`'s turn. Empty when `me` is
 * not dominant.
 */
export const carvePlans = (
  _geometry: GeometryPort,
  _rules: RulesPort,
  _state: GameState,
  _me: PlayerId,
): readonly FinishPlan[] => {
  throw new Error('not implemented');
};

/**
 * Decision 6 — one own stack's walk across own territory toward the nearest
 * entry arrow, closed by `endTurn`. `undefined` when `me` is not dominant, no
 * entry arrow exists, or no walker can take a step.
 */
export const stagingWalk = (
  _geometry: GeometryPort,
  _rules: RulesPort,
  _state: GameState,
  _me: PlayerId,
): FinishPlan | undefined => {
  throw new Error('not implemented');
};

/**
 * Terms — a quiet plan: from `origin` to `terminal`, `me`'s territory has not
 * grown, no other seat's territory has shrunk, and no other seat has lost heads.
 */
export const isQuietPlan = (_origin: GameState, _terminal: GameState, _me: PlayerId): boolean => {
  throw new Error('not implemented');
};
