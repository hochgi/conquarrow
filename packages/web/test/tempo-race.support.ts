/**
 * Test-side oracle for the P85 race arithmetic
 * (docs/spec/heuristic-tempo-horizon/heuristic-tempo-horizon.md, "Terms" and
 * decisions 1–3, 7). Written from the spec's prose, independently of
 * `botTempo.ts`: one forward grain search per mover, no backward field, no
 * memo. Positions and premises are classified with these; the production
 * readings are asserted against them.
 *
 * A leaf: imports only the geometry and P53's `homewardPath` / P54's `loot`
 * (both named by the spec), so `mission-and-staging.support.ts` (P59's
 * threat-test mirror) and the P85 suite can share it without a cycle.
 */

import { speed } from '@conquarrow/contracts';
import type { ArrowId, GameState, PlayerId } from '@conquarrow/contracts';
import { loot } from '../src/botClose';
import { homewardPath } from '../src/botEvaluate';
import { geometry } from './bot-turn-search.support';

/** Spec decision 7 constants, restated (the skeleton's values are asserted against these). */
export const SPEC_TEMPO_TURN_CAP = 8;
export const SPEC_SORTIE_TURN_CAP = 3;
export const SPEC_SORTIE_TOTAL_CAP = 5;
export const SPEC_SORTIE_CREDIT = 0.5;

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const compareArrowIds = (a: ArrowId, b: ArrowId): number => compareIds(String(a), String(b));
export const comparePlayerIds = (a: PlayerId, b: PlayerId): number => compareIds(String(a), String(b));

/** Spec Terms "turns for a group": `max(1, ceil(d / speed(heads)))`. */
export const specTurnsFor = (d: number, heads: number): number =>
  Math.max(1, Math.ceil(d / speed(heads)));

/**
 * Forward grain BFS from `start` to the nearest of `targets`, stepping only
 * *through* arrows `blocked` rejects (a target may itself be blocked; the
 * start is where the mover stands, never stepped through). `depth + 1` when
 * none is within `depth`.
 */
export const specPassableDistance = (
  start: ArrowId,
  targets: ReadonlySet<string>,
  blocked: (arrow: ArrowId) => boolean,
  depth: number,
): number => {
  if (targets.has(String(start))) return 0;
  const seen = new Set<string>([String(start)]);
  let frontier: ArrowId[] = [start];
  for (let d = 1; d <= depth && frontier.length > 0; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const exit of geometry.outArrows(geometry.target(arrow))) {
        const key = String(exit);
        if (seen.has(key)) continue;
        if (targets.has(key)) return d;
        seen.add(key);
        if (blocked(exit)) continue;
        next.push(exit);
      }
    }
    frontier = next;
  }
  return depth + 1;
};

const keys = (arrows: Iterable<ArrowId>): ReadonlySet<string> =>
  new Set([...arrows].map((a) => String(a)));

/** Spec Terms "safe window, W" — enemy paths may not cross `me`'s territory. */
export const specSafeWindow = (
  state: GameState,
  me: PlayerId,
  arrows: readonly ArrowId[],
  cap: number,
): number => {
  const targets = keys(arrows);
  let best = cap + 1;
  if (targets.size === 0) return best;
  const blocked = (arrow: ArrowId): boolean => state.territory.get(arrow) === me;
  for (const [at, group] of state.groups) {
    if (group.owner === me) continue;
    const depth = speed(group.heads) * cap;
    const d = specPassableDistance(at, targets, blocked, depth);
    if (d > depth) continue;
    best = Math.min(best, specTurnsFor(d, group.heads));
  }
  return best;
};

/** Spec Terms "tip": `player`'s groups on `player`'s own trail, sorted by arrow id. */
export const specTips = (state: GameState, player: PlayerId): readonly ArrowId[] => {
  const trail = state.trails.get(player);
  if (trail === undefined || trail.size === 0) return [];
  const out: ArrowId[] = [];
  for (const [arrow, group] of state.groups) {
    if (group.owner === player && trail.has(arrow)) out.push(arrow);
  }
  return out.toSorted(compareArrowIds);
};

const headsAt = (state: GameState, arrow: ArrowId): number => {
  const group = state.groups.get(arrow);
  if (group === undefined) throw new Error(`setup: no group on ${String(arrow)}`);
  return group.heads;
};

export type SpecSortie = {
  readonly turnsToLand: number;
  readonly elapsed: number;
  readonly projected: readonly ArrowId[];
  readonly arrows: number;
  readonly shares: number;
};

const spawnerBorders = (state: GameState): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) out.add(String(arrow));
  }
  return out;
};

/** Spec Terms "projected sortie", "turns to land L", "elapsed"; decision 7's landing depth. */
export const specSortie = (state: GameState, me: PlayerId): SpecSortie | undefined => {
  const trail = state.trails.get(me);
  const tips = specTips(state, me);
  if (trail === undefined || trail.size === 0 || tips.length === 0) return undefined;
  const projected = new Map<string, ArrowId>();
  for (const arrow of trail) projected.set(String(arrow), arrow);
  let turnsToLand = 0;
  let fastest = 0;
  for (const tip of tips) {
    const heads = headsAt(state, tip);
    fastest = Math.max(fastest, speed(heads));
    const depth = speed(heads) * (SPEC_SORTIE_TURN_CAP + 1);
    const home = homewardPath(geometry, state, me, tip, depth);
    for (const arrow of home.path) projected.set(String(arrow), arrow);
    const t = home.distance > depth ? SPEC_TEMPO_TURN_CAP + 1 : specTurnsFor(home.distance, heads);
    turnsToLand = Math.max(turnsToLand, t);
  }
  const sorted = [...projected.values()].toSorted(compareArrowIds);
  const flanks = spawnerBorders(state);
  const notMine = sorted.filter((a) => state.territory.get(a) !== me);
  return {
    turnsToLand,
    elapsed: Math.ceil(trail.size / fastest),
    projected: sorted,
    arrows: notMine.length,
    shares: notMine.filter((a) => flanks.has(String(a))).length,
  };
};

