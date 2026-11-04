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
 * Each distance field is one backward grain search from its targets
 * (decision 7). Ordered decisions sort by id; a min does not.
 */
import { speed } from '@conquarrow/contracts';
import type { ArrowId, GameState, GeometryPort, PlayerId } from '@conquarrow/contracts';
import { loot } from './botClose';
import { homewardPath } from './botEvaluate';

/** Decision 7: no race or window is read beyond this many turns. */
export const TEMPO_TURN_CAP = 8;
/** Decision 7: a terminal whose turns to land L exceeds this earns no credit. */
export const SORTIE_TURN_CAP = 3;
/** Decision 7: elapsed + L above this earns no credit (the stateless stopping rule). */
export const SORTIE_TOTAL_CAP = 5;
/** Decision 3a / 7: a pending close is credited at half its projected loot. */
export const SORTIE_CREDIT = 0.5;

const UNREACHABLE = Number.POSITIVE_INFINITY;

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareArrows = (a: ArrowId, b: ArrowId): number => compareIds(String(a), String(b));

const comparePlayers = (a: PlayerId, b: PlayerId): number => compareIds(String(a), String(b));

/** Spec Terms "turns for a group": `max(1, ceil(d / speed(heads)))`. */
const turnsFor = (d: number, heads: number): number => Math.max(1, Math.ceil(d / speed(heads)));

const trailOf = (state: GameState, player: PlayerId): ReadonlySet<ArrowId> | undefined => {
  const trail = state.trails.get(player);
  return trail !== undefined && trail.size > 0 ? trail : undefined;
};

/** A player's groups standing on that player's own trail, sorted by arrow id. */
const tipsOf = (state: GameState, player: PlayerId): readonly ArrowId[] => {
  const trail = trailOf(state, player);
  if (trail === undefined) return [];
  const tips: ArrowId[] = [];
  for (const [arrow, group] of state.groups) {
    if (group.owner === player && trail.has(arrow)) tips.push(arrow);
  }
  return tips.toSorted(compareArrows);
};

const headsAt = (state: GameState, arrow: ArrowId): number => {
  const group = state.groups.get(arrow);
  if (group === undefined) return 0;
  return group.heads;
};

/**
 * One backward grain search. Targets are distance 0 and are expanded even
 * when not passable (a target may itself be blocked). A passable arrow is
 * expanded; a blocked non-target is recorded so a group standing on it can
 * read its distance, but is not expanded — a path may not step through it.
 */
const stepsField = (
  geometry: GeometryPort,
  targets: readonly ArrowId[],
  passable: (arrow: ArrowId) => boolean,
  depth: number,
): ReadonlyMap<string, number> => {
  const dist = new Map<string, number>();
  const roots: ArrowId[] = [];
  for (const target of targets) {
    const key = String(target);
    if (dist.has(key)) continue;
    dist.set(key, 0);
    roots.push(target);
  }
  let frontier: readonly ArrowId[] = roots;
  for (let d = 1; d <= depth && frontier.length > 0; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const prev of geometry.inArrows(geometry.origin(arrow))) {
        const key = String(prev);
        if (dist.has(key)) continue;
        dist.set(key, d);
        if (passable(prev)) next.push(prev);
      }
    }
    frontier = next;
  }
  return dist;
};

const stepsAt = (field: ReadonlyMap<string, number>, arrow: ArrowId): number =>
  field.get(String(arrow)) ?? UNREACHABLE;

const fastest = (state: GameState, wanted: (owner: PlayerId) => boolean): number => {
  let best = 0;
  for (const group of state.groups.values()) {
    if (!wanted(group.owner)) continue;
    best = Math.max(best, speed(group.heads));
  }
  return best;
};

/**
 * Min turns among groups `wanted` accepts, reading `stepsTo`. A group whose
 * distance is beyond `depthOf(heads)` does not count. `UNREACHABLE` when none.
 */
