/**
 * Fixture replay, test-side oracles and constructed boards for P81
 * (docs/spec/heuristic-finishes/heuristic-finishes.md).
 *
 * The oracles mirror the spec's decisions 2, 5 and 6 and the Terms table so a
 * board's premise ("a loop from S1 crosses B's territory", "the only claiming
 * loop passes a B head", "every shortest path passes S2") is *checked* in setup
 * rather than assumed. A premise that fails throws `setup:` — never a red test
 * for the wrong reason.
 *
 * Boards come from two sources:
 * - the committed `mirror-s1` fixture (the P79 seed-1 mirror cell's first 820
 *   moves), replayed from `makeMatch`, for real late-game positions;
 * - small constructed boards on the generated tiling, kept to a few dozen
 *   territory arrows so today's per-source BFS search stays a few seconds.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endTurn, movesEqual, speed, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  Group,
  MatchConfig,
  Move,
  PlayerId,
  StepMove,
} from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { parseMove } from '../src/moves';
import { foldEnemyReply, hypothesiseChair, REPLY_MAX_APPLIES, type ReplySearchFn } from '../src/botReply';
import {
  chooseTurnBeamWithBudget,
  evaluate,
  MAX_PLAN,
  REPLY_BEAM,
  REPLY_BRANCH,
  REPLY_MAX_PLAN,
} from '../src/botSearch';
import {
  geometry,
  outsOf,
  rules,
  SMALL_MATCH,
  THREE_MATCH,
  territoryOf,
  trailSizeOf,
} from './bot-turn-search.support';

export {
  foldPlan,
  geometry,
  legalSteps,
  outsOf,
  planIsLegalSequence,
  planTerminates,
  rules,
  territoryOf,
  trailSizeOf,
} from './bot-turn-search.support';
export { shuffleCloseMaps, specCampaignTarget } from './close-and-spawner-value.support';
export { specRemainingPath } from './mission-and-staging.support';

const here = dirname(fileURLToPath(import.meta.url));

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const compareArrows = (a: ArrowId, b: ArrowId): number => compareIds(String(a), String(b));

/** Spec "Distance cap" for the staging path (decision 6). */
export const STAGING_DIST_CAP = 16;

// ---------------------------------------------------------------------------
// Fixture: mirror-s1
// ---------------------------------------------------------------------------

type MirrorJson = {
  readonly config: MatchConfig;
  readonly moves: readonly unknown[];
};

/** Move index of the start of seat A's turn in round 60. */
export const ROUND_60_MOVE = 382;
/** Move index of the start of seat A's turn in round 160. */
export const ROUND_160_MOVE = 820;

let mirrorStates: readonly GameState[] | undefined;

const loadMirror = (): readonly GameState[] => {
  if (mirrorStates !== undefined) return mirrorStates;
  const raw = JSON.parse(
    readFileSync(join(here, 'fixtures/mirror-s1.moves.json'), 'utf8'),
  ) as MirrorJson;
  const moves: Move[] = raw.moves.map((m, i) => parseMove(m, `mirror-s1 move ${String(i)}`));
  const states: GameState[] = [makeMatch(raw.config)];
  let at = states[0];
  for (const move of moves) {
    if (at === undefined) break;
    at = rules.apply(at, move);
    states.push(at);
  }
  mirrorStates = states;
  return states;
};

/** The `mirror-s1` state after its first `n` moves (`0 ≤ n ≤ 820`). */
export const mirrorAt = (n: number): GameState => {
  const state = loadMirror()[n];
  if (state === undefined) throw new Error(`setup: mirror-s1 has no state after ${String(n)} moves`);
  return state;
};

/** Seats in turn order: A moves first. */
export const seatsOf = (state: GameState): { readonly A: PlayerId; readonly B: PlayerId } => {
  const [A, B] = state.players;
  if (A === undefined || B === undefined) throw new Error('setup: need two seats');
  return { A, B };
};

