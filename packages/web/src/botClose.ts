/**
 * Close-value arithmetic for the local heuristic (P54 / P55 / P57). Adapter
 * only — not a game rule. {@link exposure} is trail damage under the worst
 * enemy reply. {@link campaignTarget} is a search-origin fact, not GameState.
 *
 * Pure: no clocks, no RNG, no I/O.
 */

import { speed } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  PlayerId,
  RulesPort,
  VertexId,
} from '@conquarrow/contracts';
import { evaluate, grainDistanceToAny, homewardPath } from './botEvaluate';
import { exposureForBot } from './botReply';

export const SHARE_VALUE_S = 100;
export const ARROW_VALUE_A = 25;

/** Same as findings `DEFAULT_FINDINGS_CAPS.distCap`; do not import findings. */
const CAMPAIGN_DIST_CAP = 12;

/** P58 clones this; P57 ships identity weights. */
export type BotDrive = {
  readonly shareLoot: number;
  readonly arrowLoot: number;
  readonly campaignPull: number;
  readonly bankUnderFire: number;
};

export const BOT_DRIVE: BotDrive = {
  shareLoot: 1,
  arrowLoot: 1,
  campaignPull: 1,
  bankUnderFire: 1,
};

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export type CloseCandidate = {
  readonly shares: number;
  readonly arrows: number;
  readonly turnsToClose: number;
  readonly exposure: number;
  readonly goal?: string;
  readonly hitsCampaign?: boolean;
  readonly advancesCampaign?: boolean;
};

export type CloseLoot = {
  readonly shares: number;
  readonly arrows: number;
  readonly hitsCampaign: boolean;
  readonly advancesCampaign: boolean;
};

export const shareTerm = (shares: number): number =>
  (SHARE_VALUE_S * shares * (shares + 1)) / 2;

export const loot = (shares: number, arrows: number): number =>
  shareTerm(shares) * BOT_DRIVE.shareLoot + arrows * ARROW_VALUE_A * BOT_DRIVE.arrowLoot;

export const turnsToClose = (grainDist: number, heads: number): number =>
  Math.max(1, Math.ceil(grainDist / speed(heads)));

export const survival = (exposure: number, turnsToClose: number): number =>
  (1 + exposure) ** -Math.max(0, turnsToClose - 1);

export const closeValue = (
  shares: number,
  arrows: number,
  turnsToClose: number,
  exposure: number,
): number => {
  const T = Math.max(1, turnsToClose);
  return (loot(shares, arrows) / T) * survival(exposure, T);
};

export const isDirtClose = (candidate: {
  readonly shares: number;
  readonly hitsCampaign: boolean;
  readonly advancesCampaign: boolean;
}): boolean =>
  candidate.shares === 0 && !candidate.hitsCampaign && !candidate.advancesCampaign;

/**
 * Four-argument {@link closeValue} stays the ungated P54 rate.
 * Dirt-gated ranking value (BSSN 17 / 21).
 */
export const gatedCloseValue = (
  shares: number,
  arrows: number,
  turnsToClose: number,
  exposure: number,
  flags: {
    readonly hitsCampaign: boolean;
    readonly advancesCampaign: boolean;
  },
): number => {
  const dirt = isDirtClose({ shares, ...flags });
  if (dirt && (exposure === 0 || BOT_DRIVE.bankUnderFire === 0)) return 0;
  return closeValue(shares, arrows, turnsToClose, exposure);
};

const ownSharesOf = (
  geometry: GeometryPort,
  state: GameState,
  vertex: VertexId,
  me: PlayerId,
): number => {
  let n = 0;
  for (const arrow of [...geometry.borderArrows(vertex)].toSorted((a, b) =>
    compareIds(String(a), String(b)),
  )) {
    if (state.territory.get(arrow) === me) n += 1;
  }
  return n;
};

const grainDistToVertex = (
  geometry: GeometryPort,
  from: ArrowId,
  vertex: VertexId,
  cap: number,
): number =>
  grainDistanceToAny(
    geometry,
    from,
    [...geometry.borderArrows(vertex)].toSorted((a, b) =>
      compareIds(String(a), String(b)),
    ),
    cap,
  );

const ownGroupArrows = (state: GameState, me: PlayerId): ArrowId[] =>
  [...state.groups.entries()]
    .filter(([, group]) => group.owner === me)
    .map(([arrow]) => arrow)
    .toSorted((a, b) => compareIds(String(a), String(b)));

const campaignStack: (VertexId | undefined)[] = [];

/** Bind the search-origin campaign for the duration of one chooseTurn. */
export const enterCampaignOrigin = (vertex: VertexId | undefined): void => {
  campaignStack.push(vertex);
};