const minTurns = (
  state: GameState,
  wanted: (owner: PlayerId) => boolean,
  stepsTo: (arrow: ArrowId) => number,
  depthOf: (heads: number) => number,
): number => {
  let best = UNREACHABLE;
  for (const [at, group] of state.groups) {
    if (!wanted(group.owner)) continue;
    const d = stepsTo(at);
    if (!Number.isFinite(d) || d > depthOf(group.heads)) continue;
    best = Math.min(best, turnsFor(d, group.heads));
  }
  return best;
};

/**
 * Spec Terms "safe window, W": the min over enemy groups of turns for that
 * group to reach any arrow of `arrows` by a path passable for it (`me`'s
 * territory blocked); `cap + 1` when none is within `cap`. In `1 … cap + 1`.
 */
export const safeWindow = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  arrows: readonly ArrowId[],
  cap: number,
): number => {
  if (arrows.length === 0) return cap + 1;
  const enemy = (owner: PlayerId): boolean => owner !== me;
  const pace = fastest(state, enemy);
  if (pace === 0) return cap + 1;
  const passable = (arrow: ArrowId): boolean => state.territory.get(arrow) !== me;
  const field = stepsField(geometry, arrows, passable, pace * cap);
  const turns = minTurns(state, enemy, (arrow) => stepsAt(field, arrow), (heads) => speed(heads) * cap);
  return Number.isFinite(turns) ? turns : cap + 1;
};

const spawnerFlanks = (geometry: GeometryPort, state: GameState): ReadonlySet<string> => {
  const flanks = new Set<string>();
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) flanks.add(String(arrow));
  }
  return flanks;
};

type TipHome = {
  readonly turns: number;
  readonly path: readonly ArrowId[];
  readonly pace: number;
};

/** Decision 7: landing depth is `speed(tip) × (SORTIE_TURN_CAP + 1)`. */
const tipHome = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  tip: ArrowId,
): TipHome => {
  const heads = headsAt(state, tip);
  const pace = speed(heads);
  const depth = pace * (SORTIE_TURN_CAP + 1);
  const home = homewardPath(geometry, state, me, tip, depth);
  const turns = home.distance > depth ? TEMPO_TURN_CAP + 1 : turnsFor(home.distance, heads);
  return { turns, path: home.path, pace };
};

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
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
): Sortie | undefined => {
  const trail = trailOf(state, me);
  const tips = tipsOf(state, me);
  if (trail === undefined || tips.length === 0) return undefined;
  const projected = new Map<string, ArrowId>();
  for (const arrow of trail) projected.set(String(arrow), arrow);
  let turnsToLand = 0;
  let pace = 0;
  for (const tip of tips) {
    const home = tipHome(geometry, state, me, tip);
    pace = Math.max(pace, home.pace);
    turnsToLand = Math.max(turnsToLand, home.turns);
    for (const arrow of home.path) projected.set(String(arrow), arrow);
  }
  const sorted = [...projected.values()].toSorted(compareArrows);
  const flanks = spawnerFlanks(geometry, state);
  const fresh = sorted.filter((arrow) => state.territory.get(arrow) !== me);
  return {
    turnsToLand,
    elapsed: Math.ceil(trail.size / pace),
    projected: sorted,
    arrows: fresh.length,
    shares: fresh.filter((arrow) => flanks.has(String(arrow))).length,
  };
};

/** Decision 3a: `SORTIE_CREDIT × loot(shares, arrows)` inside the caps and the window, else 0. */
export const sortieCredit = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
): number => {
  const sortie = sortieOf(geometry, state, me);
  if (sortie === undefined) return 0;
  const turns = sortie.turnsToLand;
  if (turns > SORTIE_TURN_CAP) return 0;
  if (sortie.elapsed + turns > SORTIE_TOTAL_CAP) return 0;
  if (safeWindow(geometry, state, me, sortie.projected, turns) <= turns) return 0;
  return SORTIE_CREDIT * loot(sortie.shares, sortie.arrows);
};

