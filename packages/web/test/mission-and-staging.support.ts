/**
 * Oracles and constructed boards for P59 mission-and-staging tests.
 * Production predicates live in botMission.ts; these oracles classify boards
 * so chooseTurnBeam assertions fail for missing search gates, not throws.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endTurn, movesEqual } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  Group,
  Move,
  PlayerId,
  StepMove,
  VertexId,
} from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { campaignTarget, exposure } from '../src/botClose';
import { grainDistance, grainDistanceToAny } from '../src/botEvaluate';
import { DEFAULT_REPLY_DIST_CAP } from '../src/botReply';
import { collectFindings, DEFAULT_FINDINGS_CAPS } from '../src/findings';
import {
  CAMPAIGN_DIST_CAP,
  KITE_RATIO,
  type MissionContext,
  type MissionKind,
  type MissionPlan,
  type OriginFinding,
} from '../src/botMission';
import { isCutMove } from '../src/opponent';
import { playLayout } from '../src/playLayout';
import {
  afterFirstHomeMillClose,
  afterOpeningOpenTrailUnderFire,
  botAndEnemy,
  boxOpenExitPosition,
  foldPlan,
  geometry,
  legalSteps,
  rules,
  sharesOf,
  SMALL_MATCH,
  trailSizeOf,
} from './bot-turn-search.support';
import { hypothesiseChair } from './opponent-ply-and-denial.support';
import { shuffleCloseMaps, specCampaignTarget, stepTowardVertex } from './close-and-spawner-value.support';

const here = dirname(fileURLToPath(import.meta.url));

export { shuffleCloseMaps, specCampaignTarget, stepTowardVertex };
export { hypothesiseChair };

export const REPLY_DIST = DEFAULT_REPLY_DIST_CAP;

export const botMissionSource = (): string =>
  readFileSync(join(here, '../src/botMission.ts'), 'utf8');

export const botSearchSource = (): string =>
  readFileSync(join(here, '../src/botSearch.ts'), 'utf8');

export const botCloseSource = (): string =>
  readFileSync(join(here, '../src/botClose.ts'), 'utf8');

export const botReplySource = (): string =>
  readFileSync(join(here, '../src/botReply.ts'), 'utf8');

export const botEvaluateSource = (): string =>
  readFileSync(join(here, '../src/botEvaluate.ts'), 'utf8');

export const findingsSource = (): string =>
  readFileSync(join(here, '../src/findings.ts'), 'utf8');

export const sourceWithoutComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareArrows = (a: ArrowId, b: ArrowId): number => compareIds(String(a), String(b));

export const originFindingsOf = (state: GameState, me: PlayerId): OriginFinding[] =>
  collectFindings(geometry, rules, state, me, DEFAULT_FINDINGS_CAPS, playLayout).map((f) => ({
    kind: f.kind,
    move: f.move,
  }));

export const originTerritoryKeys = (state: GameState, me: PlayerId): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const [arrow, owner] of state.territory) {
    if (owner === me) keys.add(String(arrow));
  }
  return keys;
};

const bordersOf = (vertex: VertexId): ArrowId[] =>
  [...geometry.borderArrows(vertex)].toSorted(compareArrows);

const grainDistToVertex = (from: ArrowId, vertex: VertexId, cap = CAMPAIGN_DIST_CAP): number =>
  grainDistanceToAny(geometry, from, bordersOf(vertex), cap);

const ownFromSet = (state: GameState, me: PlayerId): ArrowId[] => {
  const seen = new Set<string>();
  const out: ArrowId[] = [];
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
  return out.toSorted(compareArrows);
};

/** Test-side BSSN 5 remainingPath. */
export const specRemainingPath = (
  state: GameState,
  me: PlayerId,
  campaign: VertexId | undefined,
): number => {
  if (campaign === undefined) return CAMPAIGN_DIST_CAP + 1;
  let best = CAMPAIGN_DIST_CAP + 1;
  for (const from of ownFromSet(state, me)) {
    const d = grainDistToVertex(from, campaign);
    if (d < best) best = d;
  }
  return best;
};

type HomewardOnto = {
  readonly distance: number;
  readonly path: readonly ArrowId[];
};