/** Move indices at which `seat`'s turn starts in the fixture (state before that move). */
export const mirrorTurnStarts = (seat: 'A' | 'B'): readonly number[] => {
  const states = loadMirror();
  const out: number[] = [];
  for (let n = 0; n < states.length; n += 1) {
    const state = states[n];
    if (state === undefined || state.winner !== undefined) continue;
    const who = seatsOf(state)[seat];
    if (state.activePlayer !== who) continue;
    const prev = n === 0 ? undefined : states[n - 1];
    if (prev === undefined || prev.activePlayer !== who) out.push(n);
  }
  return out;
};

/** Full rounds completed after the fixture's first `n` moves (the bench's counter). */
export const fullRoundsAt = (n: number): number => {
  const states = loadMirror();
  let rounds = 0;
  for (let i = 1; i <= n; i += 1) {
    const before = states[i - 1];
    const after = states[i];
    if (before === undefined || after === undefined) break;
    const first = after.players[0];
    if (before.activePlayer !== first && after.activePlayer === first) rounds += 1;
  }
  return rounds;
};

/** Every `stride`-th A or B turn start, for property sweeps. */
export const sampleTurnStarts = (seat: 'A' | 'B', stride: number): readonly number[] =>
  mirrorTurnStarts(seat).filter((_, i) => i % stride === 0);

// ---------------------------------------------------------------------------
// Readings of a state
// ---------------------------------------------------------------------------

export const headsOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const group of state.groups.values()) if (group.owner === player) n += group.heads;
  return n;
};

export const otherHeads = (state: GameState, me: PlayerId): number => {
  let n = 0;
  for (const group of state.groups.values()) if (group.owner !== me) n += group.heads;
  return n;
};

export const otherTerritory = (state: GameState, me: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner !== me) n += 1;
  return n;
};

/** The Terms-table definition of dominant, read off the board. */
export const specDominant = (state: GameState, me: PlayerId): boolean =>
  headsOf(state, me) >= 2 * Math.max(1, otherHeads(state, me)) && otherTerritory(state, me) > 0;

/** The Terms-table definition of a quiet plan. */
export const specQuiet = (origin: GameState, terminal: GameState, me: PlayerId): boolean => {
  if (territoryOf(terminal, me) > territoryOf(origin, me)) return false;
  for (const other of origin.players) {
    if (other === me) continue;
    if (territoryOf(terminal, other) < territoryOf(origin, other)) return false;
    if (headsOf(terminal, other) < headsOf(origin, other)) return false;
  }
  return true;
};

const shareArrowKeys = (state: GameState): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) out.add(String(arrow));
  }
  return out;
};

/** Terms: own-territory arrows with an out-arrow onto another seat's territory, sorted. */
export const entryArrows = (state: GameState, me: PlayerId): readonly ArrowId[] => {
  const out: ArrowId[] = [];
  for (const [arrow, owner] of state.territory) {
    if (owner !== me) continue;
    if (outsOf(arrow).some((x) => {
      const o = state.territory.get(x);
      return o !== undefined && o !== me;
    })) {
      out.push(arrow);
    }
  }
  return out.toSorted(compareArrows);
};

/**
 * Distances along the grain over `me`'s own territory from every own arrow to
 * the nearest of `goals` (reverse BFS), capped at `cap`. Missing = unreachable.
 */
const ownGroundDistances = (
  state: GameState,
  me: PlayerId,
  goals: readonly ArrowId[],
  cap: number,
): ReadonlyMap<string, number> => {
  const own: ArrowId[] = [];
  for (const [arrow, owner] of state.territory) if (owner === me) own.push(arrow);
  const preds = new Map<string, ArrowId[]>();
  for (const arrow of own.toSorted(compareArrows)) {
    for (const x of outsOf(arrow)) {
      if (state.territory.get(x) !== me) continue;
      const list = preds.get(String(x)) ?? [];
      list.push(arrow);
      preds.set(String(x), list);
    }
  }
  const dist = new Map<string, number>();
  let frontier = goals.filter((g) => state.territory.get(g) === me);
  for (const g of frontier) dist.set(String(g), 0);
  for (let d = 1; d <= cap && frontier.length > 0; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const p of preds.get(String(arrow)) ?? []) {
        if (dist.has(String(p))) continue;
        dist.set(String(p), d);
        next.push(p);
      }
    }
    frontier = next;
  }
  return dist;
};

