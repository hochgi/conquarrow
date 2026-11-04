/**
 * Turn-plan search seam (P53 / P55 / P56). Adapter only — no game rule.
 *
 * `chooseTurnGreedy` is frozen greedy-v1 (today's `chooseMove` loop).
 * `chooseTurnBeam` is beam-v1 with optional one-ply opponent replies (P55)
 * and a return-time home-expedition gate (P56). The live seat's return seam
 * refuses a pass while a step is legal (P84).
 */

import { endTurn, speed } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
  VertexId,
} from '@conquarrow/contracts';
import { ARROW_VALUE_A, campaignTarget } from './botClose';
import { evaluate, grainDistanceFromAny, MOBILITY_SCALE } from './botEvaluate';
import { carvePlans, isQuietPlan, stagingWalk } from './botFinish';
import {
  denyExitOf,
  isSidewaysDirt,
  isStagingClose,
  isThreatenedKite,
  kiteLength,
  missionsOf,
  onMissionStep,
  originTerritoryOf,
  remainingPath,
  servesMission,
  type MissionContext,
  type OriginFinding,
} from './botMission';
import { neverIdle } from './botNeverIdle';
import { interceptOf, sortieCredit } from './botTempo';
import {
  bindReplySearch,
  DEFAULT_REPLY_DIST_CAP,
  enterBeamSearch,
  hypothesiseChair,
  inBeamSearch,
  leaveBeamSearch,
  REPLY_BEAM,
  REPLY_BRANCH,
  REPLY_MAX_APPLIES,
  REPLY_MAX_PLAN,
  REPLY_TURN_APPLIES,
  worstReachableReply,
  worstReplyDamage,
  type ReplyProbe,
  type ReplySearchFn,
} from './botReply';
import { collectFindings, DEFAULT_FINDINGS_CAPS } from './findings';
import { playLayout } from './playLayout';
import { chooseMove, isCutMove } from './opponent';

export type ChooseTurn = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
) => readonly Move[];

/** Optional budget for tests (spec “On exhaustion” / BSSN 8). */
export interface ChooseTurnBudget {
  readonly beam?: number;
  readonly branch?: number;
  readonly maxPlan?: number;
  readonly maxApplies?: number;
  /** Default false. Live `chooseTurnBeam` passes true (P55). */
  readonly withReplies?: boolean;
}

export const BEAM = 8;
export const BRANCH = 6;
export const MAX_PLAN = 8;
export const MAX_APPLIES = 2000;
/** Prefer a stepped plan over `[endTurn]` unless passing is better by more than this. */
export const IDLE_SLACK = MOBILITY_SCALE;
/** Prefer a leave over a home-pinwheel mill unless the mill is better by more than this. */
export const SORTIE_SLACK = MOBILITY_SCALE;
export {
  REPLY_BEAM,
  REPLY_BRANCH,
  REPLY_MAX_PLAN,
  REPLY_MAX_APPLIES,
  REPLY_TURN_APPLIES,
  MOBILITY_SCALE,
  evaluate,
};

const MAX_MOVES_PER_TURN = 64;
const UNRANKED = Number.POSITIVE_INFINITY;
const CAMPAIGN_DIST_CAP = DEFAULT_FINDINGS_CAPS.distCap;

export const moveKey = (move: Move): string => {
  switch (move.kind) {
    case 'step':
      return `step:${String(move.from)}>${String(move.exit)}:${String(move.count)}`;
    case 'endTurn':
      return 'endTurn';
  }
};

export const planKey = (moves: readonly Move[]): string => moves.map(moveKey).join('|');

const enemyReplySearch: ReplySearchFn = (geometry, rules, state, me, budget) =>
  chooseTurnBeamWithBudget(geometry, rules, state, me, {
    beam: budget?.beam ?? REPLY_BEAM,
    branch: budget?.branch ?? REPLY_BRANCH,
    maxPlan: budget?.maxPlan ?? REPLY_MAX_PLAN,
    maxApplies: budget?.maxApplies ?? REPLY_MAX_APPLIES,
    withReplies: false,
  });

/** Min bot-evaluate after reachable replies (P55). */
export const replyScore = (
  geometry: GeometryPort,
  rules: RulesPort,
  terminal: GameState,
  me: PlayerId,
  budget?: { readonly turnAppliesLeft: number },
): number =>
  worstReachableReply(
    geometry,
    rules,
    terminal,
    me,
    DEFAULT_REPLY_DIST_CAP,
    budget?.turnAppliesLeft ?? REPLY_TURN_APPLIES,
    enemyReplySearch,
    (state) => evaluate(geometry, state, me, rules),
  ).botScore;

const replyProbe = (geometry: GeometryPort, rules: RulesPort, me: PlayerId): ReplyProbe => ({
  geometry,
  rules,
  me,
  search: enemyReplySearch,
  score: (state) => evaluate(geometry, state, me, rules),
});

