/**
 * Mission menu and staging/kite predicates for the local heuristic (P59).
 * Adapter only — not a game rule. Pure: no clocks, no RNG, no I/O.
 */

import { movesEqual, speed } from '@conquarrow/contracts';
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
import { campaignTarget, exposure } from './botClose';
import {
  distanceToTerritory,
  grainDistanceToAny,
  homewardPath,
} from './botEvaluate';
import { DEFAULT_REPLY_DIST_CAP, hypothesiseChair } from './botReply';

export type MissionKind = 'bank' | 'cut' | 'contest' | 'deny';

export const KITE_RATIO = 2;
export const CAMPAIGN_DIST_CAP = 12;

/** `collectFindings` origin cache — kinds + moves only. Must not import findings. */
export type OriginFinding = {
  readonly kind: string;
  readonly move: Move;
};

/**
 * Frozen per live `chooseTurnBeam` call, not stored on GameState (BSSN 5 / 13).
 */
export type MissionContext = {
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
  readonly origin: GameState;
  readonly me: PlayerId;
  readonly campaign: VertexId | undefined;
  readonly outbound: number;
  readonly originTerritory: ReadonlySet<string>;
  readonly missions: readonly MissionKind[];
  readonly denyExit: ArrowId | undefined;
};

export type MissionPlan = {
  readonly moves: readonly Move[];
  readonly state: GameState;
};

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareArrows = (a: ArrowId, b: ArrowId): number => compareIds(String(a), String(b));

const comparePlayers = (a: PlayerId, b: PlayerId): number => compareIds(String(a), String(b));

const trailSize = (state: GameState, player: PlayerId): number =>
  state.trails.get(player)?.size ?? 0;

const planHasStep = (moves: readonly Move[]): boolean => moves.some((m) => m.kind === 'step');

const territoryKeys = (state: GameState, me: PlayerId): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const [arrow, owner] of state.territory) {
    if (owner === me) keys.add(String(arrow));
  }
  return keys;
};

const bordersOf = (geometry: GeometryPort, vertex: VertexId): ArrowId[] =>
  [...geometry.borderArrows(vertex)].toSorted(compareArrows);

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

const countShares = (geometry: GeometryPort, state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) {
      if (state.territory.get(arrow) === player) n += 1;
    }
  }
  return n;
};

const grainDistToCampaign = (
  geometry: GeometryPort,
  from: ArrowId,
  campaign: VertexId,
): number => grainDistanceToAny(geometry, from, bordersOf(geometry, campaign), CAMPAIGN_DIST_CAP);

const trailTips = (state: GameState, me: PlayerId): ArrowId[] => {
  const trail = state.trails.get(me);
  if (trail === undefined || trail.size === 0) return [];
  const tips: ArrowId[] = [];
  for (const [arrow, group] of state.groups) {
    if (group.owner === me && trail.has(arrow)) tips.push(arrow);
  }
  return tips.toSorted(compareArrows);
};

const occupiesCampaignBorder = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  campaign: VertexId | undefined,
): boolean => {
  if (campaign === undefined) return false;
  const borders = new Set(bordersOf(geometry, campaign).map(String));
  for (const [arrow, group] of state.groups) {
    if (group.owner === me && borders.has(String(arrow))) return true;
  }
  return false;
};

const stepExitsFrom = (
  rules: RulesPort,
  state: GameState,
  from: ArrowId,
  owner: PlayerId,
): ArrowId[] => {
  const seen = new Set<string>();
  const out: ArrowId[] = [];
  for (const move of rules.legalMoves(hypothesiseChair(state, owner))) {
    if (move.kind !== 'step' || move.from !== from) continue;
    const key = String(move.exit);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(move.exit);
  }
  return out.toSorted(compareArrows);
};

const weCanStepOnto = (rules: RulesPort, state: GameState, exit: ArrowId): boolean => {
  for (const move of rules.legalMoves(state)) {
    if (move.kind === 'step' && move.exit === exit) return true;
  }
  return false;
};

