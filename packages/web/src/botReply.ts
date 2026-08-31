/**
 * Shared opponent-reply helpers (P55). Adapter only — no game rules.
 *
 * Pure: no clocks, no RNG, no I/O. Keeps `botSearch` ↔ `botClose` acyclic
 * (`findings` imports `botClose`; `botSearch` imports `findings`).
 */

import { endTurn } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
} from '@conquarrow/contracts';
import { grainDistance } from './botEvaluate';

export const DEFAULT_REPLY_DIST_CAP = 12;

export const REPLY_BEAM = 3;
export const REPLY_BRANCH = 3;
export const REPLY_MAX_PLAN = 4;
export const REPLY_MAX_APPLIES = 40;
export const REPLY_TURN_APPLIES = 400;

export interface ReplyTurnBudget {
  readonly beam?: number;
  readonly branch?: number;
  readonly maxPlan?: number;
  readonly maxApplies?: number;
  readonly withReplies?: boolean;
}

export type ReplySearchFn = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  budget?: ReplyTurnBudget,
) => readonly Move[];

let boundReplySearch: ReplySearchFn | undefined;
let beamSearchDepth = 0;

/** Called once from `botSearch` after `chooseTurnBeamWithBudget` exists. */
export const bindReplySearch = (search: ReplySearchFn): void => {
  boundReplySearch = search;
};

export const enterBeamSearch = (): void => {
  beamSearchDepth += 1;
};

export const leaveBeamSearch = (): void => {
  beamSearchDepth = Math.max(0, beamSearchDepth - 1);
};

export const inBeamSearch = (): boolean => beamSearchDepth > 0;

const replySearch = (): ReplySearchFn => {
  if (boundReplySearch === undefined) {
    throw new Error('botReply: reply search not bound');
  }
  return boundReplySearch;
};

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const hypothesiseChair = (state: GameState, seat: PlayerId): GameState => ({
  ...state,
  activePlayer: seat,
  winner: undefined,
});

export const trailSize = (state: GameState, player: PlayerId): number =>
  state.trails.get(player)?.size ?? 0;

const mineArrows = (state: GameState, me: PlayerId): ArrowId[] => {
  const out: ArrowId[] = [];
  const seen = new Set<string>();
  const add = (arrow: ArrowId): void => {
    const key = String(arrow);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(arrow);
  };
  for (const [arrow, group] of state.groups) {
    if (group.owner === me) add(arrow);
  }
  for (const [arrow, owner] of state.territory) {
    if (owner === me) add(arrow);
  }
  const trail = state.trails.get(me);
  if (trail !== undefined) {
    for (const arrow of trail) add(arrow);
  }
  return out.toSorted((a, b) => compareIds(String(a), String(b)));
};

const grainReachToMine = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  from: ArrowId,
  cap: number,
): number => {
  let best = cap + 1;
  for (const goal of mineArrows(state, me)) {
    const d = grainDistance(geometry, from, goal, cap);
    if (d < best) best = d;
  }
  return best;
};

/** Enemy seats with a group grain-reachable to anything of `me`'s, ascending PlayerId. */
export const reachableEnemySeats = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  distCap: number,
): PlayerId[] => {
  if (state.winner !== undefined) return [];
  const owners = new Set<PlayerId>();
  for (const [, group] of state.groups) {
    if (group.owner !== me) owners.add(group.owner);
  }
  const reachable: PlayerId[] = [];
  for (const enemy of [...owners].toSorted((a, b) => compareIds(String(a), String(b)))) {
    let ok = false;
    for (const [arrow, group] of state.groups) {
      if (group.owner !== enemy) continue;
      if (grainReachToMine(geometry, state, me, arrow, distCap) <= distCap) {
        ok = true;
        break;
      }
    }
    if (ok) reachable.push(enemy);
  }
  return reachable;
};

export const foldPlan = (rules: RulesPort, state: GameState, moves: readonly Move[]): GameState => {
  let at = state;
  for (const move of moves) {
    at = rules.apply(at, move);
  }
  return at;
};

const replyBudget = (): ReplyTurnBudget => ({
  beam: REPLY_BEAM,
  branch: REPLY_BRANCH,
  maxPlan: REPLY_MAX_PLAN,
  maxApplies: REPLY_MAX_APPLIES,
  withReplies: false,
});