const specHomewardOnto = (start: ArrowId, home: ReadonlySet<string>, cap = CAMPAIGN_DIST_CAP): HomewardOnto => {
  if (home.has(String(start))) return { distance: 0, path: [] };
  const seen = new Set<string>([String(start)]);
  const cameFrom = new Map<string, ArrowId>();
  let frontier: ArrowId[] = [start];
  for (let d = 1; d <= cap; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const exit of geometry.outArrows(geometry.target(arrow))) {
        const key = String(exit);
        if (seen.has(key)) continue;
        if (home.has(key)) {
          const rev: ArrowId[] = [arrow];
          let cur = arrow;
          while (cur !== start) {
            const prev = cameFrom.get(String(cur));
            if (prev === undefined) break;
            rev.push(prev);
            cur = prev;
          }
          return { distance: d, path: rev.toReversed() };
        }
        seen.add(key);
        cameFrom.set(key, arrow);
        next.push(exit);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return { distance: cap + 1, path: [start] };
};

const trailTips = (state: GameState, me: PlayerId): ArrowId[] => {
  const trail = state.trails.get(me);
  if (trail === undefined || trail.size === 0) return [];
  const tips: ArrowId[] = [];
  for (const [arrow, group] of state.groups) {
    if (group.owner === me && trail.has(arrow)) tips.push(arrow);
  }
  return tips.toSorted(compareArrows);
};

export const specKiteLength = (
  terminal: GameState,
  me: PlayerId,
  originTerritory: ReadonlySet<string>,
): number => {
  if (trailSizeOf(terminal, me) === 0) return 0;
  let best = 0;
  for (const tip of trailTips(terminal, me)) {
    const d = specHomewardOnto(tip, originTerritory).distance;
    if (d > best) best = d;
  }
  return best;
};

export const specPlanHasStep = (moves: readonly Move[]): boolean =>
  moves.some((m) => m.kind === 'step');

export const specProjectedTrail = (ctx: MissionContext, plan: MissionPlan): ArrowId[] => {
  const seen = new Set<string>();
  const out: ArrowId[] = [];
  const add = (arrow: ArrowId): void => {
    const key = String(arrow);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(arrow);
  };
  for (const move of plan.moves) {
    if (move.kind === 'step') add(move.exit);
  }
  for (const tip of trailTips(plan.state, ctx.me)) {
    for (const arrow of specHomewardOnto(tip, ctx.originTerritory).path) add(arrow);
  }
  return out.toSorted(compareArrows);
};

export const specEnemyCanReach = (
  origin: GameState,
  me: PlayerId,
  arrows: readonly ArrowId[],
): boolean => {
  if (arrows.length === 0) return false;
  for (const [from, group] of origin.groups) {
    if (group.owner === me) continue;
    for (const goal of arrows) {
      if (grainDistance(geometry, from, goal, REPLY_DIST) <= REPLY_DIST) return true;
    }
  }
  return false;
};

const occupiesCampaignBorder = (
  terminal: GameState,
  me: PlayerId,
  campaign: VertexId | undefined,
): boolean => {
  if (campaign === undefined) return false;
  const borders = new Set(bordersOf(campaign).map(String));
  for (const [arrow, group] of terminal.groups) {
    if (group.owner === me && borders.has(String(arrow))) return true;
  }
  return false;
};

export const specIsKite = (ctx: MissionContext, plan: MissionPlan): boolean => {
  if (!ctx.missions.includes('contest')) return false;
  const gained = sharesOf(plan.state, ctx.me) > sharesOf(ctx.origin, ctx.me);
  const onBorder = occupiesCampaignBorder(plan.state, ctx.me, ctx.campaign);
  if (!gained && !onBorder) return false;
  const len = specKiteLength(plan.state, ctx.me, ctx.originTerritory);
  return len >= KITE_RATIO * Math.max(1, ctx.outbound);
};

export const specIsThreatenedKite = (ctx: MissionContext, plan: MissionPlan): boolean =>
  specIsKite(ctx, plan) && specEnemyCanReach(ctx.origin, ctx.me, specProjectedTrail(ctx, plan));

/** 0-share close that drops remainingPath and has a step (Gherkin staging shape). */
export const specStagingShape = (ctx: MissionContext, plan: MissionPlan): boolean =>
  sharesOf(plan.state, ctx.me) === sharesOf(ctx.origin, ctx.me) &&
  trailSizeOf(plan.state, ctx.me) === 0 &&
  specRemainingPath(plan.state, ctx.me, ctx.campaign) < ctx.outbound &&
  specPlanHasStep(plan.moves);

export const specIsStagingClose = (ctx: MissionContext, plan: MissionPlan): boolean => {
  if (!specStagingShape(ctx, plan)) return false;
  if (specIsThreatenedKite(ctx, plan)) return false;
  if (specEnemyCanReach(ctx.origin, ctx.me, specProjectedTrail(ctx, plan))) return false;
  return true;
};

export const specIsSidewaysDirt = (ctx: MissionContext, plan: MissionPlan): boolean =>
  sharesOf(plan.state, ctx.me) === sharesOf(ctx.origin, ctx.me) &&
  trailSizeOf(plan.state, ctx.me) === 0 &&
  specRemainingPath(plan.state, ctx.me, ctx.campaign) >= ctx.outbound;

const legalMoveAmong = (state: GameState, move: Move): boolean =>
  rules.legalMoves(state).some((m) => movesEqual(m, move));

const specCutAvailable = (state: GameState, findings: readonly OriginFinding[]): boolean =>
  findings.some(
    (f) => (f.kind === 'cut' || f.kind === 'attack') && legalMoveAmong(state, f.move),
  );

const specLegalExits = (state: GameState, from: ArrowId, owner: PlayerId): ArrowId[] => {
  const chair = hypothesiseChair(state, owner);
  const seen = new Set<string>();
  const out: ArrowId[] = [];
  for (const move of legalSteps(chair)) {
    if (move.from !== from) continue;
    const key = String(move.exit);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(move.exit);
  }
  return out.toSorted(compareArrows);
};

export const specDenyExit = (state: GameState, me: PlayerId): ArrowId | undefined => {
  const enemies = [...state.players]
    .filter((p) => p !== me)
    .toSorted((a, b) => compareIds(String(a), String(b)));
  let bestO: ArrowId | undefined;
  let bestEnemy: PlayerId | undefined;
  for (const enemy of enemies) {
    for (const [arrow, group] of state.groups) {
      if (group.owner !== enemy || group.heads !== 1) continue;
      const exits = specLegalExits(state, arrow, enemy);
      const open = exits.filter((o) => state.territory.get(o) !== me);
      if (open.length !== 1) continue;
      const O = open[0];
      if (O === undefined) continue;
      if (!exits.every((o) => o === O || state.territory.get(o) === me)) continue;
      const weCan = legalSteps(state).some((m) => m.exit === O);
      if (!weCan) continue;
      if (
        bestO === undefined ||
        bestEnemy === undefined ||
        compareIds(String(enemy), String(bestEnemy)) < 0 ||
        (enemy === bestEnemy && compareArrows(O, bestO) < 0)
      ) {
        bestO = O;
        bestEnemy = enemy;
      }
    }
  }
  return bestO;
};

export const specMissionsOf = (
  state: GameState,
  me: PlayerId,
  originFindings: readonly OriginFinding[],
): readonly MissionKind[] => {
  const V = campaignTarget(geometry, state, me);
  const onTrail = trailSizeOf(state, me) > 0;
  const underFire = onTrail && exposure(geometry, rules, state, me) > 0;
  const cutAvailable = specCutAvailable(state, originFindings);
  const boxAvailable = specDenyExit(state, me) !== undefined;
  const missions: MissionKind[] = [];
  if (underFire) missions.push('bank');
  if (cutAvailable) missions.push('cut');
  if (missions.length === 0) missions.push('contest');
  if (boxAvailable && missions.length < 3 && !missions.includes('bank')) {
    missions.push('deny');
  }
  const capped = missions.slice(0, 3);
  if (V === undefined && capped.includes('contest')) {
    const dropped = capped.filter((m) => m !== 'contest');
    return dropped.length === 0 ? ['contest'] : dropped;
  }
  return capped;
};

export const specMissionContext = (
  state: GameState,
  me: PlayerId,
  originFindings?: readonly OriginFinding[],
): MissionContext => {
  const findings = originFindings ?? originFindingsOf(state, me);
  const campaign = campaignTarget(geometry, state, me);
  return {
    geometry,
    rules,
    origin: state,
    me,
    campaign,
    outbound: specRemainingPath(state, me, campaign),
    originTerritory: originTerritoryKeys(state, me),
    missions: specMissionsOf(state, me, findings),
    denyExit: specDenyExit(state, me),
  };
};

const relocatePlayer = (
  state: GameState,
  player: PlayerId,
  at: ArrowId,
  heads: number,
): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of state.groups) {
    if (group.owner !== player) groups.set(arrow, group);
  }
  groups.set(at, { owner: player, heads, spent: 0 });
  return { ...state, groups };
};