/** P55 box open arrow, or undefined. Ties: lesser enemy PlayerId, then lesser O. */
export const denyExitOf = (rules: RulesPort, state: GameState, me: PlayerId): ArrowId | undefined => {
  const enemies = [...state.players].filter((p) => p !== me).toSorted(comparePlayers);
  let bestO: ArrowId | undefined;
  let bestEnemy: PlayerId | undefined;
  for (const enemy of enemies) {
    for (const [arrow, group] of state.groups) {
      if (group.owner !== enemy || group.heads !== 1) continue;
      const exits = stepExitsFrom(rules, state, arrow, enemy);
      const open = exits.filter((o) => state.territory.get(o) !== me);
      if (open.length !== 1) continue;
      const O = open[0];
      if (O === undefined) continue;
      if (!weCanStepOnto(rules, state, O)) continue;
      if (
        bestO === undefined ||
        bestEnemy === undefined ||
        comparePlayers(enemy, bestEnemy) < 0 ||
        (enemy === bestEnemy && compareArrows(O, bestO) < 0)
      ) {
        bestO = O;
        bestEnemy = enemy;
      }
    }
  }
  return bestO;
};

const boxedFromForExit = (
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  openExit: ArrowId,
): { readonly enemy: PlayerId; readonly from: ArrowId } | undefined => {
  const enemies = [...state.players].filter((p) => p !== me).toSorted(comparePlayers);
  for (const enemy of enemies) {
    for (const [arrow, group] of state.groups) {
      if (group.owner !== enemy || group.heads !== 1) continue;
      const exits = stepExitsFrom(rules, state, arrow, enemy);
      const open = exits.filter((o) => state.territory.get(o) !== me);
      if (open.length === 1 && open[0] === openExit) return { enemy, from: arrow };
    }
  }
  return undefined;
};

const cutAvailable = (
  rules: RulesPort,
  state: GameState,
  findings: readonly OriginFinding[],
): boolean => {
  const legal = rules.legalMoves(state);
  return findings.some(
    (f) =>
      (f.kind === 'cut' || f.kind === 'attack') && legal.some((m) => movesEqual(m, f.move)),
  );
};

export const remainingPath = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  campaign: VertexId | undefined,
): number => {
  if (campaign === undefined) return CAMPAIGN_DIST_CAP + 1;
  const borders = bordersOf(geometry, campaign);
  let best = CAMPAIGN_DIST_CAP + 1;
  for (const from of ownFromSet(state, me)) {
    const d = grainDistanceToAny(geometry, from, borders, CAMPAIGN_DIST_CAP);
    if (d < best) best = d;
  }
  return best;
};

export const kiteLength = (
  geometry: GeometryPort,
  terminal: GameState,
  me: PlayerId,
  originTerritory: ReadonlySet<string>,
): number => {
  if (trailSize(terminal, me) === 0) return 0;
  let best = 0;
  for (const tip of trailTips(terminal, me)) {
    const d = homewardPath(geometry, terminal, me, tip, CAMPAIGN_DIST_CAP, originTerritory)
      .distance;
    if (d > best) best = d;
  }
  return best;
};

export const missionsOf = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  originFindings: readonly OriginFinding[],
): readonly MissionKind[] => {
  const V = campaignTarget(geometry, state, me);
  const underFire = trailSize(state, me) > 0 && exposure(geometry, rules, state, me) > 0;
  const missions: MissionKind[] = [];
  if (underFire) missions.push('bank');
  if (cutAvailable(rules, state, originFindings)) missions.push('cut');
  if (missions.length === 0) missions.push('contest');
  if (denyExitOf(rules, state, me) !== undefined && missions.length < 3 && !missions.includes('bank')) {
    missions.push('deny');
  }
  const capped = missions.slice(0, 3);
  if (V === undefined && capped.includes('contest')) {
    const dropped = capped.filter((m) => m !== 'contest');
    return dropped.length === 0 ? ['contest'] : dropped;
  }
  return capped;
};

export const originTerritoryOf = (state: GameState, me: PlayerId): ReadonlySet<string> =>
  territoryKeys(state, me);

const projectedTrail = (ctx: MissionContext, plan: MissionPlan): ArrowId[] => {
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
    for (const arrow of homewardPath(
      ctx.geometry,
      plan.state,
      ctx.me,
      tip,
      CAMPAIGN_DIST_CAP,
      ctx.originTerritory,
    ).path) {
      add(arrow);
    }
  }
  return out.toSorted(compareArrows);
};

const enemyCanReach = (ctx: MissionContext, arrows: readonly ArrowId[]): boolean => {
  if (arrows.length === 0) return false;
  for (const [from, group] of ctx.origin.groups) {
    if (group.owner === ctx.me) continue;
    if (grainDistanceToAny(ctx.geometry, from, arrows, DEFAULT_REPLY_DIST_CAP) <= DEFAULT_REPLY_DIST_CAP) {
      return true;
    }
  }
  return false;
};