/**
 * P81 decision 2 — a finalist's score: `evaluate(terminal)` plus
 * `min(0, min over reachable enemies e of [evaluate(after e's reply) −
 * evaluate(after e passes)])`. The reply and the pass both start from
 * `hypothesiseChair(terminal, e)`, so the round boundary's production cancels
 * and a reply can only lower the score, by the damage it does.
 */
export const finalistReplyScore = (
  geometry: GeometryPort,
  rules: RulesPort,
  terminal: GameState,
  me: PlayerId,
  budget?: { readonly turnAppliesLeft: number },
): number =>
  evaluate(geometry, terminal, me, rules) +
  worstReplyDamage(
    replyProbe(geometry, rules, me),
    terminal,
    budget?.turnAppliesLeft ?? REPLY_TURN_APPLIES,
  ).damage;

/** Two `count=1` steps in the same plan that share `from` and `exit`. */
export const isShuttle = (moves: readonly Move[]): boolean => {
  const ones: StepMove[] = [];
  for (const move of moves) {
    if (move.kind === 'step' && move.count === 1) ones.push(move);
  }
  for (let i = 0; i < ones.length; i += 1) {
    const a = ones[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < ones.length; j += 1) {
      const b = ones[j];
      if (b === undefined) continue;
      if (a.from === b.from && a.exit === b.exit) return true;
    }
  }
  return false;
};

export type CompletePlan = {
  readonly moves: readonly Move[];
  readonly state: GameState;
  readonly replyScore?: number;
};

type Incomplete = CompletePlan;

type Search = {
  applies: number;
  best: CompletePlan | undefined;
  bestStepped: CompletePlan | undefined;
  bestExpedition: CompletePlan | undefined;
  bestCampaign: CompletePlan | undefined;
  readonly origin: GameState;
  /** Empty trail, groups on own territory, no threatened departing exit. */
  readonly trackSortie: boolean;
  readonly campaign: VertexId | undefined;
  readonly originExposure: number;
  readonly geometry: GeometryPort;
  rules: RulesPort;
  readonly inner: RulesPort;
  readonly me: PlayerId;
  readonly maxApplies: number;
  readonly withReplies: boolean;
  replyTurnAppliesLeft: number;
  readonly missionCtx: MissionContext | undefined;
  /** P85: sortie credit by terminal state, for this call only. */
  readonly creditMemo: Map<GameState, number>;
  completes: CompletePlan[];
};

const APPLY_CAP = 'bot-search:apply-cap';

const capRules = (inner: RulesPort, search: Search): RulesPort => ({
  ...inner,
  apply(state, move) {
    if (search.applies >= search.maxApplies) {
      throw new Error(APPLY_CAP);
    }
    const next = inner.apply(state, move);
    search.applies += 1;
    return next;
  },
});

const completeScore = (
  geometry: GeometryPort,
  rules: RulesPort,
  me: PlayerId,
  complete: CompletePlan,
): number => {
  if (complete.replyScore !== undefined) return complete.replyScore;
  if (!inBeamSearch()) return replyScore(geometry, rules, complete.state, me);
  return evaluate(geometry, complete.state, me, rules);
};

export const pickBetterComplete = (
  geometry: GeometryPort,
  me: PlayerId,
  rules: RulesPort | undefined,
  a: CompletePlan,
  b: CompletePlan,
): CompletePlan => {
  if (rules === undefined) {
    const ea = evaluate(geometry, a.state, me, rules);
    const eb = evaluate(geometry, b.state, me, rules);
    if (ea > eb) return a;
    if (eb > ea) return b;
  } else {
    const ea = completeScore(geometry, rules, me, a);
    const eb = completeScore(geometry, rules, me, b);
    if (ea > eb) return a;
    if (eb > ea) return b;
  }
  const ka = planKey(a.moves);
  const kb = planKey(b.moves);
  return ka <= kb ? a : b;
};

/**
 * P85 decision 3a: sortie credit joins `evaluate` only while this search is
 * the live seat. Nested searches (`withReplies` false) score as before.
 * Memoised on the search: terminal states are immutable, and the four score
 * sites reread them. Nothing survives the call.
 */
const liveCredit = (search: Search, state: GameState): number => {
  if (!search.withReplies) return 0;
  const hit = search.creditMemo.get(state);
  if (hit !== undefined) return hit;
  const credit = sortieCredit(search.geometry, state, search.me);
  search.creditMemo.set(state, credit);
  return credit;
};

/** Decision 2 for the live search: {@link finalistReplyScore} on the search's reply budget. */
const scoreWithReplies = (search: Search, child: CompletePlan): CompletePlan => {
  const terminal = child.state;
  const unreplied = evaluate(search.geometry, terminal, search.me, search.inner) + liveCredit(search, terminal);
  if (!search.withReplies || terminal.winner !== undefined) {
    return { ...child, replyScore: unreplied };
  }
  const { damage, appliesUsed } = worstReplyDamage(
    replyProbe(search.geometry, search.inner, search.me),
    terminal,
    search.replyTurnAppliesLeft,
  );
  search.replyTurnAppliesLeft = Math.max(0, search.replyTurnAppliesLeft - appliesUsed);
  return { ...child, replyScore: unreplied + damage };
};