const predecessors = (arrow: ArrowId): readonly ArrowId[] =>
  geometry.inArrows(geometry.origin(arrow));

const reverseAtDistance = (seeds: readonly ArrowId[], dist: number): ArrowId[] => {
  const seen = new Set(seeds.map(String));
  let frontier: ArrowId[] = [...seeds];
  for (let d = 1; d <= dist; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const pred of predecessors(arrow)) {
        const key = String(pred);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(pred);
      }
    }
    frontier = next;
    if (frontier.length === 0) return [];
  }
  return frontier;
};

const botTip = (state: GameState, me: PlayerId): ArrowId | undefined =>
  [...state.groups.entries()].find(([, g]) => g.owner === me)?.[0];

const finishTurn = (start: GameState, me: PlayerId, moves: readonly Move[]): MissionPlan => {
  const state = foldPlan(start, moves);
  if (state.winner !== undefined || state.activePlayer !== me) {
    return { moves, state };
  }
  const ended = [...moves, endTurn()];
  return { moves: ended, state: foldPlan(start, ended) };
};

const tryStagingFrom = (
  origin: GameState,
  me: PlayerId,
  campaign: VertexId,
  outbound: number,
): MissionPlan | undefined => {
  const ctxBare: MissionContext = {
    geometry,
    rules,
    origin,
    me,
    campaign,
    outbound,
    originTerritory: originTerritoryKeys(origin, me),
    missions: ['contest'],
    denyExit: undefined,
  };
  const from = botTip(origin, me);
  if (from === undefined) return undefined;
  for (const first of legalSteps(origin)) {
    if (first.from !== from) continue;
    if (origin.territory.get(first.exit) === me) continue;
    let mid: GameState;
    try {
      mid = rules.apply(origin, first);
    } catch {
      continue;
    }
    if (mid.activePlayer !== me) continue;
    for (const second of legalSteps(mid)) {
      if (second.from !== first.exit) continue;
      let mid2: GameState;
      try {
        mid2 = rules.apply(mid, second);
      } catch {
        continue;
      }
      if (mid2.territory.get(second.exit) === me) {
        const plan = finishTurn(origin, me, [first, second]);
        if (specStagingShape(ctxBare, plan)) return plan;
      }
      if (mid2.activePlayer !== me) continue;
      for (const third of legalSteps(mid2)) {
        if (third.from !== second.exit) continue;
        if (mid2.territory.get(third.exit) !== me) continue;
        const plan = finishTurn(origin, me, [first, second, third]);
        if (specStagingShape(ctxBare, plan)) return plan;
      }
    }
  }
  return undefined;
};

