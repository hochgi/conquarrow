/**
 * P85 tempo horizon for the live heuristic seat
 * (docs/spec/heuristic-tempo-horizon/heuristic-tempo-horizon.md). Adapter
 * only — no game rule. Pure: every reading depends only on its arguments; no
 * module-level mutable state, no clock, no randomness.
 *
 * Race arithmetic over several turns, from grain distances and `speed(N)`:
 * the safe window W sizes the seat's own sortie, the intercept race drives a
 * march toward an enemy trail the seat can reach before that enemy closes.
 *
 * Phase-2 skeleton: signatures only. Phase 3 fills the bodies.
 */

import type { ArrowId, GameState, GeometryPort, PlayerId } from '@conquarrow/contracts';

/** Decision 7: no race or window is read beyond this many turns. */
export const TEMPO_TURN_CAP = 8;
/** Decision 7: a terminal whose turns to land L exceeds this earns no credit. */
export const SORTIE_TURN_CAP = 3;
/** Decision 7: elapsed + L above this earns no credit (the stateless stopping rule). */
export const SORTIE_TOTAL_CAP = 5;
/** Decision 3a / 7: a pending close is credited at half its projected loot. */
export const SORTIE_CREDIT = 0.5;

const notImplemented = (): never => {
  throw new Error('P85: not implemented');
};

/**
 * Spec Terms "safe window, W": the min over enemy groups of turns for that
 * group to reach any arrow of `arrows` by a path passable for it (`me`'s
 * territory blocked); `cap + 1` when none is within `cap`. In `1 … cap + 1`.
 */
export const safeWindow = (
  _geometry: GeometryPort,
  _state: GameState,
  _me: PlayerId,
  _arrows: readonly ArrowId[],
  _cap: number,
): number => notImplemented();

/** Spec Terms "projected sortie", "turns to land", "elapsed" of `me`'s open trail. */
export type Sortie = {
  /** Max over `me`'s tips of turns to reach `me`'s territory; `TEMPO_TURN_CAP + 1` when a tip cannot land within decision 7's depth. */
  readonly turnsToLand: number;
  /** `ceil(trail size ÷ the largest speed among me's tips)`. */
  readonly elapsed: number;
  /** `me`'s trail ∪ every tip's `homewardPath` path (landing excluded), sorted by arrow id. */
  readonly projected: readonly ArrowId[];
  /** Projected arrows that are not `me`'s territory. */
  readonly arrows: number;
  /** Of those, the ones that flank a spawner vertex. */
  readonly shares: number;
};

/** `undefined` with no open trail of `me` or no tip; else the sortie readings. */
export const sortieOf = (
  _geometry: GeometryPort,
  _state: GameState,
  _me: PlayerId,
): Sortie | undefined => notImplemented();

/** Decision 3a: `SORTIE_CREDIT × loot(shares, arrows)` inside the caps and the window, else 0. */
export const sortieCredit = (
  _geometry: GeometryPort,
  _state: GameState,
  _me: PlayerId,
): number => notImplemented();

/** Decision 3b: W(`projected`, cap min(L, `TEMPO_TURN_CAP`)) ≤ L at terminal `state`. */
export const isSortieThreatened = (
  _geometry: GeometryPort,
  _state: GameState,
  _me: PlayerId,
  _projected: readonly ArrowId[],
): boolean => notImplemented();

/** Spec Terms "enemy turns to close": `TEMPO_TURN_CAP + 1` when `enemy` has no tip or none lands within the cap. */
export const enemyTurnsToClose = (
  _geometry: GeometryPort,
  _state: GameState,
  _enemy: PlayerId,
): number => notImplemented();

/** Decision 4's won race. */
export type Intercept = {
  readonly enemy: PlayerId;
  /** The enemy's bare marks, sorted by arrow id. */
  readonly targets: readonly ArrowId[];
  /** My turns to reach a bare mark (min over my groups). */
  readonly turns: number;
  /** The enemy's turns to close. */
  readonly enemyTurns: number;
  /** Decision 7's backward field: grain steps from `arrow` to a target (∞ off the field). */
  readonly stepsTo: (arrow: ArrowId) => number;
};

/** `undefined`, or the won race of decision 4 at the turn's start state. */
export const interceptOf = (
  _geometry: GeometryPort,
  _state: GameState,
  _me: PlayerId,
): Intercept | undefined => notImplemented();

/** Min over `me`'s groups of `intercept.stepsTo`. */
export const interceptDistance = (
  _state: GameState,
  _me: PlayerId,
  _intercept: Intercept,
): number => notImplemented();