/** Own-ground grain distance from `start` to the nearest entry arrow; `cap + 1` if none. */
export const entryDistance = (
  state: GameState,
  me: PlayerId,
  start: ArrowId,
  entries: readonly ArrowId[] = entryArrows(state, me),
  cap = STAGING_DIST_CAP,
): number => ownGroundDistances(state, me, entries, cap).get(String(start)) ?? cap + 1;

/** The arrow holding `me`'s largest group (ties: smallest arrow id). */
export const largestGroupArrow = (state: GameState, me: PlayerId): ArrowId => {
  let best: ArrowId | undefined;
  let bestHeads = 0;
  for (const [arrow, group] of [...state.groups.entries()].toSorted(([a], [b]) => compareArrows(a, b))) {
    if (group.owner !== me) continue;
    if (group.heads > bestHeads) {
      best = arrow;
      bestHeads = group.heads;
    }
  }
  if (best === undefined) throw new Error(`setup: ${String(me)} has no group`);
  return best;
};

// ---------------------------------------------------------------------------
// Carve oracle (decision 5)
// ---------------------------------------------------------------------------

export type CarveCandidate = {
  readonly from: ArrowId;
  /** Arrows stepped onto, in order; the last is the landing. */
  readonly path: readonly ArrowId[];
  /** Arrows of other seats' territory in the claim estimate. */
  readonly enemyClaimed: number;
  /** Of those, arrows bordering a spawner (shares). */
  readonly enemySharesClaimed: number;
};

/** Claim estimate (Terms): the path's non-own arrows plus `enclosedBy(own ∪ path)`. */
export const claimEstimate = (
  state: GameState,
  me: PlayerId,
  path: readonly ArrowId[],
): readonly ArrowId[] => {
  const ground = new Set<ArrowId>();
  for (const [arrow, owner] of state.territory) if (owner === me) ground.add(arrow);
  for (const arrow of path) ground.add(arrow);
  const enclosed = rules.enclosedBy(ground, me);
  const claim = path.filter((a) => state.territory.get(a) !== me);
  const seen = new Set(claim.map(String));
  for (const arrow of enclosed) {
    if (seen.has(String(arrow))) continue;
    seen.add(String(arrow));
    claim.push(arrow);
  }
  return claim;
};

const scoreClaim = (
  state: GameState,
  me: PlayerId,
  claim: readonly ArrowId[],
): { readonly enemy: number; readonly shares: number } => {
  const shares = shareArrowKeys(state);
  let enemy = 0;
  let enemyShares = 0;
  for (const arrow of claim) {
    const owner = state.territory.get(arrow);
    if (owner === undefined || owner === me) continue;
    enemy += 1;
    if (shares.has(String(arrow))) enemyShares += 1;
  }
  return { enemy, shares: enemyShares };
};

export type LoopOptions = {
  /** Ignore the "never enter an own stack before the landing" rule. */
  readonly allowOwnStacks?: boolean;
  /** Keep loops whose claim holds no enemy arrow. */
  readonly includeNonClaiming?: boolean;
  /** Only loops from this start arrow. */
  readonly from?: ArrowId;
};

/**
 * Every loop decision 5 describes, ranked as decision 5 ranks them: enemy share
 * arrows claimed (desc), enemy arrows claimed (desc), path length (asc), then
 * the start and path arrow ids (asc).
 */
