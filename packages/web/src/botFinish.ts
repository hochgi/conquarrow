/**
 * The heuristic seat's finisher (P81, docs/spec/heuristic-finishes). Adapter
 * only — no game rule.
 *
 * Pure: no clocks, no RNG, no I/O. Ties break on arrow ids, never on Map or
 * Set iteration order. Called from `chooseTurnBeamWithBudget` only for the live
 * seat (`withReplies: true`); `botSearch` holds the wiring, this module the
 * logic (spec decision 7).
 */

import { endTurn, movesEqual, speed, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Group,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';

/** Decision 4: dominant when `heads(me) ≥ FINISH_RATIO × max(1, Σ heads of every other seat)`. */
export const FINISH_RATIO = 2;

/** Decision 5: at most this many validated carves join the search. */
export const CARVE_TOP = 4;

/**
 * Steps a plan may hold before its `endTurn`: botSearch's `MAX_PLAN − 1`.
 * Declared here (not imported) so this module does not import the search that
 * calls it; `MAX_PLAN` is fixed by spec decision 8.
 */
const PLAN_STEPS = 7;

/** Decision 5: a carve takes at most this many steps over own ground before leaving it. */
const CARVE_OWN_STEPS = 2;

/** Decision 6: the staging path's search depth. */
const STAGING_DIST_CAP = 16;

/** Decision 6: the smallest stack that walks. */
const STAGING_MIN_HEADS = 4;

/**
 * A complete plan for `me` — the moves and the state they reach. Structurally a
 * `CompletePlan` (botSearch) without a reply score; declared here so this
 * module does not import the search that calls it.
 */
export type FinishPlan = {
  readonly moves: readonly Move[];
  readonly state: GameState;
};

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const compareArrows = (a: ArrowId, b: ArrowId): number => compareIds(String(a), String(b));

const outsOf = (geometry: GeometryPort, arrow: ArrowId): readonly ArrowId[] =>
  geometry.outArrows(geometry.target(arrow));

const headsOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const group of state.groups.values()) if (group.owner === player) n += group.heads;
  return n;
};

const territoryOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner === player) n += 1;
  return n;
};

const isOtherSeatGround = (state: GameState, me: PlayerId, arrow: ArrowId): boolean => {
  const owner = state.territory.get(arrow);
  return owner !== undefined && owner !== me;
};

/** `me`'s groups standing on `me`'s territory, by arrow id. */
const ownGroupsOnOwnGround = (
  state: GameState,
  me: PlayerId,
): readonly (readonly [ArrowId, Group])[] =>
  [...state.groups.entries()]
    .filter(([arrow, group]) => group.owner === me && state.territory.get(arrow) === me)
    .toSorted(([a], [b]) => compareArrows(a, b));

/** The legal step `from → exit` moving `count` heads, if there is one. */
const legalStep = (
  rules: RulesPort,
  state: GameState,
  move: StepMove,
): StepMove | undefined =>
  move.count >= 1 && rules.legalMoves(state).some((legal) => movesEqual(legal, move))
    ? move
    : undefined;

/** Close a plan with `endTurn` while it is still `me`'s turn. */
const closeTurn = (
  rules: RulesPort,
  at: GameState,
  me: PlayerId,
  moves: readonly Move[],
): FinishPlan =>
  at.winner === undefined && at.activePlayer === me
    ? { moves: [...moves, endTurn()], state: rules.apply(at, endTurn()) }
    : { moves, state: at };

// ---------------------------------------------------------------------------
// Decision 4 — the dominance gate; Terms — a quiet plan
// ---------------------------------------------------------------------------

/**
 * Decision 4 — `me` holds at least `FINISH_RATIO` times every other seat's heads
 * combined (floored at 1), and some other seat owns territory.
 */
export const isDominant = (state: GameState, me: PlayerId): boolean => {
  let mine = 0;
  let others = 0;
  for (const group of state.groups.values()) {
    if (group.owner === me) mine += group.heads;
    else others += group.heads;
  }
  if (mine < FINISH_RATIO * Math.max(1, others)) return false;
  for (const owner of state.territory.values()) if (owner !== me) return true;
  return false;
};