export const isKite = (ctx: MissionContext, plan: MissionPlan): boolean => {
  if (!ctx.missions.includes('contest')) return false;
  const gained = countShares(ctx.geometry, plan.state, ctx.me) > countShares(ctx.geometry, ctx.origin, ctx.me);
  const onBorder = occupiesCampaignBorder(ctx.geometry, plan.state, ctx.me, ctx.campaign);
  if (!gained && !onBorder) return false;
  const len = kiteLength(ctx.geometry, plan.state, ctx.me, ctx.originTerritory);
  return len >= KITE_RATIO * Math.max(1, ctx.outbound);
};

export const isThreatenedKite = (ctx: MissionContext, plan: MissionPlan): boolean =>
  isKite(ctx, plan) && enemyCanReach(ctx, projectedTrail(ctx, plan));

export const isStagingClose = (ctx: MissionContext, plan: MissionPlan): boolean => {
  if (countShares(ctx.geometry, plan.state, ctx.me) !== countShares(ctx.geometry, ctx.origin, ctx.me)) {
    return false;
  }
  if (trailSize(plan.state, ctx.me) !== 0) return false;
  if (remainingPath(ctx.geometry, plan.state, ctx.me, ctx.campaign) >= ctx.outbound) return false;
  if (isThreatenedKite(ctx, plan)) return false;
  if (enemyCanReach(ctx, projectedTrail(ctx, plan))) return false;
  return planHasStep(plan.moves);
};

export const isSidewaysDirt = (ctx: MissionContext, plan: MissionPlan): boolean =>
  countShares(ctx.geometry, plan.state, ctx.me) === countShares(ctx.geometry, ctx.origin, ctx.me) &&
  trailSize(plan.state, ctx.me) === 0 &&
  remainingPath(ctx.geometry, plan.state, ctx.me, ctx.campaign) >= ctx.outbound;

const findingMatches = (
  findings: readonly OriginFinding[],
  kinds: readonly string[],
  step: StepMove,
): boolean => {
  for (const f of findings) {
    if (!kinds.includes(f.kind) || f.move.kind !== 'step') continue;
    if (f.move.from === step.from && f.move.exit === step.exit) return true;
  }
  return false;
};

const shrinksHomeDistance = (
  geometry: GeometryPort,
  parent: GameState,
  child: GameState,
  me: PlayerId,
  step: StepMove,
): boolean => {
  if (distanceToTerritory(geometry, child, me, step.exit) < distanceToTerritory(geometry, parent, me, step.from)) {
    return true;
  }
  for (const [arrow, group] of child.groups) {
    if (group.owner !== me || arrow === step.exit) continue;
    if (distanceToTerritory(geometry, child, me, arrow) < distanceToTerritory(geometry, parent, me, arrow)) {
      return true;
    }
  }
  return false;
};

const onPathToCampaign = (geometry: GeometryPort, arrow: ArrowId, campaign: VertexId): boolean =>
  grainDistToCampaign(geometry, arrow, campaign) <= CAMPAIGN_DIST_CAP;

const raisesPathSpeed = (
  ctx: MissionContext,
  parent: GameState,
  step: StepMove,
  child: GameState,
): boolean => {
  if (ctx.campaign === undefined) return false;
  const fromGroup = parent.groups.get(step.from);
  if (fromGroup === undefined || fromGroup.owner !== ctx.me) return false;
  const dest = parent.groups.get(step.exit);
  const isSplit = step.count < fromGroup.heads;
  const isMerge = dest !== undefined && dest.owner === ctx.me;
  if (!isSplit && !isMerge) return false;
  const parentSpeed = (arrow: ArrowId): number | undefined => {
    const group = parent.groups.get(arrow);
    if (group === undefined || group.owner !== ctx.me) return undefined;
    return speed(group.heads);
  };
  for (const [arrow, group] of child.groups) {
    if (group.owner !== ctx.me) continue;
    if (!onPathToCampaign(ctx.geometry, arrow, ctx.campaign)) continue;
    const prev = parentSpeed(arrow) ?? (arrow === step.exit ? parentSpeed(step.from) : undefined);
    if (prev !== undefined && speed(group.heads) > prev) return true;
  }
  return false;
};

const shortestTowardV = (ctx: MissionContext, step: StepMove): boolean => {
  if (ctx.campaign === undefined) return false;
  const dFrom = grainDistToCampaign(ctx.geometry, step.from, ctx.campaign);
  const dExit = grainDistToCampaign(ctx.geometry, step.exit, ctx.campaign);
  return dExit === dFrom - 1;
};