export const specCarveCandidates = (
  state: GameState,
  me: PlayerId,
  options: LoopOptions = {},
): readonly CarveCandidate[] => {
  const own = (a: ArrowId): boolean => state.territory.get(a) === me;
  const out: CarveCandidate[] = [];
  const starts = [...state.groups.entries()]
    .filter(([a, g]) => g.owner === me && own(a))
    .map(([a]) => a)
    .filter((a) => options.from === undefined || a === options.from)
    .toSorted(compareArrows);
  for (const start of starts) {
    const group = state.groups.get(start);
    if (group === undefined) continue;
    const allowance = group.speedOverride ?? speed(group.heads);
    const L = Math.min(allowance - group.spent, MAX_PLAN - 1);
    if (L < 2) continue;
    const path: ArrowId[] = [];
    const seen = new Set<string>([String(start)]);
    const visit = (cur: ArrowId, ownSteps: number, left: boolean): void => {
      if (path.length >= L) return;
      for (const x of outsOf(cur)) {
        if (seen.has(String(x))) continue;
        const holder = state.groups.get(x);
        const xOwn = own(x);
        if (xOwn && holder !== undefined && holder.owner !== me) continue;
        const ownStack = holder !== undefined && holder.owner === me;
        if (left && xOwn) {
          const full = [...path, x];
          const { enemy, shares } = scoreClaim(state, me, claimEstimate(state, me, full));
          if (enemy > 0 || options.includeNonClaiming === true) {
            out.push({ from: start, path: full, enemyClaimed: enemy, enemySharesClaimed: shares });
          }
          continue;
        }
        if (ownStack && options.allowOwnStacks !== true) continue;
        if (!left && xOwn && ownSteps >= 2) continue;
        path.push(x);
        seen.add(String(x));
        visit(x, xOwn ? ownSteps + 1 : ownSteps, left || !xOwn);
        path.pop();
        seen.delete(String(x));
      }
    };
    visit(start, 0, false);
  }
  const key = (c: CarveCandidate): string => [c.from, ...c.path].map(String).join('|');
  return out.toSorted(
    (a, b) =>
      b.enemySharesClaimed - a.enemySharesClaimed ||
      b.enemyClaimed - a.enemyClaimed ||
      a.path.length - b.path.length ||
      compareIds(key(a), key(b)),
  );
};

/** Decision 5's replay of one candidate; `undefined` when the spec drops it. */
export const specReplayCarve = (
  state: GameState,
  me: PlayerId,
  candidate: CarveCandidate,
): { readonly moves: readonly Move[]; readonly state: GameState } | undefined => {
  let at = state;
  let cur = candidate.from;
  const moves: Move[] = [];
  for (const x of candidate.path) {
    const heads = at.groups.get(cur)?.heads ?? 0;
    const legal = rules.legalMoves(at);
    const move = [heads, heads - 1]
      .filter((n) => n >= 1)
      .map((n) => step(cur, x, n))
      .find((m) => legal.some((l) => movesEqual(l, m)));
    if (move === undefined) return undefined;
    at = rules.apply(at, move);
    moves.push(move);
    if (at.groups.get(x)?.owner !== me) return undefined;
    cur = x;
    if (at.activePlayer !== me || at.winner !== undefined) break;
  }
  if (at.activePlayer === me && at.winner === undefined) {
    at = rules.apply(at, endTurn());
    moves.push(endTurn());
  }
  return { moves, state: at };
};

/** The start arrow and stepped-to arrows of a single-group plan, or `undefined`. */
export const pathOfPlan = (
  moves: readonly Move[],
): { readonly from: ArrowId; readonly path: readonly ArrowId[] } | undefined => {
  const steps = moves.filter((m): m is StepMove => m.kind === 'step');
  const first = steps[0];
  if (first === undefined) return undefined;
  let cur = first.from;
  const path: ArrowId[] = [];
  for (const s of steps) {
    if (s.from !== cur) return undefined;
    path.push(s.exit);
    cur = s.exit;
  }
  return { from: first.from, path };
};

/** Enemy share arrows a plan's single-group path claims, by the claim estimate. */
export const sharesClaimedByPath = (
  state: GameState,
  me: PlayerId,
  path: readonly ArrowId[],
): number => scoreClaim(state, me, claimEstimate(state, me, path)).shares;

/** Enemy arrows a plan's single-group path claims, by the claim estimate. */
export const enemyClaimedByPath = (
  state: GameState,
  me: PlayerId,
  path: readonly ArrowId[],
): number => scoreClaim(state, me, claimEstimate(state, me, path)).enemy;

// ---------------------------------------------------------------------------
// Reply oracle (decision 2)
// ---------------------------------------------------------------------------