const tryKiteWalk = (
  origin: GameState,
  me: PlayerId,
  campaign: VertexId,
  outbound: number,
  maxSteps = 8,
): MissionPlan | undefined => {
  const ctxBare: MissionContext = {
    geometry,
    rules,
    origin,
    me,
    campaign,
    outbound,
    originTerritory: originTerritoryKeys(origin, me),
    missions: ['contest'],
    denyExit: undefined,
  };
  const startFrom = botTip(origin, me);
  if (startFrom === undefined) return undefined;
  let at = origin;
  let tip = startFrom;
  const moves: StepMove[] = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const options = legalSteps(at).filter((m) => {
      if (m.from !== tip) return false;
      if (at.territory.get(m.exit) === me) return false;
      return grainDistToVertex(m.exit, campaign) < grainDistToVertex(m.from, campaign);
    });
    options.sort((a, b) => {
      const da = grainDistToVertex(a.exit, campaign);
      const db = grainDistToVertex(b.exit, campaign);
      if (da !== db) return da - db;
      if (b.count !== a.count) return b.count - a.count;
      return compareArrows(a.exit, b.exit);
    });
    const move = options[0];
    if (move === undefined) break;
    let child: GameState;
    try {
      child = rules.apply(at, move);
    } catch {
      break;
    }
    if (child.activePlayer !== me && child.winner === undefined) break;
    moves.push(move);
    at = child;
    tip = move.exit;
    const plan = finishTurn(origin, me, moves);
    if (specIsKite(ctxBare, plan)) return plan;
    if (child.activePlayer !== me) break;
  }
  return undefined;
};

const enemySeat = (state: GameState, me: PlayerId): PlayerId => {
  const enemy = state.players.find((p) => p !== me);
  if (enemy === undefined) throw new Error('setup: need an enemy seat');
  return enemy;
};

