/**
 * Slim P59 predicates that `collectFindings` calls. Adapter copy — not a game
 * rule. Beam helpers stay in web; MCP does not lift `chooseTurnBeam`.
 */

import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  VertexId,
} from '@conquarrow/contracts';
import { grainDistanceToAny } from './botEvaluate';

export const CAMPAIGN_DIST_CAP = 12;

export type MissionContext = {
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
  readonly origin: GameState;
  readonly me: PlayerId;
  readonly campaign: VertexId | undefined;
  readonly outbound: number;
  readonly originTerritory: ReadonlySet<string>;
  readonly missions: readonly string[];
  readonly denyExit: ArrowId | undefined;
};

export type MissionPlan = {
  readonly moves: readonly Move[];
  readonly state: GameState;
};

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareArrows = (a: ArrowId, b: ArrowId): number => compareIds(String(a), String(b));

const trailSize = (state: GameState, player: PlayerId): number =>
  state.trails.get(player)?.size ?? 0;

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

export const originTerritoryOf = (state: GameState, me: PlayerId): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const [arrow, owner] of state.territory) {
    if (owner === me) keys.add(String(arrow));
  }
  return keys;
};

export const isSidewaysDirt = (ctx: MissionContext, plan: MissionPlan): boolean =>
  countShares(ctx.geometry, plan.state, ctx.me) ===
    countShares(ctx.geometry, ctx.origin, ctx.me) &&
  trailSize(plan.state, ctx.me) === 0 &&
  remainingPath(ctx.geometry, plan.state, ctx.me, ctx.campaign) >= ctx.outbound;