/** The same search P55 hands `foldEnemyReply` (botSearch's `enemyReplySearch`). */
const replySearch: ReplySearchFn = (g, r, state, me, budget) =>
  chooseTurnBeamWithBudget(g, r, state, me, {
    beam: budget?.beam ?? REPLY_BEAM,
    branch: budget?.branch ?? REPLY_BRANCH,
    maxPlan: budget?.maxPlan ?? REPLY_MAX_PLAN,
    maxApplies: budget?.maxApplies ?? REPLY_MAX_APPLIES,
    withReplies: false,
  });

export type ReplyReading = {
  readonly unreplied: number;
  readonly afterReply: GameState;
  readonly afterPass: GameState;
  /** evaluate(after reply) − evaluate(after the same chair passes). */
  readonly damage: number;
};

/** One enemy's reply and pass from `hypothesiseChair(terminal, enemy)`, scored for `me`. */
export const readReply = (terminal: GameState, me: PlayerId, enemy: PlayerId): ReplyReading => {
  const score = (s: GameState): number => evaluate(geometry, s, me, rules);
  const { after } = foldEnemyReply(geometry, rules, terminal, enemy, replySearch);
  const afterPass = rules.apply(hypothesiseChair(terminal, enemy), endTurn());
  return {
    unreplied: score(terminal),
    afterReply: after,
    afterPass,
    damage: score(after) - score(afterPass),
  };
};

// ---------------------------------------------------------------------------
// Constructed boards
// ---------------------------------------------------------------------------

/**
 * Board for the dominance gate (3 seats): A, B and C hold exactly `a`, `b`, `c`
 * heads (a seat with 0 holds no group); every seat keeps its opening territory.
 */
export const dominanceBoard = (
  a: number,
  b: number,
  c: number,
): { readonly state: GameState; readonly A: PlayerId } => {
  const opening = makeMatch(THREE_MATCH);
  const [A, B, C] = opening.players;
  if (A === undefined || B === undefined || C === undefined) throw new Error('setup: need 3 seats');
  const want = new Map<PlayerId, number>([
    [A, a],
    [B, b],
    [C, c],
  ]);
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of opening.groups) {
    const heads = want.get(group.owner) ?? 0;
    if (heads > 0) groups.set(arrow, { ...group, heads });
  }
  const state: GameState = { ...opening, groups };
  for (const [seat, heads] of want) {
    if (headsOf(state, seat) !== heads) throw new Error(`setup: ${String(seat)} should hold ${String(heads)}`);
  }
  return { state, A };
};

/** Forward grain ball: every arrow within `k` steps of `start`, with its distance. */
const forwardBall = (start: ArrowId, k: number): ReadonlyMap<string, { arrow: ArrowId; d: number }> => {
  const ball = new Map<string, { arrow: ArrowId; d: number }>([[String(start), { arrow: start, d: 0 }]]);
  let frontier: ArrowId[] = [start];
  for (let d = 1; d <= k; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const x of outsOf(arrow)) {
        if (ball.has(String(x))) continue;
        ball.set(String(x), { arrow: x, d });
        next.push(x);
      }
    }
    frontier = next;
  }
  return ball;
};

/**
 * The B arrow of the interior staging board. Chosen so today's search walks S1
 * away from it (4 → 8): a staging walk is the only reason S1 gets closer.
 */
export const STAGING_B_ARROW = 'tiling:a:-1,8,0';

export type StagingBoard = {
  readonly state: GameState;
  readonly A: PlayerId;
  readonly B: PlayerId;
  /** A's walker stack. */
  readonly s1: ArrowId;
  readonly entries: readonly ArrowId[];
};

/**
 * Interior staging board (2 seats). A's only territory is every arrow within 4
 * grain steps of S1 (6 heads, speed 3), so nothing A does this turn leaves its
 * territory: every plan is quiet and no loop exists. B keeps its far home
 * (3 heads) and, when `withEntry`, also owns one arrow at grain distance 5 from
 * S1 — making the arrows before it A's entry arrows, 4 steps from S1.
 */