const planHasStep = (moves: readonly Move[]): boolean =>
  moves.some((m) => m.kind === 'step');

const isIdlePlan = (moves: readonly Move[]): boolean =>
  moves.length === 1 && moves[0]?.kind === 'endTurn';

const ownedTerritory = (state: GameState, me: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner === me) n += 1;
  return n;
};

const trailSizeOf = (state: GameState, me: PlayerId): number =>
  state.trails.get(me)?.size ?? 0;

const sharesOf = (
  geometry: GeometryPort,
  state: GameState,
  player: PlayerId,
): number => {
  let n = 0;
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) {
      if (state.territory.get(arrow) === player) n += 1;
    }
  }
  return n;
};

const someOwnGroupOffHome = (state: GameState, me: PlayerId): boolean => {
  for (const [arrow, group] of state.groups) {
    if (group.owner === me && state.territory.get(arrow) !== me) return true;
  }
  return false;
};

const stillAtHome = (state: GameState, me: PlayerId): boolean =>
  trailSizeOf(state, me) === 0 && !someOwnGroupOffHome(state, me);

/** Share gained, a group off home, or trail grew and is still down. */
const isExpeditionTerminal = (
  geometry: GeometryPort,
  origin: GameState,
  terminal: GameState,
  me: PlayerId,
): boolean => {
  if (sharesOf(geometry, terminal, me) > sharesOf(geometry, origin, me)) return true;
  if (someOwnGroupOffHome(terminal, me)) return true;
  const originTrail = trailSizeOf(origin, me);
  const terminalTrail = trailSizeOf(terminal, me);
  return terminalTrail > originTrail && terminalTrail > 0;
};

const homeboundScore = (search: Search, complete: CompletePlan): number =>
  completeScore(search.geometry, search.inner, search.me, complete) -
  ARROW_VALUE_A * ownedTerritory(complete.state, search.me);

const threatenedExits = (
  origin: GameState,
  me: PlayerId,
  rules: RulesPort,
): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const enemy of origin.players) {
    if (enemy === me) continue;
    for (const move of rules.legalMoves(hypothesiseChair(origin, enemy))) {
      if (move.kind === 'step') out.add(String(move.exit));
    }
  }
  return out;
};

const departingExitIsThreatened = (
  origin: GameState,
  me: PlayerId,
  rules: RulesPort,
): boolean => {
  const threatened = threatenedExits(origin, me, rules);
  for (const move of rules.legalMoves(origin)) {
    if (move.kind !== 'step') continue;
    if (origin.territory.get(move.exit) === me) continue;
    if (threatened.has(String(move.exit))) return true;
  }
  return false;
};

const nearestOwnGroupDist = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  vertex: VertexId,
): number => {
  const arrows: ArrowId[] = [];
  for (const [arrow, group] of state.groups) if (group.owner === me) arrows.push(arrow);
  return grainDistanceFromAny(
    geometry,
    arrows,
    [...geometry.borderArrows(vertex)],
    CAMPAIGN_DIST_CAP,
  );
};

const closerToCampaign = (search: Search, terminal: GameState): boolean => {
  const vertex = search.campaign;
  if (vertex === undefined) return false;
  const originDist = nearestOwnGroupDist(
    search.geometry,
    search.origin,
    search.me,
    vertex,
  );
  return nearestOwnGroupDist(search.geometry, terminal, search.me, vertex) < originDist;
};

const isCampaignAdvancing = (search: Search, terminal: GameState): boolean => {
  const originShares = sharesOf(search.geometry, search.origin, search.me);
  if (sharesOf(search.geometry, terminal, search.me) > originShares) return true;
  return closerToCampaign(search, terminal);
};

const isQuietDirtComplete = (search: Search, complete: CompletePlan): boolean => {
  if (search.originExposure !== 0) return false;
  const originShares = sharesOf(search.geometry, search.origin, search.me);
  if (sharesOf(search.geometry, complete.state, search.me) > originShares) return false;
  if (trailSizeOf(complete.state, search.me) !== 0) return false;
  if (search.campaign === undefined) return true;
  return !closerToCampaign(search, complete.state);
};

const swapIdle = (search: Search, chosen: CompletePlan): CompletePlan => {
  const stepped = search.bestStepped;
  if (stepped === undefined || !isIdlePlan(chosen.moves)) return chosen;
  const delta =
    completeScore(search.geometry, search.inner, search.me, chosen) -
    completeScore(search.geometry, search.inner, search.me, stepped);
  return delta <= IDLE_SLACK ? stepped : chosen;
};