const onBankStep = (
  ctx: MissionContext,
  parent: GameState,
  step: StepMove,
  child: GameState,
  findings: readonly OriginFinding[],
): boolean => {
  if (findingMatches(findings, ['close_path', 'close'], step)) return true;
  if (shrinksHomeDistance(ctx.geometry, parent, child, ctx.me, step)) return true;
  if (trailSize(child, ctx.me) < trailSize(parent, ctx.me)) return true;
  return (
    trailSize(child, ctx.me) === 0 &&
    countShares(ctx.geometry, child, ctx.me) === countShares(ctx.geometry, parent, ctx.me)
  );
};

const onContestStepFull = (
  ctx: MissionContext,
  parent: GameState,
  step: StepMove,
  child: GameState,
  findings: readonly OriginFinding[],
): boolean => {
  if (findingMatches(findings, ['close_path', 'close'], step)) return true;
  if (parent.trails.get(ctx.me)?.has(step.from) === true) return true;
  if (shortestTowardV(ctx, step)) return true;
  const fromGroup = parent.groups.get(step.from);
  if (fromGroup !== undefined && fromGroup.owner === ctx.me && step.count < fromGroup.heads) {
    return true;
  }
  if (raisesPathSpeed(ctx, parent, step, child)) return true;
  if (occupiesCampaignBorder(ctx.geometry, child, ctx.me, ctx.campaign)) return true;
  return isStagingClose(ctx, { moves: [step], state: child });
};

export const onMissionStep = (
  ctx: MissionContext,
  parent: GameState,
  step: StepMove,
  child: GameState,
  parentFindings: readonly OriginFinding[] = [],
): boolean => {
  for (const mission of ctx.missions) {
    if (mission === 'bank' && onBankStep(ctx, parent, step, child, parentFindings)) return true;
    if (mission === 'cut' && findingMatches(parentFindings, ['cut', 'attack'], step)) return true;
    if (mission === 'contest' && onContestStepFull(ctx, parent, step, child, parentFindings)) {
      return true;
    }
    if (mission === 'deny' && ctx.denyExit !== undefined && step.exit === ctx.denyExit) return true;
  }
  return false;
};

const servesBank = (ctx: MissionContext, plan: MissionPlan): boolean => {
  const originTrail = trailSize(ctx.origin, ctx.me);
  if (trailSize(plan.state, ctx.me) < originTrail) return true;
  if (originTrail === 0) return false;
  return (
    exposure(ctx.geometry, ctx.rules, plan.state, ctx.me) <
    exposure(ctx.geometry, ctx.rules, ctx.origin, ctx.me)
  );
};

const servesCut = (ctx: MissionContext, plan: MissionPlan): boolean => {
  const enemies = [...ctx.origin.players].filter((p) => p !== ctx.me).toSorted(comparePlayers);
  for (const enemy of enemies) {
    if (trailSize(plan.state, enemy) < trailSize(ctx.origin, enemy)) return true;
  }
  return false;
};

const servesContest = (ctx: MissionContext, plan: MissionPlan): boolean => {
  if (isThreatenedKite(ctx, plan)) return false;
  const dropped =
    remainingPath(ctx.geometry, plan.state, ctx.me, ctx.campaign) < ctx.outbound;
  const sharesUp =
    countShares(ctx.geometry, plan.state, ctx.me) > countShares(ctx.geometry, ctx.origin, ctx.me);
  return dropped || sharesUp || isStagingClose(ctx, plan);
};

const servesDeny = (ctx: MissionContext, plan: MissionPlan): boolean => {
  if (ctx.denyExit === undefined) return false;
  const boxed = boxedFromForExit(ctx.rules, ctx.origin, ctx.me, ctx.denyExit);
  if (boxed === undefined) return false;
  const before = stepExitsFrom(ctx.rules, ctx.origin, boxed.from, boxed.enemy).length;
  const after = stepExitsFrom(ctx.rules, plan.state, boxed.from, boxed.enemy).length;
  return after < before;
};

export const servesMission = (
  ctx: MissionContext,
  plan: MissionPlan,
  mission: MissionKind,
): boolean => {
  switch (mission) {
    case 'bank':
      return servesBank(ctx, plan);
    case 'cut':
      return servesCut(ctx, plan);
    case 'contest':
      return servesContest(ctx, plan);
    case 'deny':
      return servesDeny(ctx, plan);
  }
};