export const stagingBoard = (
  options: { readonly withEntry: boolean; readonly bArrow?: string } = { withEntry: true },
): StagingBoard => {
  const opening = makeMatch(SMALL_MATCH);
  const { A, B } = seatsOf(opening);
  const s1 = [...opening.groups.entries()].find(([, g]) => g.owner === A)?.[0];
  if (s1 === undefined) throw new Error('setup: A has no opening stack');
  const inner = forwardBall(s1, 4);
  const territory = new Map<ArrowId, PlayerId>();
  for (const [arrow, owner] of opening.territory) if (owner === B) territory.set(arrow, owner);
  for (const { arrow } of inner.values()) territory.set(arrow, A);
  if (options.withEntry) {
    const wanted = options.bArrow ?? STAGING_B_ARROW;
    const x = [...forwardBall(s1, 5).values()].find((e) => String(e.arrow) === wanted && e.d === 5);
    if (x === undefined) throw new Error(`setup: ${wanted} is not 5 steps from S1`);
    territory.set(x.arrow, B);
  }
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of opening.groups) if (group.owner === B) groups.set(arrow, group);
  groups.set(s1, { owner: A, heads: 6, spent: 0 });
  const state: GameState = { ...opening, territory, groups, trails: new Map(), activePlayer: A };
  return { state, A, B, s1, entries: entryArrows(state, A) };
};

/**
 * Arrows every shortest own-ground path from `start` to an entry arrow passes
 * at step `k` (singleton layer ⇒ forced), for k = 1…dist−1.
 */
export const forcedShortestPathArrows = (
  state: GameState,
  me: PlayerId,
  start: ArrowId,
): readonly { readonly k: number; readonly arrow: ArrowId }[] => {
  const dist = ownGroundDistances(state, me, entryArrows(state, me), STAGING_DIST_CAP);
  const total = dist.get(String(start));
  if (total === undefined) return [];
  const out: { k: number; arrow: ArrowId }[] = [];
  let layer: ArrowId[] = [start];
  for (let k = 1; k < total; k += 1) {
    const next = new Map<string, ArrowId>();
    for (const arrow of layer) {
      for (const x of outsOf(arrow)) {
        if (state.territory.get(x) !== me) continue;
        if (dist.get(String(x)) === total - k) next.set(String(x), x);
      }
    }
    layer = [...next.values()];
    const only = layer[0];
    if (layer.length === 1 && only !== undefined) out.push({ k, arrow: only });
  }
  return out;
};

/** Arrows exactly 5 grain steps from the staging board's S1, sorted — where B's arrow may go. */
const stagingBArrowCandidates = (): readonly string[] => {
  const opening = makeMatch(SMALL_MATCH);
  const { A } = seatsOf(opening);
  const s1 = [...opening.groups.entries()].find(([, g]) => g.owner === A)?.[0];
  if (s1 === undefined) throw new Error('setup: A has no opening stack');
  return [...forwardBall(s1, 5).values()]
    .filter((e) => e.d === 5 && opening.territory.get(e.arrow) === undefined)
    .map((e) => String(e.arrow))
    .toSorted(compareIds);
};

/**
 * Staging board with a 1-head A stack S2 on an arrow that **every** shortest
 * own-ground path from S1 to an entry arrow passes, within S1's speed — so the
 * walk's merge point does not depend on how a search breaks ties between paths.
 */
export const stagingMergeBoard = (): StagingBoard & { readonly s2: ArrowId; readonly k: number } => {
  for (const bArrow of stagingBArrowCandidates()) {
    const board = stagingBoard({ withEntry: true, bArrow });
    const forced = forcedShortestPathArrows(board.state, board.A, board.s1).find(
      (f) => f.k < speed(6) && !board.state.groups.has(f.arrow),
    );
    if (forced === undefined) continue;
    const groups = new Map(board.state.groups);
    groups.set(forced.arrow, { owner: board.A, heads: 1, spent: 0 });
    return { ...board, state: { ...board.state, groups }, s2: forced.arrow, k: forced.k };
  }
  throw new Error('setup: no staging board with a forced arrow within S1 speed');
};

/** Opening with A's stack raised to 8 heads and B's cut to 1: loops exist, none reach B. */
export const unownedLoopsOnlyBoard = (): { readonly state: GameState; readonly A: PlayerId } => {
  const opening = makeMatch(SMALL_MATCH);
  const { A } = seatsOf(opening);
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of opening.groups) {
    groups.set(arrow, { ...group, heads: group.owner === A ? 8 : 1 });
  }
  return { state: { ...opening, groups, activePlayer: A }, A };
};