const swapSortie = (search: Search, chosen: CompletePlan): CompletePlan => {
  const expedition = search.bestExpedition;
  if (!search.trackSortie || expedition === undefined) return chosen;
  if (isExpeditionTerminal(search.geometry, search.origin, chosen.state, search.me)) {
    return chosen;
  }
  const delta = homeboundScore(search, chosen) - homeboundScore(search, expedition);
  return delta <= SORTIE_SLACK ? expedition : chosen;
};

const swapCampaign = (search: Search, chosen: CompletePlan): CompletePlan => {
  const walk = search.bestCampaign;
  // Nested enemy replies (`withReplies: false`) skip the swap so P55 boxing
  // is not stolen (BSSN 25). Live chooseTurnBeam always passes true.
  if (!search.withReplies || walk === undefined) return chosen;
  if (trailSizeOf(search.origin, search.me) > 0 && isQuietDirtComplete(search, chosen)) {
    return walk;
  }
  if (
    search.trackSortie &&
    isExpeditionTerminal(search.geometry, search.origin, chosen.state, search.me) &&
    !isCampaignAdvancing(search, chosen.state)
  ) {
    return walk;
  }
  return chosen;
};

const pickReturnedPlan = (search: Search): CompletePlan | undefined => {
  if (search.best === undefined) return undefined;
  return swapCampaign(search, swapSortie(search, swapIdle(search, search.best)));
};

const tallyComplete = (search: Search, scored: CompletePlan): void => {
  search.best =
    search.best === undefined
      ? scored
      : pickBetterComplete(search.geometry, search.me, search.inner, search.best, scored);
  if (planHasStep(scored.moves)) {
    search.bestStepped =
      search.bestStepped === undefined
        ? scored
        : pickBetterComplete(
            search.geometry,
            search.me,
            search.inner,
            search.bestStepped,
            scored,
          );
  }
  if (
    search.trackSortie &&
    isExpeditionTerminal(search.geometry, search.origin, scored.state, search.me)
  ) {
    search.bestExpedition =
      search.bestExpedition === undefined
        ? scored
        : pickBetterComplete(
            search.geometry,
            search.me,
            search.inner,
            search.bestExpedition,
            scored,
          );
  }
  if (isCampaignAdvancing(search, scored.state)) {
    search.bestCampaign =
      search.bestCampaign === undefined
        ? scored
        : pickBetterComplete(
            search.geometry,
            search.me,
            search.inner,
            search.bestCampaign,
            scored,
          );
  }
};

const adoptComplete = (search: Search, child: CompletePlan): void => {
  if (search.withReplies && search.missionCtx !== undefined) {
    search.completes.push(child);
    tallyComplete(search, child);
    return;
  }
  const scored = search.withReplies ? scoreWithReplies(search, child) : child;
  tallyComplete(search, scored);
};

const betterByEvaluate = (search: Search, a: CompletePlan, b: CompletePlan): CompletePlan => {
  const ea = evaluate(search.geometry, a.state, search.me, search.inner) + liveCredit(search, a.state);
  const eb = evaluate(search.geometry, b.state, search.me, search.inner) + liveCredit(search, b.state);
  if (ea !== eb) return ea > eb ? a : b;
  return planKey(a.moves) <= planKey(b.moves) ? a : b;
};

const pickFinalists = (search: Search, ctx: MissionContext): CompletePlan[] => {
  const picked: CompletePlan[] = [];
  const seen = new Set<string>();
  for (const mission of ctx.missions) {
    let best: CompletePlan | undefined;
    for (const complete of search.completes) {
      if (!servesMission(ctx, complete, mission)) continue;
      best = best === undefined ? complete : betterByEvaluate(search, best, complete);
    }
    if (best === undefined) continue;
    const key = planKey(best.moves);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(best);
  }
  if (picked.length > 0) return picked;
  let fallback: CompletePlan | undefined;
  for (const complete of search.completes) {
    fallback = fallback === undefined ? complete : betterByEvaluate(search, fallback, complete);
  }
  return fallback === undefined ? [] : [fallback];
};

const applyFinalistReplies = (search: Search): void => {
  const ctx = search.missionCtx;
  if (ctx === undefined) return;
  const keys = new Set(pickFinalists(search, ctx).map((f) => planKey(f.moves)));
  const next: CompletePlan[] = [];
  const seen = new Set<string>();
  for (const child of search.completes) {
    const key = planKey(child.moves);
    if (seen.has(key)) continue;
    seen.add(key);
    if (keys.has(key)) next.push(scoreWithReplies(search, child));
    else {
      next.push({
        ...child,
        replyScore:
          evaluate(search.geometry, child.state, search.me, search.inner) +
          liveCredit(search, child.state),
      });
    }
  }
  search.completes = next;
  search.best = undefined;
  search.bestStepped = undefined;
  search.bestExpedition = undefined;
  search.bestCampaign = undefined;
  for (const complete of next) tallyComplete(search, complete);
};

