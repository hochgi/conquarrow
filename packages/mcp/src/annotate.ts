/**
 * BYOK row shape, threat line, and tip-local spawners — copied from web
 * `byokBot.ts`. Adapter only. No teaching file, no model call.
 */

import { speed } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { compareArrows } from '@conquarrow/rules-core';
import { closeUrgency, distanceToTerritory } from './botEvaluate';

export const MAX_LISTED_ARROWS = 24;
export const MAX_SPAWNER_ROWS = 12;

export const NAMED_OFFER_TAGS = ['cut', 'closes', 'borders_spawner'] as const;

export type OfferTagRow = {
  readonly index: number;
  readonly count: number;
  readonly tags: readonly string[];
};

export type ThreatLineInput = {
  readonly me: string;
  readonly players: readonly string[];
  readonly shares: Readonly<Record<string, number>>;
  readonly territory: Readonly<Record<string, number>>;
  readonly trailLen: Readonly<Record<string, number>>;
  readonly offerTags: readonly string[];
  readonly nearTrail: boolean;
  readonly dirtCloses?: boolean;
};

export type SpawnerRow = {
  readonly vertex: string;
  readonly force: string;
  readonly held: Record<string, number>;
  readonly unclaimed: number;
};

const forceKey = (f: { readonly num: number; readonly den: number }): string =>
  `${String(f.num)}/${String(f.den)}`;

const territoryCount = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner === player) n += 1;
  return n;
};

const shareCount = (geometry: GeometryPort, state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) {
      if (state.territory.get(arrow) === player) n += 1;
    }
  }
  return n;
};

const nearTrailOwner = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  exit: ArrowId,
): PlayerId | undefined => {
  const exitOrigin = geometry.origin(exit);
  const exitTarget = geometry.target(exit);
  for (const player of state.players) {
    if (player === me) continue;
    const trail = state.trails.get(player);
    if (trail === undefined) continue;
    for (const arrow of trail) {
      const origin = geometry.origin(arrow);
      const target = geometry.target(arrow);
      if (
        origin === exitOrigin ||
        origin === exitTarget ||
        target === exitOrigin ||
        target === exitTarget
      ) {
        return player;
      }
    }
  }
  return undefined;
};

const cutOrNearTrailTags = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  exit: ArrowId,
): readonly string[] => {
  for (const [player, trail] of state.trails) {
    if (player !== me && trail.has(exit)) return ['cut'];
  }
  const near = nearTrailOwner(geometry, state, me, exit);
  return near === undefined ? [] : [`near_trail:${String(near)}`];
};

const bordersOpenSpawner = (
  geometry: GeometryPort,
  state: GameState,
  exit: ArrowId,
): boolean => {
  for (const vertex of state.spawners.keys()) {
    const borders = geometry.borderArrows(vertex);
    let onSpawner = false;
    let open = false;
    for (const border of borders) {
      if (border === exit) onSpawner = true;
      if (state.territory.get(border) === undefined) open = true;
    }
    if (onSpawner && open) return true;
  }
  return false;
};