/** Decision 3b's L: 1 with no open trail or no tip, else the terminal's turns to land. */
const threatTurns = (geometry: GeometryPort, state: GameState, me: PlayerId): number =>
  sortieOf(geometry, state, me)?.turnsToLand ?? 1;

/**
 * Decision 3b: W(`projected`, cap min(L, `TEMPO_TURN_CAP`)) ≤ L at terminal
 * `state`. A tip that cannot land within decision 7's depth makes L =
 * `TEMPO_TURN_CAP + 1`, which is at least every window this cap can return.
 */
export const isSortieThreatened = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  projected: readonly ArrowId[],
): boolean => {
  const turns = threatTurns(geometry, state, me);
  if (turns > TEMPO_TURN_CAP) return true;
  return safeWindow(geometry, state, me, projected, turns) <= turns;
};

/** Spec Terms "enemy turns to close": `TEMPO_TURN_CAP + 1` when `enemy` has no tip or none lands within the cap. */
export const enemyTurnsToClose = (
  geometry: GeometryPort,
  state: GameState,
  enemy: PlayerId,
): number => {
  let best = TEMPO_TURN_CAP + 1;
  for (const tip of tipsOf(state, enemy)) {
    const heads = headsAt(state, tip);
    if (heads < 1) continue;
    const depth = speed(heads) * TEMPO_TURN_CAP;
    const home = homewardPath(geometry, state, enemy, tip, depth);
    if (home.distance > depth) continue;
    best = Math.min(best, turnsFor(home.distance, heads));
  }
  return best;
};

/** Spec Terms "bare mark": an arrow of `enemy`'s trail with no group of `enemy` on it. */
const bareMarks = (state: GameState, enemy: PlayerId): readonly ArrowId[] => {
  const trail = state.trails.get(enemy);
  if (trail === undefined) return [];
  return [...trail]
    .filter((arrow) => state.groups.get(arrow)?.owner !== enemy)
    .toSorted(compareArrows);
};

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

const wonRace = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  enemy: PlayerId,
): Intercept | undefined => {
  const targets = bareMarks(state, enemy);
  if (targets.length === 0) return undefined;
  const enemyTurns = enemyTurnsToClose(geometry, state, enemy);
  if (enemyTurns > TEMPO_TURN_CAP) return undefined;
  const mine = (owner: PlayerId): boolean => owner === me;
  const pace = fastest(state, mine);
  const passable = (arrow: ArrowId): boolean => {
    const owner = state.territory.get(arrow);
    return owner === undefined || owner === me;
  };
  const field = stepsField(geometry, targets, passable, pace * enemyTurns);
  const stepsTo = (arrow: ArrowId): number => stepsAt(field, arrow);
  const turns = minTurns(state, mine, stepsTo, () => UNREACHABLE);
  if (turns > enemyTurns) return undefined;
  return { enemy, targets, turns, enemyTurns, stepsTo };
};

/**
 * `undefined`, or the won race of decision 4 at the turn's start state.
 * Enemies in ascending PlayerId; among won races the fewest my-turns; ties
 * keep the lower PlayerId.
 */
export const interceptOf = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
): Intercept | undefined => {
  let best: Intercept | undefined;
  const enemies = state.players.filter((player) => player !== me).toSorted(comparePlayers);
  for (const enemy of enemies) {
    const race = wonRace(geometry, state, me, enemy);
    if (race === undefined) continue;
    if (best === undefined || race.turns < best.turns) best = race;
  }
  return best;
};

/** Min over `me`'s groups of `intercept.stepsTo`. */
export const interceptDistance = (
  state: GameState,
  me: PlayerId,
  intercept: Intercept,
): number => {
  let best = UNREACHABLE;
  for (const [at, group] of state.groups) {
    if (group.owner === me) best = Math.min(best, intercept.stepsTo(at));
  }
  return best;
};