const bestByScore = (
  search: Search,
  completes: readonly CompletePlan[],
  ok: (c: CompletePlan) => boolean,
): CompletePlan | undefined => {
  let best: CompletePlan | undefined;
  for (const complete of completes) {
    if (!ok(complete)) continue;
    best =
      best === undefined
        ? complete
        : pickBetterComplete(search.geometry, search.me, search.inner, best, complete);
  }
  return best;
};

const contestAdvancing = (search: Search, ctx: MissionContext, complete: CompletePlan): boolean =>
  remainingPath(search.geometry, complete.state, search.me, ctx.campaign) < ctx.outbound ||
  sharesOf(search.geometry, complete.state, search.me) >
    sharesOf(search.geometry, search.origin, search.me);

const isStagingShape = (search: Search, ctx: MissionContext, complete: CompletePlan): boolean =>
  sharesOf(search.geometry, complete.state, search.me) ===
    sharesOf(search.geometry, search.origin, search.me) &&
  trailSizeOf(complete.state, search.me) === 0 &&
  remainingPath(search.geometry, complete.state, search.me, ctx.campaign) < ctx.outbound &&
  planHasStep(complete.moves);

const gateThreatenedKite = (
  search: Search,
  ctx: MissionContext,
  chosen: CompletePlan,
): CompletePlan => {
  if (!isThreatenedKite(ctx, chosen)) return chosen;
  const alt = bestByScore(
    search,
    search.completes,
    (c) => isStagingClose(ctx, c) || (servesMission(ctx, c, 'contest') && !isThreatenedKite(ctx, c)),
  );
  if (alt !== undefined) return alt;
  let least = chosen;
  for (const complete of search.completes) {
    const a = kiteLength(search.geometry, least.state, search.me, ctx.originTerritory);
    const b = kiteLength(search.geometry, complete.state, search.me, ctx.originTerritory);
    if (b < a || (b === a && planKey(complete.moves) < planKey(least.moves))) least = complete;
  }
  return least;
};

const hasLumpReady = (origin: GameState, me: PlayerId): boolean => {
  for (const group of origin.groups.values()) {
    if (group.owner !== me) continue;
    if (group.heads >= 2 && group.spent < speed(group.heads)) return true;
  }
  return false;
};

const gateSidewaysDirt = (
  search: Search,
  ctx: MissionContext,
  chosen: CompletePlan,
): CompletePlan => {
  if (!isSidewaysDirt(ctx, chosen) || ctx.missions.includes('bank')) return chosen;
  const alt = bestByScore(
    search,
    search.completes,
    (c) => isStagingClose(ctx, c) || contestAdvancing(search, ctx, c),
  );
  if (alt === undefined) return chosen;
  if (!planHasStep(chosen.moves)) {
    // 6-seat P56 leave: idle evaluate can beat a departing step; still take
    // contest-advancing. 2–3 seat lump-ready leftover also leaves (P65).
    // 1-stack pass-is-best boards keep idle when the step is strictly worse.
    if (search.origin.players.length >= 6) return alt;
    if (hasLumpReady(search.origin, search.me)) return alt;
    if (
      evaluate(search.geometry, alt.state, search.me, search.inner) <=
      evaluate(search.geometry, chosen.state, search.me, search.inner)
    ) {
      return chosen;
    }
  }
  return alt;
};

const gateBank = (search: Search, ctx: MissionContext, chosen: CompletePlan): CompletePlan => {
  if (!ctx.missions.includes('bank')) return chosen;
  if (servesMission(ctx, chosen, 'bank')) return chosen;
  return bestByScore(search, search.completes, (c) => servesMission(ctx, c, 'bank')) ?? chosen;
};

const gateStagingOverOpenTrail = (
  search: Search,
  ctx: MissionContext,
  chosen: CompletePlan,
): CompletePlan => {
  if (ctx.missions.includes('bank')) return chosen;
  if (trailSizeOf(chosen.state, search.me) === 0) return chosen;
  if (
    sharesOf(search.geometry, chosen.state, search.me) >
    sharesOf(search.geometry, search.origin, search.me)
  ) {
    return chosen;
  }
  const staging = bestByScore(search, search.completes, (c) => isStagingShape(search, ctx, c));
  if (staging === undefined) return chosen;
  const chosenPath = remainingPath(search.geometry, chosen.state, search.me, ctx.campaign);
  const stagingPath = remainingPath(search.geometry, staging.state, search.me, ctx.campaign);
  if (chosenPath < stagingPath) return chosen;
  return staging;
};

const gateCut = (search: Search, ctx: MissionContext, chosen: CompletePlan): CompletePlan => {
  if (!ctx.missions.includes('cut')) return chosen;
  if (servesMission(ctx, chosen, 'cut')) return chosen;
  if (!isSidewaysDirt(ctx, chosen) && !isIdlePlan(chosen.moves)) return chosen;
  return bestByScore(search, search.completes, (c) => servesMission(ctx, c, 'cut')) ?? chosen;
};