/**
 * Terms — a quiet plan: from `origin` to `terminal`, `me`'s territory has not
 * grown, no other seat's territory has shrunk, and no other seat has lost heads.
 */
export const isQuietPlan = (origin: GameState, terminal: GameState, me: PlayerId): boolean => {
  if (territoryOf(terminal, me) > territoryOf(origin, me)) return false;
  return origin.players.every(
    (other) =>
      other === me ||
      (territoryOf(terminal, other) >= territoryOf(origin, other) &&
        headsOf(terminal, other) >= headsOf(origin, other)),
  );
};

// ---------------------------------------------------------------------------
// Decision 5 — carve plans
// ---------------------------------------------------------------------------

type Carve = {
  readonly from: ArrowId;
  /** Arrows stepped onto, in order; the last is the landing. */
  readonly path: readonly ArrowId[];
  readonly enemy: number;
  readonly shares: number;
  /** Start and path arrow ids — the final tiebreak. */
  readonly key: string;
};

type CarveSearch = {
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
  readonly state: GameState;
  readonly me: PlayerId;
  /** `me`'s territory — the ground a landing adds its path to. */
  readonly ownGround: readonly ArrowId[];
  /** Arrows bordering a spawner (shares). */
  readonly shareKeys: ReadonlySet<string>;
  readonly found: Carve[];
};

/** The DFS cursor for one start group. */
type CarveWalk = {
  readonly from: ArrowId;
  readonly limit: number;
  readonly path: ArrowId[];
  readonly seen: Set<string>;
};

type ExitKind = 'skip' | 'land' | 'walk';

const shareKeysOf = (geometry: GeometryPort, state: GameState): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) out.add(String(arrow));
  }
  return out;
};

/** Decision 5's step rules for entering `x`, given whether the walk has left own ground. */
const classifyExit = (
  cs: CarveSearch,
  x: ArrowId,
  left: boolean,
  ownSteps: number,
): ExitKind => {
  const holder = cs.state.groups.get(x);
  const xOwn = cs.state.territory.get(x) === cs.me;
  if (xOwn && holder !== undefined && holder.owner !== cs.me) return 'skip';
  if (left && xOwn) return 'land';
  if (holder !== undefined && holder.owner === cs.me) return 'skip';
  if (!left && xOwn && ownSteps >= CARVE_OWN_STEPS) return 'skip';
  return 'walk';
};

/** Terms — claim estimate: the path's non-own arrows plus `enclosedBy(own ∪ path)`, scored. */
const scoreLanding = (cs: CarveSearch, from: ArrowId, path: readonly ArrowId[]): void => {
  const ground = new Set<ArrowId>(cs.ownGround);
  for (const arrow of path) ground.add(arrow);
  const claim = new Set<string>();
  let enemy = 0;
  let shares = 0;
  const count = (arrow: ArrowId): void => {
    const key = String(arrow);
    if (claim.has(key)) return;
    claim.add(key);
    if (!isOtherSeatGround(cs.state, cs.me, arrow)) return;
    enemy += 1;
    if (cs.shareKeys.has(key)) shares += 1;
  };
  for (const arrow of path) if (cs.state.territory.get(arrow) !== cs.me) count(arrow);
  for (const arrow of cs.rules.enclosedBy(ground, cs.me)) count(arrow);
  if (enemy === 0) return;
  const key = [from, ...path].map(String).join('|');
  cs.found.push({ from, path: [...path], enemy, shares, key });
};