export const annotateMove = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  move: Move,
): string => {
  switch (move.kind) {
    case 'endTurn': {
      const trail = state.trails.get(me)?.size ?? 0;
      const shares = shareCount(geometry, state, me);
      const tags: string[] = [];
      if (trail >= 4) tags.push('exposed_trail');
      if (closeUrgency(trail) >= 36) tags.push('should_close_soon');
      if (shares === 0 && trail === 0) tags.push('no_shares_yet');
      const tagStr = tags.length > 0 ? ` tags=${tags.join(',')}` : '';
      return `endTurn trailLen=${String(trail)} shares=${String(shares)}${tagStr}`;
    }
    case 'step': {
      let after: GameState;
      try {
        after = rules.apply(state, move);
      } catch {
        return `step from=${String(move.from)} exit=${String(move.exit)} count=${String(move.count)} tags=illegal`;
      }
      const d0 = distanceToTerritory(geometry, state, me, move.from);
      const d1 = distanceToTerritory(geometry, state, me, move.exit);
      const trailAfter = after.trails.get(me)?.size ?? 0;
      const gainedTerr = territoryCount(after, me) - territoryCount(state, me);
      const gainedShare = shareCount(geometry, after, me) - shareCount(geometry, state, me);
      const fromHome = state.territory.get(move.from) === me;
      const ontoHome = state.territory.get(move.exit) === me;
      const tags: string[] = [];
      if (gainedTerr > 0) tags.push(gainedTerr === 1 ? 'land_bridge' : 'closes');
      if (gainedShare > 0) tags.push(`share+${String(gainedShare)}`);
      if (bordersOpenSpawner(geometry, state, move.exit)) tags.push('borders_spawner');
      if (fromHome && !ontoHome) tags.push('leave_home');
      if (fromHome && ontoHome) tags.push('home_mill');
      if (d1 < d0) tags.push('homeward');
      else if (d1 > d0) tags.push('outward');
      if (ontoHome) tags.push('onto_home');
      tags.push(...cutOrNearTrailTags(geometry, state, me, move.exit));
      const dest = state.groups.get(move.exit);
      if (dest !== undefined && dest.owner !== me) tags.push('combat');
      const fromGroup = state.groups.get(move.from);
      const fromHeads = fromGroup?.heads ?? move.count;
      const leave = fromHeads - move.count;
      const spent = fromGroup?.spent ?? 0;
      const override = fromGroup?.speedOverride;
      const portionSpd = override !== undefined ? override : speed(move.count);
      const leaveStr = leave > 0 ? ` leave=${String(leave)}` : '';
      return (
        `step from=${String(move.from)} exit=${String(move.exit)} count=${String(move.count)}` +
        `${leaveStr} spd=${String(portionSpd)} spent=${String(spent)} left=${String(portionSpd - spent)}` +
        ` tipDist=${String(d0)}→${String(d1)} trailLen=${String(trailAfter)}` +
        (tags.length > 0 ? ` tags=${tags.join(',')}` : '')
      );
    }
  }
};

const groupedStepEntries = (
  moves: readonly Move[],
): readonly { readonly index: number; readonly move: StepMove }[] => {
  const buckets = new Map<string, { index: number; move: StepMove }[]>();
  for (const [index, move] of moves.entries()) {
    if (move.kind !== 'step') continue;
    const from = String(move.from);
    const bucket = buckets.get(from);
    if (bucket === undefined) buckets.set(from, [{ index, move }]);
    else bucket.push({ index, move });
  }
  return [...buckets.values()].flat();
};

export const formatLegalMoves = (
  moves: readonly Move[],
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
): string =>
  groupedStepEntries(moves)
    .map(
      ({ index, move }) =>
        `[${String(index)}] ${annotateMove(geometry, rules, state, me, move)}`,
    )
    .join('\n');

export const tagsFromAnnotation = (annotation: string): readonly string[] => {
  const match = /\btags=(\S+)/.exec(annotation);
  return match?.[1] === undefined ? [] : match[1].split(',');
};

const SHARE_PLUS_N = /^share\+\d+$/;

const hasSharePlusN = (tags: readonly string[]): boolean =>
  tags.some((tag) => SHARE_PLUS_N.test(tag));

export const dirtClosesFromRows = (rows: readonly OfferTagRow[]): boolean => {
  let anyClose = false;
  for (const row of rows) {
    if (!row.tags.includes('closes')) continue;
    anyClose = true;
    if (hasSharePlusN(row.tags)) return false;
  }
  return anyClose;
};

export const offerTagRows = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  offer: readonly Move[],
): OfferTagRow[] => {
  const rows: OfferTagRow[] = [];
  for (const [index, move] of offer.entries()) {
    if (move.kind !== 'step') continue;
    rows.push({
      index,
      count: move.count,
      tags: tagsFromAnnotation(annotateMove(geometry, rules, state, me, move)),
    });
  }
  return rows;
};

const leadClause = (input: ThreatLineInput): string => {
  const seats = [...input.players].sort((a, b) => {
    const shareDiff = (input.shares[b] ?? 0) - (input.shares[a] ?? 0);
    if (shareDiff !== 0) return shareDiff;
    const terrDiff = (input.territory[b] ?? 0) - (input.territory[a] ?? 0);
    if (terrDiff !== 0) return terrDiff;
    return input.players.indexOf(a) - input.players.indexOf(b);
  });
  const parts = seats.map((id, i) => {
    const shares = input.shares[id] ?? 0;
    const terr = input.territory[id] ?? 0;
    return i === 0
      ? `${id} ${String(shares)} shares / ${String(terr)} terr`
      : `${id} ${String(shares)} / ${String(terr)}`;
  });
  return `Lead: ${parts.join('; ')}`;
};