const countingRules = (
  inner: RulesPort,
  onApply: () => void,
): RulesPort => ({
  ...inner,
  apply(state, move) {
    onApply();
    return inner.apply(state, move);
  },
});

export type ReplyFold = {
  readonly after: GameState;
  readonly applies: number;
};

/** One enemy's best reply from a hypothetical chair. */
export const foldEnemyReply = (
  geometry: GeometryPort,
  rules: RulesPort,
  terminal: GameState,
  enemy: PlayerId,
  search: ReplySearchFn,
): ReplyFold => {
  let applies = 0;
  const counted = countingRules(rules, () => {
    applies += 1;
  });
  const chair = hypothesiseChair(terminal, enemy);
  const plan = search(geometry, counted, chair, enemy, replyBudget());
  const after = foldPlan(rules, chair, plan.length > 0 ? plan : [endTurn()]);
  return { after, applies };
};

export type WorstReply = {
  readonly enemy: PlayerId | undefined;
  readonly after: GameState;
  readonly botScore: number;
  readonly appliesUsed: number;
};

/** Min bot-evaluate across reachable enemy replies; respects turn apply cap. */
export const worstReachableReply = (
  geometry: GeometryPort,
  rules: RulesPort,
  terminal: GameState,
  me: PlayerId,
  distCap: number,
  turnAppliesLeft: number,
  search: ReplySearchFn,
  score: (state: GameState) => number,
): WorstReply => {
  const unreplied = score(terminal);
  if (terminal.winner !== undefined || turnAppliesLeft <= 0) {
    return { enemy: undefined, after: terminal, botScore: unreplied, appliesUsed: 0 };
  }
  const enemies = reachableEnemySeats(geometry, terminal, me, distCap);
  if (enemies.length === 0) {
    return { enemy: undefined, after: terminal, botScore: unreplied, appliesUsed: 0 };
  }
  let best: number | undefined;
  let worstEnemy: PlayerId | undefined;
  let worstAfter = terminal;
  let left = turnAppliesLeft;
  let appliesUsed = 0;
  for (const enemy of enemies) {
    if (left <= 0) break;
    const { after, applies } = foldEnemyReply(geometry, rules, terminal, enemy, search);
    left -= applies;
    appliesUsed += applies;
    const botScore = score(after);
    if (
      best === undefined ||
      botScore < best ||
      (botScore === best &&
        (worstEnemy === undefined || compareIds(String(enemy), String(worstEnemy)) < 0))
    ) {
      best = botScore;
      worstEnemy = enemy;
      worstAfter = after;
    }
  }
  return {
    enemy: worstEnemy,
    after: worstAfter,
    botScore: best ?? unreplied,
    appliesUsed,
  };
};

/** Trail arrows lost under the worst (min bot-evaluate) reachable reply. */
export const exposureFromWorstReply = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  distCap: number,
  search: ReplySearchFn,
  score: (state: GameState) => number,
): number => {
  const before = trailSize(state, me);
  if (before === 0) return 0;
  const enemies = reachableEnemySeats(geometry, state, me, distCap);
  if (enemies.length === 0) return 0;
  let left = REPLY_TURN_APPLIES;
  let worstLost = 0;
  let worstScore = Number.POSITIVE_INFINITY;
  let worstEnemy: PlayerId | undefined;
  for (const enemy of enemies) {
    if (left <= 0) break;
    const { after, applies } = foldEnemyReply(geometry, rules, state, enemy, search);
    left -= applies;
    const botScore = score(after);
    const lost = Math.max(0, before - trailSize(after, me));
    if (
      botScore < worstScore ||
      (botScore === worstScore &&
        (worstEnemy === undefined || compareIds(String(enemy), String(worstEnemy)) < 0))
    ) {
      worstScore = botScore;
      worstEnemy = enemy;
      worstLost = lost;
    }
  }
  return worstLost;
};

export const exposureForBot = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  distCap: number | undefined,
  score: (state: GameState) => number,
): number => {
  if (beamSearchDepth >= 1) return 0;
  return exposureFromWorstReply(
    geometry,
    rules,
    state,
    me,
    distCap ?? DEFAULT_REPLY_DIST_CAP,
    replySearch(),
    score,
  );
};