const walkCarves = (
  cs: CarveSearch,
  walk: CarveWalk,
  cur: ArrowId,
  ownSteps: number,
  left: boolean,
): void => {
  if (walk.path.length >= walk.limit) return;
  // Exit order only shapes the order of `found`, which is sorted totally afterwards.
  for (const x of outsOf(cs.geometry, cur)) {
    if (walk.seen.has(String(x))) continue;
    const kind = classifyExit(cs, x, left, ownSteps);
    if (kind === 'skip') continue;
    if (kind === 'land') {
      scoreLanding(cs, walk.from, [...walk.path, x]);
      continue;
    }
    const xOwn = cs.state.territory.get(x) === cs.me;
    walk.path.push(x);
    walk.seen.add(String(x));
    walkCarves(cs, walk, x, xOwn ? ownSteps + 1 : ownSteps, left || !xOwn);
    walk.path.pop();
    walk.seen.delete(String(x));
  }
};

/** Decision 5's ranking: shares, enemy arrows (desc), length (asc), then arrow ids. */
const compareCarves = (a: Carve, b: Carve): number =>
  b.shares - a.shares ||
  b.enemy - a.enemy ||
  a.path.length - b.path.length ||
  compareIds(a.key, b.key);

const findCarves = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
): readonly Carve[] => {
  const ownGround: ArrowId[] = [];
  for (const [arrow, owner] of state.territory) if (owner === me) ownGround.push(arrow);
  const cs: CarveSearch = {
    geometry,
    rules,
    state,
    me,
    ownGround,
    shareKeys: shareKeysOf(geometry, state),
    found: [],
  };
  for (const [from, group] of ownGroupsOnOwnGround(state, me)) {
    const allowance = rules.effectiveSpeed(state, from) - group.spent;
    const limit = Math.min(allowance, PLAN_STEPS);
    if (limit < 2) continue;
    walkCarves(cs, { from, limit, path: [], seen: new Set([String(from)]) }, from, 0, false);
  }
  return cs.found.toSorted(compareCarves);
};

/** The step onto `exit` with all of the group's heads, or all but one where that is illegal. */
const carveStep = (
  rules: RulesPort,
  at: GameState,
  cur: ArrowId,
  exit: ArrowId,
): StepMove | undefined => {
  const heads = at.groups.get(cur)?.heads ?? 0;
  return (
    legalStep(rules, at, step(cur, exit, heads)) ??
    legalStep(rules, at, step(cur, exit, heads - 1))
  );
};

/** Decision 5's replay; `undefined` when a step is illegal or the group loses its fight. */
const replayCarve = (
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  carve: Carve,
): FinishPlan | undefined => {
  let at = state;
  let cur = carve.from;
  const moves: Move[] = [];
  for (const exit of carve.path) {
    const move = carveStep(rules, at, cur, exit);
    if (move === undefined) return undefined;
    at = rules.apply(at, move);
    moves.push(move);
    if (at.groups.get(exit)?.owner !== me) return undefined;
    cur = exit;
    if (at.activePlayer !== me || at.winner !== undefined) break;
  }
  return closeTurn(rules, at, me, moves);
};

/**
 * Decision 5 — up to `CARVE_TOP` validated carves for a dominant seat, best
 * claim first. Each is a complete plan ending `me`'s turn. Empty when `me` is
 * not dominant.
 */
export const carvePlans = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
): readonly FinishPlan[] => {
  if (!isDominant(state, me)) return [];
  const out: FinishPlan[] = [];
  for (const carve of findCarves(geometry, rules, state, me).slice(0, CARVE_TOP)) {
    const plan = replayCarve(rules, state, me, carve);
    if (plan !== undefined) out.push(plan);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Decision 6 — the staging walk
// ---------------------------------------------------------------------------

/** Terms — entry arrows: own territory with an out-arrow onto another seat's territory. */
const entryArrowsOf = (geometry: GeometryPort, state: GameState, me: PlayerId): ArrowId[] => {
  const out: ArrowId[] = [];
  for (const [arrow, owner] of state.territory) {
    if (owner !== me) continue;
    if (outsOf(geometry, arrow).some((x) => isOtherSeatGround(state, me, x))) out.push(arrow);
  }
  return out.toSorted(compareArrows);
};

/**
 * Own-ground grain distance from every own arrow to the nearest entry arrow,
 * capped at `STAGING_DIST_CAP` — one reverse BFS (in-arrows of an arrow's origin
 * are the arrows that step onto it). Absent = unreachable within the cap.
 */
const distancesToEntries = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  entries: readonly ArrowId[],
): ReadonlyMap<string, number> => {
  const dist = new Map<string, number>();
  for (const entry of entries) dist.set(String(entry), 0);
  let frontier: readonly ArrowId[] = entries;
  for (let d = 1; d <= STAGING_DIST_CAP && frontier.length > 0; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const prev of geometry.inArrows(geometry.origin(arrow))) {
        if (state.territory.get(prev) !== me || dist.has(String(prev))) continue;
        dist.set(String(prev), d);
        next.push(prev);
      }
    }
    frontier = next;
  }
  return dist;
};

