/**
 * Seat-scoped observation — locked keys, not raw GameState.
 */

import { speed } from '@conquarrow/contracts';
import type {
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { makeLayout } from '@conquarrow/geometry-tiling';
import {
  NAMED_OFFER_TAGS,
  dirtClosesFromRows,
  offerTagRows,
  pickSpawnerRows,
  threatLineFromCounts,
  truncateIds,
  type SpawnerRow,
} from './annotate';
import { distanceToTerritory } from './botEvaluate';
import { collectFindings } from './findings';

const findingsLayout = makeLayout();

export type SeatId = string;

export type LongestEnemyTrail = {
  readonly seat: SeatId;
  readonly length: number;
  readonly sample: readonly string[];
};

export type FindingMove = {
  readonly kind: 'step';
  readonly from: string;
  readonly exit: string;
  readonly count: number;
};

export type FindingView = {
  readonly kind: string;
  readonly from: string;
  readonly goal: string;
  readonly cost: number;
  readonly reward: number;
  readonly score: number;
  readonly move: FindingMove;
};

export type GroupView = {
  readonly arrow: string;
  readonly heads: number;
  readonly spent: number;
  readonly speed: number;
};

export type TipView = {
  readonly arrow: string;
  readonly heads: number;
  readonly tipDist: number;
};

export type Observation = {
  readonly me: SeatId;
  readonly activePlayer: SeatId;
  readonly winner: SeatId | null;
  readonly shareCounts: Readonly<Record<string, number>>;
  readonly territoryCounts: Readonly<Record<string, number>>;
  readonly starvationStreaks: Readonly<Record<string, number>>;
  readonly myGroups: readonly GroupView[];
  readonly exposedTips: readonly TipView[];
  readonly threatLine: string;
  readonly offerTags: readonly string[];
  readonly longestEnemyTrail: LongestEnemyTrail | null;
  readonly spawnersNearTips: readonly SpawnerRow[];
  readonly findings: readonly FindingView[];
};

export type ToolPayload = Observation;

const asPlayer = (seat: string): PlayerId => seat as PlayerId;

const stepKey = (move: StepMove): string =>
  `${String(move.from)}|${String(move.exit)}|${String(move.count)}`;

const longestEnemyTrailOf = (state: GameState, me: string): LongestEnemyTrail | null => {
  let best: LongestEnemyTrail | null = null;
  for (const player of state.players) {
    const id = String(player);
    if (id === me) continue;
    const trail = state.trails.get(player);
    const length = trail?.size ?? 0;
    if (length === 0) continue;
    if (best !== null && length <= best.length) continue;
    const listed = truncateIds([...(trail ?? [])].map(String));
    best = { seat: id, length, sample: listed.ids };
  }
  return best;
};

const countsFor = (
  state: GameState,
): {
  readonly territory: Record<string, number>;
  readonly starvation: Record<string, number>;
} => {
  const territory: Record<string, number> = {};
  const starvation: Record<string, number> = {};
  for (const player of state.players) {
    const id = String(player);
    territory[id] = 0;
    starvation[id] = state.starvationStreaks.get(player) ?? 0;
  }
  for (const owner of state.territory.values()) {
    const key = String(owner);
    territory[key] = (territory[key] ?? 0) + 1;
  }
  return { territory, starvation };
};

const myGroupsOf = (state: GameState, me: PlayerId): readonly GroupView[] =>
  [...state.groups.entries()]
    .filter(([, group]) => group.owner === me)
    .map(([arrow, group]) => ({
      arrow: String(arrow),
      heads: group.heads,
      spent: group.spent,
      speed: group.speedOverride !== undefined ? group.speedOverride : speed(group.heads),
    }))
    .toSorted((a, b) => (a.arrow < b.arrow ? -1 : a.arrow > b.arrow ? 1 : 0));

const exposedTipsOf = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
): readonly TipView[] => {
  const trail = state.trails.get(me);
  if (trail === undefined) return [];
  const tips: TipView[] = [];
  for (const [arrow, group] of state.groups) {
    if (group.owner !== me || !trail.has(arrow)) continue;
    tips.push({
      arrow: String(arrow),
      heads: group.heads,
      tipDist: distanceToTerritory(geometry, state, me, arrow),
    });
  }
  return tips.toSorted((a, b) => (a.arrow < b.arrow ? -1 : a.arrow > b.arrow ? 1 : 0));
};

const findingsFor = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  active: boolean,
  legal: readonly Move[],
): readonly FindingView[] => {
  if (!active) return [];
  const legalKeys = new Set(
    legal.filter((move): move is StepMove => move.kind === 'step').map(stepKey),
  );
  return collectFindings(geometry, rules, state, me, undefined, findingsLayout)
    .filter((finding) => legalKeys.has(stepKey(finding.move)))
    .map((finding) => ({
      kind: finding.kind,
      from: String(finding.from),
      goal: String(finding.goal),
      cost: finding.cost,
      reward: finding.reward,
      score: finding.score,
      move: {
        kind: 'step' as const,
        from: String(finding.move.from),
        exit: String(finding.move.exit),
        count: finding.move.count,
      },
    }));
};

export const observeSeat = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  seat: string,
): Observation => {
  const me = asPlayer(seat);
  const active = String(state.activePlayer) === seat;
  const offer = active ? rules.legalMoves(state) : [];
  const shareCounts: Record<string, number> = {};
  for (const player of state.players) shareCounts[String(player)] = 0;
  const spawnersNearTips = pickSpawnerRows(
    geometry,
    state,
    me,
    active ? offer : undefined,
    shareCounts,
  );
  const { territory, starvation } = countsFor(state);
  const rows = active ? offerTagRows(geometry, rules, state, me, offer) : [];
  const named = NAMED_OFFER_TAGS.filter((tag) => rows.some((row) => row.tags.includes(tag)));
  const dirt = dirtClosesFromRows(rows);
  const offerTags = dirt ? [...named, 'dirt-closes'] : [...named];
  const longestEnemyTrail = longestEnemyTrailOf(state, seat);
  const trailForLine: Record<string, number> = {};
  for (const player of state.players) trailForLine[String(player)] = 0;
  if (longestEnemyTrail !== null) {
    trailForLine[longestEnemyTrail.seat] = longestEnemyTrail.length;
  }
  const threatLine = threatLineFromCounts({
    me: seat,
    players: state.players.map(String),
    shares: shareCounts,
    territory,
    trailLen: trailForLine,
    offerTags: named,
    nearTrail:
      offerTags.includes('cut') || offerTags.some((tag) => tag.startsWith('near_trail:')),
    ...(dirt ? { dirtCloses: true } : {}),
  });
  return {
    me: seat,
    activePlayer: String(state.activePlayer),
    winner: state.winner === undefined ? null : String(state.winner),
    shareCounts,
    territoryCounts: territory,
    starvationStreaks: starvation,
    myGroups: myGroupsOf(state, me),
    exposedTips: exposedTipsOf(geometry, state, me),
    threatLine,
    offerTags,
    longestEnemyTrail,
    spawnersNearTips,
    findings: findingsFor(geometry, rules, state, me, active, offer),
  };
};