/** Decision 3a. */
export const specSortieCredit = (state: GameState, me: PlayerId): number => {
  const s = specSortie(state, me);
  if (s === undefined) return 0;
  const L = s.turnsToLand;
  if (L > SPEC_SORTIE_TURN_CAP) return 0;
  if (s.elapsed + L > SPEC_SORTIE_TOTAL_CAP) return 0;
  if (specSafeWindow(state, me, s.projected, L) <= L) return 0;
  return SPEC_SORTIE_CREDIT * loot(s.shares, s.arrows);
};

/** Decision 3b's L: 1 with no open trail (or no tip), else the terminal's turns to land. */
export const specThreatL = (state: GameState, me: PlayerId): number =>
  specSortie(state, me)?.turnsToLand ?? 1;

/** Decision 3b: W(projected, cap min(L, TEMPO_TURN_CAP)) ≤ L. */
export const specIsSortieThreatened = (
  state: GameState,
  me: PlayerId,
  projected: readonly ArrowId[],
): boolean => {
  const L = specThreatL(state, me);
  return specSafeWindow(state, me, projected, Math.min(L, SPEC_TEMPO_TURN_CAP)) <= L;
};

/** Spec Terms "enemy turns to close". */
export const specEnemyTurnsToClose = (state: GameState, enemy: PlayerId): number => {
  let best = SPEC_TEMPO_TURN_CAP + 1;
  for (const tip of specTips(state, enemy)) {
    const heads = headsAt(state, tip);
    const depth = speed(heads) * SPEC_TEMPO_TURN_CAP;
    const d = homewardPath(geometry, state, enemy, tip, depth).distance;
    if (d > depth) continue;
    best = Math.min(best, specTurnsFor(d, heads));
  }
  return best;
};

/** Spec Terms "bare mark": an arrow of `enemy`'s trail with no group of `enemy` on it. */
export const specBareMarks = (state: GameState, enemy: PlayerId): readonly ArrowId[] => {
  const trail = state.trails.get(enemy);
  if (trail === undefined) return [];
  return [...trail]
    .filter((arrow) => state.groups.get(arrow)?.owner !== enemy)
    .toSorted(compareArrowIds);
};

export type SpecRace = {
  readonly enemy: PlayerId;
  readonly targets: readonly ArrowId[];
  readonly turns: number;
  readonly enemyTurns: number;
  /** Forward passable grain distance from `arrow` to a target, `Infinity` beyond the race's depth. */
  readonly stepsTo: (arrow: ArrowId) => number;
};

const myRaceDepth = (state: GameState, me: PlayerId, enemyTurns: number): number => {
  let fastest = 0;
  for (const group of state.groups.values()) {
    if (group.owner === me) fastest = Math.max(fastest, speed(group.heads));
  }
  return fastest * enemyTurns;
};

/** My race against `enemy` (won or not); `undefined` with no bare mark or no closing tip within the cap. */
export const specRaceAgainst = (state: GameState, me: PlayerId, enemy: PlayerId): SpecRace | undefined => {
  const targets = specBareMarks(state, enemy);
  if (targets.length === 0) return undefined;
  const enemyTurns = specEnemyTurnsToClose(state, enemy);
  if (enemyTurns > SPEC_TEMPO_TURN_CAP) return undefined;
  const want = keys(targets);
  const blocked = (arrow: ArrowId): boolean => {
    const owner = state.territory.get(arrow);
    return owner !== undefined && owner !== me;
  };
  const depth = myRaceDepth(state, me, enemyTurns);
  const stepsTo = (arrow: ArrowId): number => {
    const d = specPassableDistance(arrow, want, blocked, depth);
    return d > depth ? Number.POSITIVE_INFINITY : d;
  };
  let turns = Number.POSITIVE_INFINITY;
  for (const [at, group] of state.groups) {
    if (group.owner !== me) continue;
    const d = stepsTo(at);
    if (d === Number.POSITIVE_INFINITY) continue;
    turns = Math.min(turns, specTurnsFor(d, group.heads));
  }
  return { enemy, targets, turns, enemyTurns, stepsTo };
};

/** Decision 4: among won races (turns ≤ enemyTurns), fewest my-turns, then the lower PlayerId. */
export const specInterceptOf = (state: GameState, me: PlayerId): SpecRace | undefined => {
  let best: SpecRace | undefined;
  for (const enemy of state.players.filter((p) => p !== me).toSorted(comparePlayerIds)) {
    const race = specRaceAgainst(state, me, enemy);
    if (race === undefined || race.turns > race.enemyTurns) continue;
    if (best === undefined || race.turns < best.turns) best = race;
  }
  return best;
};

/** Min over `me`'s groups in `state` of the race's `stepsTo` (the spec's `interceptDistance`). */
export const specInterceptDistance = (state: GameState, me: PlayerId, race: SpecRace): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const [at, group] of state.groups) {
    if (group.owner === me) best = Math.min(best, race.stepsTo(at));
  }
  return best;
};

export const trailSize = (state: GameState, player: PlayerId): number =>
  state.trails.get(player)?.size ?? 0;

export const landOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner === player) n += 1;
  return n;
};