type Walker = { readonly from: ArrowId; readonly heads: number; readonly length: number };

const turnsFor = (w: Walker): number => Math.ceil(w.length / speed(w.heads));

/** Decision 6's walker order: fewest turns to an entry, most heads, smallest arrow id. */
const betterWalker = (a: Walker, b: Walker): Walker => {
  if (turnsFor(a) !== turnsFor(b)) return turnsFor(a) < turnsFor(b) ? a : b;
  if (a.heads !== b.heads) return a.heads > b.heads ? a : b;
  return compareArrows(a.from, b.from) <= 0 ? a : b;
};

const pickWalker = (
  state: GameState,
  me: PlayerId,
  dist: ReadonlyMap<string, number>,
): Walker | undefined => {
  let best: Walker | undefined;
  for (const [from, group] of ownGroupsOnOwnGround(state, me)) {
    if (group.heads < STAGING_MIN_HEADS || group.spent !== 0) continue;
    const length = dist.get(String(from));
    if (length === undefined || length === 0) continue;
    const walker = { from, heads: group.heads, length };
    best = best === undefined ? walker : betterWalker(best, walker);
  }
  return best;
};

/** The shortest own-ground path from `from`: at each arrow the smallest-id exit one step nearer. */
const shortestPath = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  dist: ReadonlyMap<string, number>,
  walker: Walker,
): readonly ArrowId[] => {
  const path: ArrowId[] = [];
  let cur = walker.from;
  for (let d = walker.length - 1; d >= 0; d -= 1) {
    const next = outsOf(geometry, cur)
      .filter((x) => state.territory.get(x) === me && dist.get(String(x)) === d)
      .toSorted(compareArrows)[0];
    if (next === undefined) break;
    path.push(next);
    cur = next;
  }
  return path;
};

/** Walk `path` with all heads, stopping at the first illegal step. */
const walkSteps = (
  rules: RulesPort,
  state: GameState,
  from: ArrowId,
  path: readonly ArrowId[],
): { readonly moves: readonly Move[]; readonly state: GameState } => {
  let at = state;
  let cur = from;
  const moves: Move[] = [];
  for (const exit of path) {
    const move = legalStep(rules, at, step(cur, exit, at.groups.get(cur)?.heads ?? 0));
    if (move === undefined) break;
    at = rules.apply(at, move);
    moves.push(move);
    cur = exit;
  }
  return { moves, state: at };
};

/**
 * Decision 6 — one own stack's walk across own territory toward the nearest
 * entry arrow, closed by `endTurn`. `undefined` when `me` is not dominant, no
 * entry arrow exists, or no walker can take a step.
 */
export const stagingWalk = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
): FinishPlan | undefined => {
  if (!isDominant(state, me)) return undefined;
  const entries = entryArrowsOf(geometry, state, me);
  if (entries.length === 0) return undefined;
  const dist = distancesToEntries(geometry, state, me, entries);
  const walker = pickWalker(state, me, dist);
  if (walker === undefined) return undefined;
  const steps = Math.min(speed(walker.heads), PLAN_STEPS, walker.length);
  const path = shortestPath(geometry, state, me, dist, walker).slice(0, steps);
  const walked = walkSteps(rules, state, walker.from, path);
  if (walked.moves.length === 0) return undefined;
  return closeTurn(rules, walked.state, me, walked.moves);
};