const placeEnemyNear = (
  origin: GameState,
  me: PlayerId,
  arrows: readonly ArrowId[],
  wantReach: boolean,
  avoid?: readonly ArrowId[],
): GameState => {
  const E = enemySeat(origin, me);
  const candidates = wantReach
    ? [
        ...reverseAtDistance(arrows, 2),
        ...reverseAtDistance(arrows, 1),
        ...arrows,
        ...reverseAtDistance(arrows, 3),
      ]
    : reverseAtDistance(arrows, REPLY_DIST + 2);
  for (const at of candidates) {
    if (origin.groups.has(at) && origin.groups.get(at)?.owner === me) continue;
    if (origin.territory.get(at) === me) continue;
    const next = relocatePlayer(origin, E, at, 1);
    const reaches = specEnemyCanReach(next, me, arrows);
    if (reaches !== wantReach) continue;
    if (avoid !== undefined && avoid.length > 0 && specEnemyCanReach(next, me, avoid)) continue;
    return next;
  }
  if (!wantReach) {
    const far = reverseAtDistance(arrows, REPLY_DIST + 3);
    const at = far.find((arrow) => origin.territory.get(arrow) !== me);
    if (at !== undefined) return relocatePlayer(origin, E, at, 1);
  }
  throw new Error(`setup: no enemy placement with reach=${String(wantReach)}`);
};

export type StagingKiteBoard = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly campaign: VertexId;
  readonly outbound: number;
  readonly staging: MissionPlan;
  readonly kite: MissionPlan;
  readonly ctx: MissionContext;
};

const restrictToVertex = (state: GameState, vertex: VertexId): GameState => {
  const spawners = new Map(state.spawners);
  for (const v of state.spawners.keys()) {
    if (v !== vertex) spawners.delete(v);
  }
  return { ...state, spawners };
};

const isolateEnemyFar = (state: GameState, me: PlayerId): GameState => {
  const E = enemySeat(state, me);
  const home = botTip(state, me);
  if (home === undefined) return state;
  const far = reverseAtDistance([home], REPLY_DIST + 3).find(
    (arrow) => state.territory.get(arrow) !== me && !state.groups.has(arrow),
  );
  if (far === undefined) return state;
  return relocatePlayer(state, E, far, 1);
};

const boardFromOrigin = (
  origin: GameState,
  me: PlayerId,
  threatened: boolean,
): StagingKiteBoard | undefined => {
  const campaign = campaignTarget(geometry, origin, me);
  if (campaign === undefined) return undefined;
  const outbound = specRemainingPath(origin, me, campaign);
  if (outbound < 2) return undefined;
  const quiet = isolateEnemyFar(origin, me);
  const staging = tryStagingFrom(quiet, me, campaign, outbound);
  const kite = tryKiteWalk(quiet, me, campaign, outbound);
  if (staging === undefined || kite === undefined) return undefined;
  const kiteCtx: MissionContext = {
    geometry,
    rules,
    origin: quiet,
    me,
    campaign,
    outbound,
    originTerritory: originTerritoryKeys(quiet, me),
    missions: ['contest'],
    denyExit: undefined,
  };
  const kiteArrows = specProjectedTrail(kiteCtx, kite);
  let state: GameState;
  try {
    state = placeEnemyNear(quiet, me, kiteArrows, threatened);
  } catch {
    return undefined;
  }
  const ctx = specMissionContext(state, me);
  let kitePlan: MissionPlan;
  let stagingPlan: MissionPlan;
  try {
    kitePlan = { moves: kite.moves, state: foldPlan(state, kite.moves) };
    stagingPlan = { moves: staging.moves, state: foldPlan(state, staging.moves) };
  } catch {
    return undefined;
  }
  if (!specStagingShape(ctx, stagingPlan)) return undefined;
  if (threatened && !specIsThreatenedKite(ctx, kitePlan)) return undefined;
  if (!threatened && specIsThreatenedKite(ctx, kitePlan)) return undefined;
  return { state, Bot: me, campaign, outbound, staging: stagingPlan, kite: kitePlan, ctx };
};