const longestEnemyTrailClause = (input: ThreatLineInput): string => {
  let owner: string | undefined;
  let longest = 0;
  for (const id of input.players) {
    if (id === input.me) continue;
    const len = input.trailLen[id] ?? 0;
    if (owner === undefined || len > longest) {
      owner = id;
      longest = len;
    }
  }
  if (owner === undefined || longest === 0) return 'Longest enemy trail: none';
  return `Longest enemy trail: ${owner} ${String(longest)}`;
};

export const threatLineFromCounts = (input: ThreatLineInput): string => {
  const clauses: string[] = [leadClause(input), longestEnemyTrailClause(input)];
  const named = NAMED_OFFER_TAGS.filter((tag) => input.offerTags.includes(tag));
  if (named.length > 0) clauses.push(`Offer tags: ${named.join(', ')}`);
  if (!input.offerTags.includes('cut') && !input.offerTags.includes('closes')) {
    clauses.push('No cut/contest/deny row');
  }
  if (input.dirtCloses === true) clauses.push('closes without share+N (dirt)');
  if (!input.nearTrail) clauses.push('no enemy trail on a legal vertex');
  return clauses.join('. ');
};

const incidentArrows = (
  state: GameState,
  me: PlayerId,
  offer: readonly Move[] | undefined,
): ReadonlySet<ArrowId> => {
  const arrows = new Set<ArrowId>();
  for (const [arrow, group] of state.groups) {
    if (group.owner === me) arrows.add(arrow);
  }
  if (offer === undefined) return arrows;
  for (const move of offer) {
    if (move.kind === 'step') arrows.add(move.exit);
  }
  return arrows;
};

export const pickSpawnerRows = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  offer: readonly Move[] | undefined,
  shareCounts: Record<string, number>,
): SpawnerRow[] => {
  const incident = incidentArrows(state, me, offer);
  const interesting: (SpawnerRow & { readonly tier: 0 | 1 })[] = [];
  const spawnerEntries = [...state.spawners.entries()].toSorted((a, b) =>
    String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0,
  );
  for (const [vertex, spawner] of spawnerEntries) {
    const borders = [...geometry.borderArrows(vertex)].toSorted(compareArrows);
    const held: Record<string, number> = {};
    let unclaimed = 0;
    let touches = false;
    for (const arrow of borders) {
      if (incident.has(arrow)) touches = true;
      const owner = state.territory.get(arrow);
      if (owner === undefined) {
        unclaimed += 1;
        continue;
      }
      const key = String(owner);
      held[key] = (held[key] ?? 0) + 1;
      shareCounts[key] = (shareCounts[key] ?? 0) + 1;
    }
    const mine = (held[String(me)] ?? 0) > 0;
    const contested =
      Object.keys(held).length > 1 || (unclaimed > 0 && Object.keys(held).length > 0);
    if (!(mine || contested || unclaimed === 3)) continue;
    interesting.push({
      vertex: String(vertex),
      force: forceKey(spawner.force),
      held,
      unclaimed,
      tier: touches ? 0 : 1,
    });
  }
  interesting.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.vertex < b.vertex ? -1 : a.vertex > b.vertex ? 1 : 0;
  });
  return interesting.slice(0, MAX_SPAWNER_ROWS).map(({ vertex, force, held, unclaimed }) => ({
    vertex,
    force,
    held,
    unclaimed,
  }));
};

export const sortIds = (ids: readonly string[]): string[] =>
  [...ids].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export const truncateIds = (ids: readonly string[]): { ids: string[]; truncated: boolean } => {
  const sorted = sortIds(ids);
  if (sorted.length <= MAX_LISTED_ARROWS) return { ids: sorted, truncated: false };
  return { ids: sorted.slice(0, MAX_LISTED_ARROWS), truncated: true };
};