export type CutReplyBoard = {
  /** A to move; P = `[endTurn]` leaves A's trail as it stands. */
  readonly state: GameState;
  /** After P: B's chair. */
  readonly terminal: GameState;
  readonly A: PlayerId;
  readonly B: PlayerId;
};

/**
 * A 2-head stack at the tip of an open trail walked out of A's opening home,
 * and B's 2-head stack one step before a middle arrow of that trail. Checked:
 * B's P55 reply from its hypothesised chair cuts A's trail and costs A evaluate
 * against B passing.
 */
export const cutReplyBoard = (): CutReplyBoard => {
  const opening = makeMatch(SMALL_MATCH);
  const { A, B } = seatsOf(opening);
  const homes = [...opening.territory.entries()]
    .filter(([, owner]) => owner === A)
    .map(([arrow]) => arrow)
    .toSorted(compareArrows);
  const free = (a: ArrowId, used: readonly ArrowId[]): boolean =>
    opening.territory.get(a) === undefined && !opening.groups.has(a) && !used.includes(a);
  for (const home of homes) {
    for (const t1 of outsOf(home).filter((a) => free(a, [])).toSorted(compareArrows)) {
      const trail: ArrowId[] = [t1];
      while (trail.length < 5) {
        const last = trail[trail.length - 1];
        const next = last === undefined ? undefined : outsOf(last).find((a) => free(a, trail));
        if (next === undefined) break;
        trail.push(next);
      }
      if (trail.length < 5) continue;
      const tip = trail[trail.length - 1];
      if (tip === undefined) continue;
      for (const mid of trail.slice(1, -1)) {
        for (const b of [...geometry.inArrows(geometry.origin(mid))].toSorted(compareArrows)) {
          if (!free(b, trail)) continue;
          const groups = new Map<ArrowId, Group>();
          groups.set(tip, { owner: A, heads: 2, spent: 0 });
          groups.set(b, { owner: B, heads: 2, spent: 0 });
          const state: GameState = {
            ...opening,
            groups,
            trails: new Map([[A, new Set(trail)]]),
            activePlayer: A,
          };
          const terminal = rules.apply(state, endTurn());
          const reading = readReply(terminal, A, B);
          if (trailSizeOf(reading.afterReply, A) >= trailSizeOf(terminal, A)) continue;
          if (reading.damage >= 0) continue;
          return { state, terminal, A, B };
        }
      }
    }
  }
  throw new Error('setup: no board where B\'s reply cuts A\'s trail');
};

/** Opening with A's stack at 5 heads: three legal exits, five counts each. */
export const fiveHeadStackBoard = (): {
  readonly state: GameState;
  readonly A: PlayerId;
  readonly stack: ArrowId;
} => {
  const opening = makeMatch(SMALL_MATCH);
  const { A } = seatsOf(opening);
  const stack = [...opening.groups.entries()].find(([, g]) => g.owner === A)?.[0];
  if (stack === undefined) throw new Error('setup: A has no opening stack');
  const groups = new Map(opening.groups);
  groups.set(stack, { owner: A, heads: 5, spent: 0 });
  return { state: { ...opening, groups, activePlayer: A }, A, stack };
};

// ---------------------------------------------------------------------------
// Fixture-derived carve boards
// ---------------------------------------------------------------------------

const arrowOn = (state: GameState, id: string): ArrowId => {
  for (const arrow of state.territory.keys()) if (String(arrow) === id) return arrow;
  for (const arrow of state.groups.keys()) if (String(arrow) === id) return arrow;
  throw new Error(`setup: ${id} is neither territory nor occupied`);
};

/**
 * A's turn start (round ~155) with 4-step loops through two of B's share
 * arrows, which today's starved search does not find (it ends the turn).
 */
export const CARVE_MOVE = 806;

/** A's turn start whose seven claiming loops exceed CARVE_TOP. */
export const MANY_CARVES_MOVE = 774;

/** A's turn start where a 2-share carve exists and A has a stack a staging walk could move. */
export const GROUND_TAKING_MOVE = 783;