export const stagingVsThreatenedKitePosition = (): StagingKiteBoard => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no home');
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of opening.groups) {
    if (group.owner !== Bot) groups.set(arrow, group);
  }
  groups.set(home, { owner: Bot, heads: 8, spent: 0 });
  const base: GameState = { ...opening, groups, activePlayer: Bot, trails: new Map() };
  const vertices = [...base.spawners.keys()].toSorted((a, b) => {
    const da = specRemainingPath(restrictToVertex(base, a), Bot, a);
    const db = specRemainingPath(restrictToVertex(base, b), Bot, b);
    return da - db;
  });
  for (const vertex of vertices) {
    const origin = restrictToVertex(base, vertex);
    if (campaignTarget(geometry, origin, Bot) !== vertex) continue;
    const outbound = specRemainingPath(origin, Bot, vertex);
    if (outbound < 2 || outbound > 4) continue;
    const hit = boardFromOrigin(origin, Bot, true);
    if (hit !== undefined) return hit;
  }
  throw new Error('setup: no staging-close vs threatened-kite board');
};

export const unthreatenedShareWalkPosition = (): StagingKiteBoard => {
  const painted = afterFirstHomeMillClose();
  const fromPaint = boardFromOrigin(painted.state, painted.me, false);
  if (fromPaint !== undefined) return fromPaint;
  const threatened = stagingVsThreatenedKitePosition();
  const kiteArrows = specProjectedTrail(threatened.ctx, threatened.kite);
  const state = placeEnemyNear(threatened.state, threatened.Bot, kiteArrows, false);
  const ctx = specMissionContext(state, threatened.Bot);
  const kite: MissionPlan = {
    moves: threatened.kite.moves,
    state: foldPlan(state, threatened.kite.moves),
  };
  const staging: MissionPlan = {
    moves: threatened.staging.moves,
    state: foldPlan(state, threatened.staging.moves),
  };
  if (specIsThreatenedKite(ctx, kite)) {
    throw new Error('setup: unthreatened board still has a threatened kite');
  }
  return { ...threatened, state, ctx, kite, staging };
};

export type ReachableStagingBoard = {
  readonly quiet: { readonly state: GameState; readonly Bot: PlayerId; readonly plan: MissionPlan; readonly ctx: MissionContext };
  readonly underFire: { readonly state: GameState; readonly me: PlayerId };
};

export const enemyReachableStagingPosition = (): ReachableStagingBoard => {
  const pos = stagingVsThreatenedKitePosition();
  const arrows = specProjectedTrail(pos.ctx, pos.staging);
  const quietState = placeEnemyNear(pos.state, pos.Bot, arrows, true);
  const ctx = specMissionContext(quietState, pos.Bot);
  const plan: MissionPlan = { moves: pos.staging.moves, state: foldPlan(quietState, pos.staging.moves) };
  if (specIsStagingClose(ctx, plan)) {
    throw new Error('setup: reachable short close still classified as staging');
  }
  const { state: fire, me } = afterOpeningOpenTrailUnderFire();
  return {
    quiet: { state: quietState, Bot: pos.Bot, plan, ctx },
    underFire: { state: fire, me },
  };
};

export type CutDirtBoard = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly dirt: MissionPlan;
  readonly ctx: MissionContext;
  readonly enemyTrailAtOrigin: number;
};

export const cutVsDirtPosition = (): CutDirtBoard => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot, E } = botAndEnemy(opening);
  const cutter = 'tiling:a:1,5,1' as ArrowId;
  const cutExit = 'tiling:a:0,6,0' as ArrowId;
  const eTrail = [
    'tiling:a:0,5,1',
    'tiling:a:-1,6,0',
    'tiling:a:0,6,0',
    'tiling:a:1,6,0',
  ] as ArrowId[];
  const tip = eTrail[eTrail.length - 1];
  if (tip === undefined) throw new Error('setup: empty authored trail');
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no home');
  const groups = new Map<ArrowId, Group>([
    [cutter, { owner: Bot, heads: 2, spent: 0 }],
    [home, { owner: Bot, heads: 2, spent: 0 }],
    [tip, { owner: E, heads: 1, spent: 0 }],
  ]);
  const state: GameState = {
    ...opening,
    activePlayer: Bot,
    groups,
    trails: new Map([[E, new Set(eTrail)]]),
  };
  const cutMove = legalSteps(state).find((m) => m.from === cutter && m.exit === cutExit);
  if (cutMove === undefined) throw new Error('setup: authored cut is not legal');
  let afterCut: GameState;
  try {
    afterCut = rules.apply(state, cutMove);
  } catch {
    throw new Error('setup: authored cut does not apply');
  }
  if (!isCutMove(state, afterCut, Bot)) throw new Error('setup: authored cut is not a cut');
  if (trailSizeOf(state, Bot) !== 0) throw new Error('setup: Bot trail should be empty');
  const findings = originFindingsOf(state, Bot);
  if (!specCutAvailable(state, findings)) throw new Error('setup: origin findings lack a legal cut');
  const campaign = campaignTarget(geometry, state, Bot);
  const outbound = specRemainingPath(state, Bot, campaign);
  const dirt = trySidewaysDirt(state, Bot, campaign, outbound);
  const ctx = specMissionContext(state, Bot, findings);
  return {
    state,
    Bot,
    dirt: dirt ?? { moves: [endTurn()], state: foldPlan(state, [endTurn()]) },
    ctx,
    enemyTrailAtOrigin: trailSizeOf(state, E),
  };
};