/** P85 decision 4: after `gateCut`, before `gateBank`. Keep the chosen plan when none serves. */
const gateIntercept = (search: Search, ctx: MissionContext, chosen: CompletePlan): CompletePlan => {
  if (!ctx.missions.includes('intercept')) return chosen;
  if (servesMission(ctx, chosen, 'intercept')) return chosen;
  return bestByScore(search, search.completes, (c) => servesMission(ctx, c, 'intercept')) ?? chosen;
};

const applyMissionGates = (search: Search, chosen: CompletePlan | undefined): CompletePlan | undefined => {
  if (chosen === undefined) return undefined;
  const ctx = search.missionCtx;
  if (ctx === undefined || !search.withReplies) return chosen;
  const afterKite = gateThreatenedKite(search, ctx, chosen);
  const afterStaging = gateStagingOverOpenTrail(search, ctx, afterKite);
  const afterDirt = gateSidewaysDirt(search, ctx, afterStaging);
  const afterCut = gateCut(search, ctx, afterDirt);
  const afterIntercept = gateIntercept(search, ctx, afterCut);
  return gateBank(search, ctx, afterIntercept);
};

const cutAttackFindings = (rules: RulesPort, state: GameState, me: PlayerId): OriginFinding[] => {
  const out: OriginFinding[] = [];
  for (const move of rules.legalMoves(state)) {
    if (move.kind !== 'step') continue;
    let after: GameState;
    try {
      after = rules.apply(state, move);
    } catch {
      continue;
    }
    if (isCutMove(state, after, me)) out.push({ kind: 'cut', move });
    const dest = state.groups.get(move.exit);
    if (dest !== undefined && dest.owner !== me) out.push({ kind: 'attack', move });
  }
  return out;
};

const considerEnd = (search: Search, parent: Incomplete): void => {
  const after =
    search.applies < search.maxApplies
      ? search.rules.apply(parent.state, endTurn())
      : search.inner.apply(parent.state, endTurn());
  adoptComplete(search, { moves: [...parent.moves, endTurn()], state: after });
};

const findingRank = (
  findings: readonly { readonly move: StepMove }[],
  move: StepMove,
): number => {
  const i = findings.findIndex((f) => f.move.from === move.from && f.move.exit === move.exit);
  return i < 0 ? UNRANKED : i;
};

const exitKey = (move: StepMove): string =>
  `${String(move.from)}>${String(move.exit)}`;

/**
 * P81 decision 1 — the `RulesPort` view `orderSteps` hands `collectFindings`:
 * `legalMoves` keeps, for each `(from, exit)`, only the step with the largest
 * legal count (`endTurn` unchanged), at the position of that pair's first step;
 * every other method is `rules`'s own.
 */
export const oneStepPerExit = (rules: RulesPort): RulesPort => ({
  ...rules,
  legalMoves(state) {
    const out: Move[] = [];
    const slot = new Map<string, number>();
    for (const move of rules.legalMoves(state)) {
      if (move.kind !== 'step') {
        out.push(move);
        continue;
      }
      const at = slot.get(exitKey(move));
      const held = at === undefined ? undefined : out[at];
      if (at === undefined) {
        slot.set(exitKey(move), out.length);
        out.push(move);
      } else if (held?.kind === 'step' && move.count > held.count) {
        out[at] = move;
      }
    }
    return out;
  },
});

type OrderedSteps = {
  readonly findings: readonly OriginFinding[];
  readonly steps: readonly StepMove[];
};

const orderSteps = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  campaign: VertexId | undefined,
): OrderedSteps => {
  const collected = collectFindings(
    geometry,
    oneStepPerExit(rules),
    state,
    me,
    DEFAULT_FINDINGS_CAPS,
    playLayout,
    campaign,
  );
  const findings: OriginFinding[] = collected.map((f) => ({ kind: f.kind, move: f.move }));
  const steps = rules.legalMoves(state).filter((m): m is StepMove => m.kind === 'step');
  return {
    findings,
    steps: steps.toSorted((a, b) => {
      const ra = findingRank(collected, a);
      const rb = findingRank(collected, b);
      if (ra !== rb) return ra < rb ? -1 : ra > rb ? 1 : 0;
      if (a.count !== b.count) return a.count > b.count ? -1 : a.count < b.count ? 1 : 0;
      const ka = moveKey(a);
      const kb = moveKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }),
  };
};