/** A's turn start whose only claiming loop (from S1) runs over an empty B arrow. */
const ATTACK_MOVE = 708;
const ATTACK_ARROW = 'tiling:a:2,-2,0';

/**
 * `mirror-s1` move 708 with one B head placed on the B-territory arrow the only
 * claiming loop on the board crosses. Checked: every claiming loop passes it,
 * and decision 5's replay of the best one survives the fight.
 */
export const attackBoard = (): {
  readonly state: GameState;
  readonly A: PlayerId;
  readonly B: PlayerId;
  readonly target: ArrowId;
} => {
  const base = mirrorAt(ATTACK_MOVE);
  const { A, B } = seatsOf(base);
  const target = arrowOn(base, ATTACK_ARROW);
  if (base.territory.get(target) !== B || base.groups.has(target)) {
    throw new Error('setup: attack arrow should be empty B territory');
  }
  const groups = new Map(base.groups);
  groups.set(target, { owner: B, heads: 1, spent: 0 });
  const state: GameState = { ...base, groups };
  const loops = specCarveCandidates(state, A);
  const best = loops[0];
  if (best === undefined || !loops.every((c) => c.path.includes(target))) {
    throw new Error('setup: every claiming loop should cross the B head');
  }
  if (specReplayCarve(state, A, best) === undefined) throw new Error('setup: attack carve dropped');
  return { state, A, B, target };
};

/** Own-territory arrow every claiming loop of S1 passes at round 160. */
const BLOCK_ARROW = 'tiling:a:2,-1,2';
export const BLOCK_S1 = 'tiling:a:2,0,2';

/**
 * `mirror-s1` move 820 with a 1-head A stack on the own arrow every claiming
 * loop of S1 passes before it lands. Checked with the own-stack rule switched
 * off, so the block is what removes those loops.
 */
export const ownStackBlockBoard = (): {
  readonly state: GameState;
  readonly A: PlayerId;
  readonly s1: ArrowId;
  readonly block: ArrowId;
} => {
  const base = mirrorAt(ROUND_160_MOVE);
  const { A } = seatsOf(base);
  const block = arrowOn(base, BLOCK_ARROW);
  const s1 = arrowOn(base, BLOCK_S1);
  if (base.territory.get(block) !== A || base.groups.has(block)) {
    throw new Error('setup: block arrow should be empty A territory');
  }
  const groups = new Map(base.groups);
  groups.set(block, { owner: A, heads: 1, spent: 0 });
  const state: GameState = { ...base, groups };
  const loops = specCarveCandidates(state, A, { allowOwnStacks: true, from: s1 });
  if (loops.length === 0) throw new Error('setup: S1 should have claiming loops');
  if (!loops.every((c) => c.path.slice(0, -1).includes(block))) {
    throw new Error('setup: every claiming loop of S1 should pass the block');
  }
  return { state, A, s1, block };
};

/** `state` with `seat`'s largest group grown until `seat` holds `heads` heads. */
export const withSeatHeads = (state: GameState, seat: PlayerId, heads: number): GameState => {
  const at = largestGroupArrow(state, seat);
  const group = state.groups.get(at);
  if (group === undefined) throw new Error('setup: no group');
  const extra = heads - headsOf(state, seat);
  if (extra < 0) throw new Error('setup: withSeatHeads only grows');
  const groups = new Map(state.groups);
  groups.set(at, { ...group, heads: group.heads + extra });
  return { ...state, groups };
};

/** An own group that decision 6 could walk (heads ≥ 4, spent 0, own ground, off entry, path ≤ cap). */
export const specHasWalker = (state: GameState, me: PlayerId): boolean => {
  const entries = entryArrows(state, me);
  if (entries.length === 0) return false;
  const entryKeys = new Set(entries.map(String));
  const dist = ownGroundDistances(state, me, entries, STAGING_DIST_CAP);
  for (const [arrow, group] of state.groups) {
    if (group.owner !== me || group.heads < 4 || group.spent !== 0) continue;
    if (state.territory.get(arrow) !== me || entryKeys.has(String(arrow))) continue;
    if (dist.has(String(arrow))) return true;
  }
  return false;
};