const trySidewaysDirt = (
  origin: GameState,
  me: PlayerId,
  campaign: VertexId | undefined,
  outbound: number,
): MissionPlan | undefined => {
  const ctx: MissionContext = {
    geometry,
    rules,
    origin,
    me,
    campaign,
    outbound,
    originTerritory: originTerritoryKeys(origin, me),
    missions: specMissionsOf(origin, me, originFindingsOf(origin, me)),
    denyExit: specDenyExit(origin, me),
  };
  for (const first of legalSteps(origin)) {
    if (origin.territory.get(first.exit) === me) continue;
    let mid: GameState;
    try {
      mid = rules.apply(origin, first);
    } catch {
      continue;
    }
    if (mid.activePlayer !== me) continue;
    for (const second of legalSteps(mid)) {
      if (mid.territory.get(second.exit) !== me) continue;
      const plan = finishTurn(origin, me, [first, second]);
      if (specIsSidewaysDirt(ctx, plan) && specPlanHasStep(plan.moves)) return plan;
    }
  }
  return undefined;
};

export type LeastKiteBoard = {
  readonly withWalk: StagingKiteBoard & { readonly walk: MissionPlan };
  readonly onlyKites: { readonly state: GameState; readonly Bot: PlayerId; readonly ctx: MissionContext };
};

const tryStopShort = (
  origin: GameState,
  me: PlayerId,
  campaign: VertexId,
  outbound: number,
): MissionPlan | undefined => {
  const ctx: MissionContext = {
    geometry,
    rules,
    origin,
    me,
    campaign,
    outbound,
    originTerritory: originTerritoryKeys(origin, me),
    missions: ['contest'],
    denyExit: undefined,
  };
  const from = botTip(origin, me);
  if (from === undefined) return undefined;
  for (const move of legalSteps(origin)) {
    if (move.from !== from) continue;
    if (grainDistToVertex(move.exit, campaign) !== grainDistToVertex(move.from, campaign) - 1) {
      continue;
    }
    const plan = finishTurn(origin, me, [move]);
    if (specIsThreatenedKite(ctx, plan)) continue;
    if (specIsKite(ctx, plan)) continue;
    const dropped = specRemainingPath(plan.state, me, campaign) < outbound;
    const sharesUp = sharesOf(plan.state, me) > sharesOf(origin, me);
    if (dropped || sharesUp) return plan;
  }
  return undefined;
};