export const leaveCampaignOrigin = (): void => {
  campaignStack.pop();
};

const computeCampaignTarget = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  distCap: number,
): VertexId | undefined => {
  const groups = ownGroupArrows(state, me);
  if (groups.length === 0) return undefined;
  let best: VertexId | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  const vertices = [...state.spawners.keys()].toSorted((a, b) =>
    compareIds(String(a), String(b)),
  );
  for (const vertex of vertices) {
    const own = ownSharesOf(geometry, state, vertex, me);
    if (own >= 3) continue;
    const spawner = state.spawners.get(vertex);
    if (spawner === undefined) continue;
    let dist = distCap + 1;
    for (const from of groups) {
      const d = grainDistToVertex(geometry, from, vertex, distCap);
      if (d < dist) dist = d;
    }
    const score = ((spawner.force.num / spawner.force.den) * (3 - own)) / Math.max(1, dist);
    if (
      best === undefined ||
      score > bestScore ||
      (score === bestScore && compareIds(String(vertex), String(best)) < 0)
    ) {
      best = vertex;
      bestScore = score;
    }
  }
  return best;
};

/** Search-origin campaign vertex (BSSN 16). */
export const campaignTarget = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  distCap = CAMPAIGN_DIST_CAP,
): VertexId | undefined => {
  if (campaignStack.length > 0 && distCap === CAMPAIGN_DIST_CAP) {
    return campaignStack[campaignStack.length - 1];
  }
  return computeCampaignTarget(geometry, state, me, distCap);
};

const bordersSpawner = (
  geometry: GeometryPort,
  state: GameState,
  arrow: ArrowId,
): boolean => geometry.flankVertices(arrow).some((vertex) => state.spawners.has(vertex));

export const exposure = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  distCap?: number,
): number =>
  exposureForBot(
    geometry,
    rules,
    state,
    me,
    distCap,
    (s) => evaluate(geometry, s, me, rules),
  );

export const estimateCloseLoot = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  tip: ArrowId,
  campaign?: VertexId,
): CloseLoot => {
  const claimed = new Set<ArrowId>();
  const trail = state.trails.get(me);
  if (trail !== undefined) {
    for (const arrow of trail) {
      if (state.territory.get(arrow) !== me) claimed.add(arrow);
    }
  }
  const home = homewardPath(geometry, state, me, tip);
  for (const arrow of home.path) claimed.add(arrow);
  if (state.territory.get(tip) !== me) claimed.add(tip);
  let shares = 0;
  for (const arrow of claimed) {
    if (bordersSpawner(geometry, state, arrow)) shares += 1;
  }
  const vertex = campaign ?? campaignTarget(geometry, state, me);
  const none = { hitsCampaign: false, advancesCampaign: false } as const;
  if (vertex === undefined || home.landing === undefined) {
    return { shares, arrows: claimed.size, ...none };
  }
  const borderKeys = new Set(
    [...geometry.borderArrows(vertex)].map((arrow) => String(arrow)),
  );
  let hitsCampaign = false;
  for (const arrow of claimed) {
    if (borderKeys.has(String(arrow))) {
      hitsCampaign = true;
      break;
    }
  }
  return {
    shares,
    arrows: claimed.size,
    hitsCampaign,
    advancesCampaign:
      grainDistToVertex(geometry, home.landing, vertex, CAMPAIGN_DIST_CAP) <
      grainDistToVertex(geometry, tip, vertex, CAMPAIGN_DIST_CAP),
  };
};

const rankingValue = (candidate: CloseCandidate): number => {
  if (candidate.hitsCampaign === undefined && candidate.advancesCampaign === undefined) {
    return closeValue(
      candidate.shares,
      candidate.arrows,
      candidate.turnsToClose,
      candidate.exposure,
    );
  }
  return gatedCloseValue(
    candidate.shares,
    candidate.arrows,
    candidate.turnsToClose,
    candidate.exposure,
    {
      hitsCampaign: candidate.hitsCampaign ?? false,
      advancesCampaign: candidate.advancesCampaign ?? false,
    },
  );
};

export const preferClose = (a: CloseCandidate, b: CloseCandidate): number => {
  const va = rankingValue(a);
  const vb = rankingValue(b);
  if (va !== vb) return vb - va;
  if (a.turnsToClose !== b.turnsToClose) return a.turnsToClose - b.turnsToClose;
  if (a.arrows !== b.arrows) return b.arrows - a.arrows;
  if (a.shares !== b.shares) return b.shares - a.shares;
  return compareIds(a.goal ?? '', b.goal ?? '');
};