const rankIncompletes = (search: Search, plans: readonly Incomplete[]): Incomplete[] => {
  const scored = plans.map((plan) => ({
    plan,
    score: evaluate(search.geometry, plan.state, search.me, search.rules) + liveCredit(search, plan.state),
    key: planKey(plan.moves),
  }));
  return scored
    .toSorted((a, b) => {
      if (a.score !== b.score) return a.score > b.score ? -1 : a.score < b.score ? 1 : 0;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .map((row) => row.plan);
};


const selectBranch = (sorted: readonly StepMove[], branch: number): StepMove[] => {
  const picked: StepMove[] = [];
  const pickedKey = new Set<string>();
  const remember = (move: StepMove): boolean => {
    const key = moveKey(move);
    if (pickedKey.has(key)) return false;
    pickedKey.add(key);
    picked.push(move);
    return picked.length >= branch;
  };
  const seenExit = new Set<string>();
  for (const move of sorted) {
    const exit = exitKey(move);
    if (seenExit.has(exit)) continue;
    seenExit.add(exit);
    if (remember(move)) return picked;
  }
  for (const move of sorted) {
    if (move.count !== 2) continue;
    if (remember(move)) return picked;
  }
  for (const move of sorted) {
    if (remember(move)) return picked;
  }
  return picked;
};

const isExtendable = (plan: Incomplete, me: PlayerId, maxPlan: number): boolean =>
  plan.moves.length < maxPlan &&
  plan.state.activePlayer === me &&
  plan.state.winner === undefined;

type AppliedStep = {
  readonly stepMove: StepMove;
  readonly after: GameState;
};

const applyBranchSteps = (
  search: Search,
  parent: Incomplete,
  steps: readonly StepMove[],
): { readonly children: AppliedStep[]; readonly hitCap: boolean } => {
  const children: AppliedStep[] = [];
  for (const stepMove of steps) {
    if (search.applies >= search.maxApplies) return { children, hitCap: true };
    let after: GameState;
    try {
      after = search.rules.apply(parent.state, stepMove);
    } catch (err) {
      if (err instanceof Error && err.message === APPLY_CAP) return { children, hitCap: true };
      throw err;
    }
    children.push({ stepMove, after });
  }
  return { children, hitCap: false };
};

const filterOnMission = (
  search: Search,
  parent: Incomplete,
  findings: readonly OriginFinding[],
  children: readonly AppliedStep[],
): readonly AppliedStep[] => {
  const ctx = search.missionCtx;
  if (ctx === undefined) return children;
  const on = children.filter((c) =>
    onMissionStep(ctx, parent.state, c.stepMove, c.after, findings),
  );
  return on.length > 0 ? on : children;
};

const takeChild = (
  search: Search,
  parent: Incomplete,
  applied: AppliedStep,
  next: Incomplete[],
  maxPlan: number,
): void => {
  const child: Incomplete = { moves: [...parent.moves, applied.stepMove], state: applied.after };
  if (applied.after.activePlayer !== search.me || applied.after.winner !== undefined) {
    adoptComplete(search, child);
    return;
  }
  next.push(child);
  if (search.withReplies && isExtendable(child, search.me, maxPlan)) considerEnd(search, child);
};

const expandBeam = (
  search: Search,
  extendable: readonly Incomplete[],
  branch: number,
  maxPlan: number,
): Incomplete[] => {
  const next: Incomplete[] = [];
  for (const parent of extendable) {
    if (parent.moves.length === maxPlan - 1) {
      considerEnd(search, parent);
      continue;
    }
    if (search.applies >= search.maxApplies) break;
    const ordered = orderSteps(
      search.geometry,
      search.rules,
      parent.state,
      search.me,
      search.campaign,
    );
    const selected = selectBranch(ordered.steps, branch);
    const applied = applyBranchSteps(search, parent, selected);
    const used = filterOnMission(search, parent, ordered.findings, applied.children);
    for (const child of used) takeChild(search, parent, child, next, maxPlan);
    if (applied.hitCap) break;
    considerEnd(search, parent);
    if (search.applies >= search.maxApplies) break;
  }
  return next;
};

/** greedy-v1 — today's `chooseMove` loop behind `ChooseTurn`. */
export const chooseTurnGreedy: ChooseTurn = (geometry, rules, state, me) => {
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

const missionContextOf = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  campaign: VertexId | undefined,
): MissionContext => {
  const intercept = interceptOf(geometry, state, me);
  return {
    geometry,
    rules,
    origin: state,
    me,
    campaign,
    outbound: remainingPath(geometry, state, me, campaign),
    originTerritory: originTerritoryOf(state, me),
    missions: missionsOf(geometry, rules, state, me, cutAttackFindings(rules, state, me), intercept),
    denyExit: denyExitOf(rules, state, me),
    ...(intercept !== undefined ? { intercept } : {}),
  };
};

type SearchSetup = {
  readonly campaign: VertexId | undefined;
  readonly missionCtx: MissionContext | undefined;
  readonly withReplies: boolean;
  readonly maxApplies: number;
};

const newSearch = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  setup: SearchSetup,
): Search => {
  const search: Search = {
    applies: 0,
    best: undefined,
    bestStepped: undefined,
    bestExpedition: undefined,
    bestCampaign: undefined,
    origin: state,
    trackSortie: stillAtHome(state, me) && !departingExitIsThreatened(state, me, rules),
    campaign: setup.campaign,
    originExposure: setup.missionCtx?.missions.includes('bank') === true ? 1 : 0,
    geometry,
    rules,
    inner: rules,
    me,
    maxApplies: setup.maxApplies,
    withReplies: setup.withReplies,
    replyTurnAppliesLeft: REPLY_TURN_APPLIES,
    missionCtx: setup.missionCtx,
    creditMemo: new Map(),
    completes: [],
  };
  search.rules = capRules(rules, search);
  return search;
};

type BeamShape = {
  readonly beamWidth: number;
  readonly branch: number;
  readonly maxPlan: number;
};

const beamShapeOf = (budget: ChooseTurnBudget | undefined): BeamShape => ({
  beamWidth: budget?.beam ?? BEAM,
  branch: budget?.branch ?? BRANCH,
  maxPlan: budget?.maxPlan ?? MAX_PLAN,
});

/** Expand the beam until no plan extends; end the best open plan if none completed. */
const runBeam = (search: Search, shape: BeamShape): void => {
  const seed: Incomplete = { moves: [], state: search.origin };
  let beam: Incomplete[] = [seed];
  for (;;) {
    const extendable = beam.filter((plan) => isExtendable(plan, search.me, shape.maxPlan));
    if (extendable.length === 0) break;
    const next = expandBeam(search, extendable, shape.branch, shape.maxPlan);
    if (next.length === 0) break;
    beam = rankIncompletes(search, next).slice(0, shape.beamWidth);
  }
  if (search.best === undefined) {
    considerEnd(search, rankIncompletes(search, beam)[0] ?? seed);
  }
};

/** P81 decision 5 — the live seat's carves join the search as complete plans. */
const seedCarves = (search: Search): void => {
  if (!search.withReplies) return;
  for (const plan of carvePlans(search.geometry, search.inner, search.origin, search.me)) {
    adoptComplete(search, plan);
  }
};

/**
 * P84 decisions 2–5 — the live seat's return seam. Nested searches are not
 * live and keep the plan the gates already chose. Choice logic lives in
 * `neverIdle`; this is the wiring.
 */
const liveReturn = (
  search: Search,
  ctx: MissionContext | undefined,
  staged: readonly Move[],
): readonly Move[] => {
  // `ctx` is always set when `withReplies` is; the check only narrows the type.
  if (!search.withReplies || ctx === undefined) return staged;
  return neverIdle(
    {
      geometry: search.geometry,
      // `inner`, not the apply-capped `rules`: a starved beam must still apply.
      rules: search.inner,
      origin: search.origin,
      me: search.me,
      completes: search.completes,
      score: (complete) =>
        complete.replyScore ??
        evaluate(search.geometry, complete.state, search.me, search.inner),
      isThreatenedKite: (complete) => isThreatenedKite(ctx, complete),
      kiteLength: (complete) =>
        kiteLength(search.geometry, complete.state, search.me, ctx.originTerritory),
      planKey,
      chooseMove,
    },
    staged,
  );
};

/** P81 decision 6 — the live seat's quiet choice yields to a staging walk, when one exists. */
const stageIfQuiet = (
  search: Search,
  chosen: CompletePlan | undefined,
): CompletePlan | undefined => {
  if (!search.withReplies || chosen === undefined) return chosen;
  if (!isQuietPlan(search.origin, chosen.state, search.me)) return chosen;
  return stagingWalk(search.geometry, search.inner, search.origin, search.me) ?? chosen;
};

export const chooseTurnBeamWithBudget: (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  budget?: ChooseTurnBudget,
) => readonly Move[] = (geometry, rules, state, me, budget) => {
  if (state.activePlayer !== me || state.winner !== undefined) return [];
  const withReplies = budget?.withReplies ?? false;
  const campaign = campaignTarget(geometry, state, me);
  // Before enterBeamSearch: the mission context's exposure folds real replies.
  const missionCtx = withReplies
    ? missionContextOf(geometry, rules, state, me, campaign)
    : undefined;
  enterBeamSearch();
  try {
    const search = newSearch(geometry, rules, state, me, {
      campaign,
      missionCtx,
      withReplies,
      maxApplies: budget?.maxApplies ?? MAX_APPLIES,
    });
    seedCarves(search);
    runBeam(search, beamShapeOf(budget));
    if (search.withReplies && search.missionCtx !== undefined) applyFinalistReplies(search);
    const chosen = applyMissionGates(search, pickReturnedPlan(search));
    const staged = stageIfQuiet(search, chosen)?.moves ?? [endTurn()];
    return liveReturn(search, missionCtx, staged);
  } finally {
    leaveBeamSearch();
  }
};

export const chooseTurnBeam: ChooseTurn = (geometry, rules, state, me) =>
  chooseTurnBeamWithBudget(geometry, rules, state, me, { withReplies: true });

bindReplySearch(enemyReplySearch);