export const threatenedKiteNoStagingPosition = (): LeastKiteBoard => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no home');
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of opening.groups) {
    if (group.owner !== Bot) groups.set(arrow, group);
  }
  groups.set(home, { owner: Bot, heads: 8, spent: 0 });
  const base: GameState = { ...opening, groups, activePlayer: Bot, trails: new Map() };
  let painted: { state: GameState; me: PlayerId; campaign: VertexId; outbound: number } | undefined;
  for (const vertex of base.spawners.keys()) {
    const origin = restrictToVertex(base, vertex);
    if (campaignTarget(geometry, origin, Bot) !== vertex) continue;
    const outbound = specRemainingPath(origin, Bot, vertex);
    if (outbound < 2 || outbound > 4) continue;
    const quiet = isolateEnemyFar(origin, Bot);
    if (tryStagingFrom(quiet, Bot, vertex, outbound) !== undefined) continue;
    const kite = tryKiteWalk(quiet, Bot, vertex, outbound);
    if (kite === undefined) continue;
    painted = { state: quiet, me: Bot, campaign: vertex, outbound };
    break;
  }
  if (painted === undefined) throw new Error('setup: no kite-only campaign board');
  const campaign = painted.campaign;
  const outbound = painted.outbound;
  const kite = tryKiteWalk(painted.state, painted.me, campaign, outbound);
  const walk =
    tryStopShort(painted.state, painted.me, campaign, outbound) ??
    finishTurn(painted.state, painted.me, []);
  if (kite === undefined) throw new Error('setup: no kite walk');
  const kiteCtx: MissionContext = {
    geometry,
    rules,
    origin: painted.state,
    me: painted.me,
    campaign,
    outbound,
    originTerritory: originTerritoryKeys(painted.state, painted.me),
    missions: ['contest'],
    denyExit: undefined,
  };
  const kiteArrows = specProjectedTrail(kiteCtx, kite);
  const state = placeEnemyNear(painted.state, painted.me, kiteArrows, true);
  const ctx = specMissionContext(state, painted.me);
  const kitePlan: MissionPlan = { moves: kite.moves, state: foldPlan(state, kite.moves) };
  const walkPlan: MissionPlan = { moves: walk.moves, state: foldPlan(state, walk.moves) };
  if (!specIsThreatenedKite(ctx, kitePlan)) {
    throw new Error('setup: occupying walk is not a threatened kite');
  }
  if (specIsStagingClose(ctx, walkPlan) || specIsThreatenedKite(ctx, walkPlan)) {
    throw new Error('setup: stop-short is not a non-kite contest walk');
  }
  const staging = tryStagingFrom(state, painted.me, campaign, specRemainingPath(state, painted.me, campaign));
  const withWalk: StagingKiteBoard & { readonly walk: MissionPlan } = {
    state,
    Bot: painted.me,
    campaign,
    outbound: ctx.outbound,
    staging: staging ?? walkPlan,
    kite: kitePlan,
    ctx,
    walk: walkPlan,
  };
  const only = leastKiteOnlyBoard();
  return { withWalk, onlyKites: only };
};

const leastKiteOnlyBoard = (): {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly ctx: MissionContext;
} => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot, E } = botAndEnemy(opening);
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no home');
  for (const vertex of opening.spawners.keys()) {
    if ([...geometry.borderArrows(vertex)].every((a) => opening.territory.get(a) === Bot)) {
      continue;
    }
    const d = grainDistToVertex(home, vertex);
    if (d !== 1) continue;
    const groups = new Map<ArrowId, Group>();
    for (const [arrow, group] of opening.groups) {
      if (group.owner !== Bot && group.owner !== E) groups.set(arrow, group);
    }
    groups.set(home, { owner: Bot, heads: 2, spent: 0 });
    const origin: GameState = { ...opening, groups, activePlayer: Bot, trails: new Map() };
    const outbound = specRemainingPath(origin, Bot, vertex);
    if (outbound !== 1) continue;
    const kite = tryKiteWalk(origin, Bot, vertex, outbound, 3);
    if (kite === undefined) continue;
    const staging = tryStagingFrom(origin, Bot, vertex, outbound);
    if (staging !== undefined) continue;
    const ctx0: MissionContext = {
      geometry,
      rules,
      origin,
      me: Bot,
      campaign: vertex,
      outbound,
      originTerritory: originTerritoryKeys(origin, Bot),
      missions: ['contest'],
      denyExit: undefined,
    };
    const arrows = specProjectedTrail(ctx0, kite);
    const state = placeEnemyNear(origin, Bot, arrows, true);
    return { state, Bot, ctx: specMissionContext(state, Bot) };
  }
  throw new Error('setup: no outbound-1 threatened-kite-only board');
};

export const contestAdvancing = (ctx: MissionContext, plan: MissionPlan): boolean =>
  specRemainingPath(plan.state, ctx.me, ctx.campaign) < ctx.outbound ||
  sharesOf(plan.state, ctx.me) > sharesOf(ctx.origin, ctx.me);

export const firstDepartingStep = (
  start: GameState,
  plan: readonly Move[],
  me: PlayerId,
): StepMove | undefined => {
  let at = start;
  for (const move of plan) {
    if (move.kind === 'step' && at.territory.get(move.exit) !== me) return move;
    at = rules.apply(at, move);
  }
  return undefined;
};

export const enemyTrailSize = (state: GameState, me: PlayerId): number => {
  let n = 0;
  for (const [player, set] of state.trails) {
    if (player !== me) n += set.size;
  }
  return n;
};

export const planEndsWithEndTurn = (plan: readonly Move[]): boolean =>
  plan[plan.length - 1]?.kind === 'endTurn';

export { afterFirstHomeMillClose, afterOpeningOpenTrailUnderFire, boxOpenExitPosition };
