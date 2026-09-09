/**
 * Optional LLM move chooser — adapter only (P15 / P61).
 *
 * The model never invents a move: one completion returns an ordered batch of
 * `legalMoves` step indices plus an `endTurn` flag. Empty prefix falls back to
 * frozen greedy-v1 for the rest of the seat-turn. Hits and fallbacks count
 * seat-turns, not steps.
 */

import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { endTurn, movesEqual, speed } from '@conquarrow/contracts';
import { compareArrows } from '@conquarrow/rules-core';
import { chooseTurnGreedy } from './botSearch';
import type { ByokConfig } from './byokConfig';
import {
  BYOK_CORS_HINT,
  BYOK_UPSTREAM_HEADER,
  chatCompletionsUrl,
  isByokReady,
  resolveByokProxyUrl,
} from './byokConfig';
import {
  chooseMove,
  closeUrgency,
  distanceToTerritory,
  playBotTurn,
  type BotTurn,
} from './opponent';
import type { Finding } from './findings';
import { advanceTargetLock, syncTargetLocks, tagOnTarget } from './targets';
import teachingBody from 'docs/byok-teaching.md?raw';

/** Completions cap (POSTs), not applied steps — a single batch may spend the offer. */
const MAX_COMPLETIONS_PER_TURN = 64;
const MAX_LISTED_ARROWS = 24;
/** Keep the board summary small — huge spawner dumps make models restate state until max_tokens. */
const MAX_SPAWNER_ROWS = 12;

/**
 * Reasoning models (Nemotron Ultra, etc.) need thinking on to play well.
 * Live turn parse is the batch JSON object, not a per-step index tag.
 */
export const BYOK_THINKING_ON = {
  enable_thinking: true,
  force_nonempty_content: true,
} as const;

export const BYOK_THINKING_OFF = {
  enable_thinking: false,
  force_nonempty_content: true,
} as const;

/** Completion budget when the lobby Reasoning flag is on. */
export const BYOK_REASONING_MAX_TOKENS = 4096;
/** Tiny budget when thinking is disabled. */
export const BYOK_FAST_MAX_TOKENS = 64;

const liveTurnMaxTokens = (config: ByokConfig): number =>
  config.reasoning ? BYOK_REASONING_MAX_TOKENS : BYOK_FAST_MAX_TOKENS;

const liveTurnThinking = (
  config: ByokConfig,
): typeof BYOK_THINKING_ON | typeof BYOK_THINKING_OFF =>
  config.reasoning ? BYOK_THINKING_ON : BYOK_THINKING_OFF;

export const buildSystemPrompt = (me: PlayerId, reasoning: boolean): string => {
  const role = reasoning
    ? `You are seat ${String(me)} in Conquarrow (territorial conquest on directed arrows).`
    : `You are seat ${String(me)} in Conquarrow.`;
  return `${role}
Pick an ordered moves index array from this offer; set endTurn when the seat is done.
${teachingBody}`;
};

/**
 * Moves shown to the model: engine `legalMoves` filtered to steps, same order.
 * `endTurn` is a flag on the reply, never an offer index.
 */
export const movesForLlm = (moves: readonly Move[]): readonly Move[] =>
  moves.filter((move): move is StepMove => move.kind === 'step');

const sortIds = (ids: readonly string[]): string[] =>
  [...ids].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const truncateIds = (ids: readonly string[]): { ids: string[]; truncated: boolean } => {
  const sorted = sortIds(ids);
  if (sorted.length <= MAX_LISTED_ARROWS) return { ids: sorted, truncated: false };
  return { ids: sorted.slice(0, MAX_LISTED_ARROWS), truncated: true };
};

const forceKey = (f: { readonly num: number; readonly den: number }): string =>
  `${String(f.num)}/${String(f.den)}`;

type SpawnerRow = {
  readonly vertex: string;
  readonly force: string;
  readonly held: Record<string, number>;
  readonly unclaimed: number;
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

const pickSpawnerRows = (
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
    const contested = Object.keys(held).length > 1 || (unclaimed > 0 && Object.keys(held).length > 0);
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

/** Compact, JSON-serializable view for the prompt — not a rules DTO. */
export const snapshotForPrompt = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  offer?: readonly Move[],
): unknown => {
  const groups = [...state.groups.entries()]
    .map(([arrow, g]) => ({
      arrow: String(arrow),
      owner: String(g.owner),
      heads: g.heads,
      spent: g.spent,
      speed: speed(g.heads),
      ...(g.speedOverride !== undefined ? { speedOverride: g.speedOverride } : {}),
    }))
    .toSorted((a, b) => (a.arrow < b.arrow ? -1 : a.arrow > b.arrow ? 1 : 0));

  const trails: Record<string, { count: number; sample: string[]; truncated: boolean }> = {};
  for (const [player, set] of state.trails) {
    const listed = truncateIds([...set].map(String));
    trails[String(player)] = {
      count: set.size,
      sample: listed.ids,
      truncated: listed.truncated,
    };
  }

  const territoryCounts: Record<string, number> = {};
  for (const owner of state.territory.values()) {
    const key = String(owner);
    territoryCounts[key] = (territoryCounts[key] ?? 0) + 1;
  }

  const shareCounts: Record<string, number> = {};
  for (const p of state.players) shareCounts[String(p)] = 0;
  const interestingSpawners = pickSpawnerRows(geometry, state, me, offer, shareCounts);

  return {
    me: String(me),
    players: state.players.map(String),
    activePlayer: String(state.activePlayer),
    winner: state.winner === undefined ? null : String(state.winner),
    starvationStreaks: state.players.map((player) => ({
      player: String(player),
      streak: state.starvationStreaks.get(player) ?? 0,
    })),
    dominationN: state.dominationN,
    groups,
    trails,
    territoryCounts,
    shareCounts,
    spawnerCount: state.spawners.size,
    spawnersShown: interestingSpawners.length,
    spawners: interestingSpawners,
  };
};

const territoryCount = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner === player) n += 1;
  return n;
};

const shareCount = (
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

/** Exit shares a movement point with an enemy-trail arrow (origin/target only). */
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

/** `cut` if the exit is on an enemy trail; else `near_trail:<seat>` on a shared point. */
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

/** Exit is a border arrow of a spawner that still has an unclaimed share. */
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

/** Compact tags so the model can rank without inventing geometry. */
export const annotateMove = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  move: Move,
  targets: readonly Finding[] = [],
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
      if (tagOnTarget(move, targets)) tags.push('on_target');
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

/** Group steps by `from` in first-seen-in-offer order; keep global `[i]`. */
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
  geometry?: GeometryPort,
  rules?: RulesPort,
  state?: GameState,
  me?: PlayerId,
  targets: readonly Finding[] = [],
): string =>
  groupedStepEntries(moves)
    .map(({ index, move }) => {
      const body =
        geometry !== undefined &&
        rules !== undefined &&
        state !== undefined &&
        me !== undefined
          ? annotateMove(geometry, rules, state, me, move, targets)
          : `step from=${String(move.from)} exit=${String(move.exit)} count=${String(move.count)}`;
      return `[${String(index)}] ${body}`;
    })
    .join('\n');

const tagsFromAnnotation = (annotation: string): readonly string[] => {
  const match = /\btags=(\S+)/.exec(annotation);
  return match?.[1] === undefined ? [] : match[1].split(',');
};

const offerTagRows = (
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

export const millOmit = (rows: readonly OfferTagRow[]): boolean => {
  if (rows.length === 0) return false;
  for (const row of rows) {
    const mill = row.tags.includes('home_mill') || row.tags.includes('onto_home');
    const expanding =
      row.tags.includes('closes') || row.tags.includes('cut') || row.tags.includes('leave_home');
    if (!mill || expanding) return false;
  }
  return true;
};

const baselineSentence = (index: number, step: StepMove): readonly string[] => [
  `A weak one-ply baseline would play \`[${String(index)}]\` (\`count=${String(step.count)} from=${String(step.from)} exit=${String(step.exit)}\`).`,
  'Suggestion only — you may return any ordered indices from this offer.',
];

const greedyBaselineLines = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  offer: readonly Move[],
  rows: readonly OfferTagRow[],
): readonly string[] => {
  if (offer.length === 0) return [];
  const tagged = baselineIndexFromTags(rows);
  if (tagged !== undefined) {
    const step = offer[tagged];
    if (step !== undefined && step.kind === 'step') return baselineSentence(tagged, step);
  }
  if (millOmit(rows)) return [];
  const chosen = chooseMove(geometry, rules, state, me);
  if (chosen.kind !== 'step') return [];
  const index = offer.findIndex((entry) => movesEqual(entry, chosen));
  if (index < 0) return [];
  return baselineSentence(index, chosen);
};

/** LEGAL_MOVES row facts for P64 baseline / full-stack helpers. */
export type OfferTagRow = {
  readonly index: number;
  readonly count: number;
  readonly tags: readonly string[];
};

/** Inputs for the one-line threat header (BSSN 4). */
export type ThreatLineInput = {
  readonly me: string;
  readonly players: readonly string[];
  readonly shares: Readonly<Record<string, number>>;
  readonly territory: Readonly<Record<string, number>>;
  readonly trailLen: Readonly<Record<string, number>>;
  readonly offerTags: readonly string[];
  readonly nearTrail: boolean;
};

/** Usable batch plus optional `plan` key, read beside `asUsableBatch`. */
export type ByokPlanBatch = {
  readonly moves: readonly number[];
  readonly endTurn: boolean;
  readonly plan?: unknown;
};

const NAMED_OFFER_TAGS = ['cut', 'closes', 'borders_spawner'] as const;

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
  if (!input.nearTrail) clauses.push('no enemy trail on a legal vertex');
  return clauses.join('. ');
};

export const baselineIndexFromTags = (rows: readonly OfferTagRow[]): number | undefined => {
  let best: OfferTagRow | undefined;
  for (const row of rows) {
    if (!row.tags.includes('cut') && !row.tags.includes('closes')) continue;
    if (
      best === undefined ||
      row.count > best.count ||
      (row.count === best.count && row.index < best.index)
    ) {
      best = row;
    }
  }
  return best?.index;
};

export const isFullStackClose = (
  batch: { readonly moves: readonly number[]; readonly endTurn?: boolean },
  rows: readonly OfferTagRow[] = [],
): boolean => {
  const first = batch.moves[0];
  if (first === undefined) return false;
  let maxCount = 0;
  let anyClose = false;
  for (const row of rows) {
    if (!row.tags.includes('closes')) continue;
    anyClose = true;
    if (row.count > maxCount) maxCount = row.count;
  }
  if (!anyClose) return false;
  const named = rows.find((row) => row.index === first);
  return named !== undefined && named.tags.includes('closes') && named.count === maxCount;
};

const PLAN_MAX = 80;
const byokPlans = new Map<PlayerId, string>();

const sanitizePlan = (plan: string): string => {
  const cleaned = plan.replace(/[\n\r]/g, '').trim();
  return cleaned.length <= PLAN_MAX ? cleaned : cleaned.slice(0, PLAN_MAX);
};

export const clearByokPlans = (): void => {
  byokPlans.clear();
};

export const rememberByokPlan = (me: PlayerId, batch: ByokPlanBatch): void => {
  if (batch.moves.length === 0 && batch.endTurn) {
    byokPlans.delete(me);
    return;
  }
  if (typeof batch.plan !== 'string') return;
  const sanitized = sanitizePlan(batch.plan);
  if (sanitized.length === 0) {
    byokPlans.delete(me);
    return;
  }
  byokPlans.set(me, sanitized);
};

const seatCountMaps = (
  geometry: GeometryPort,
  state: GameState,
): {
  readonly shares: Record<string, number>;
  readonly territory: Record<string, number>;
  readonly trailLen: Record<string, number>;
} => {
  const shares: Record<string, number> = {};
  const territory: Record<string, number> = {};
  const trailLen: Record<string, number> = {};
  for (const player of state.players) {
    const id = String(player);
    shares[id] = shareCount(geometry, state, player);
    territory[id] = territoryCount(state, player);
    trailLen[id] = state.trails.get(player)?.size ?? 0;
  }
  return { shares, territory, trailLen };
};

const collectedOfferTags = (rows: readonly OfferTagRow[]): string[] => {
  const present = new Set<string>();
  for (const row of rows) {
    for (const tag of row.tags) present.add(tag);
  }
  return NAMED_OFFER_TAGS.filter((tag) => present.has(tag));
};

const nearTrailFromRows = (rows: readonly OfferTagRow[]): boolean => {
  for (const row of rows) {
    for (const tag of row.tags) {
      if (tag === 'cut' || tag.startsWith('near_trail:')) return true;
    }
  }
  return false;
};

export const buildUserPrompt = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  moves: readonly Move[],
  _reasoning: boolean,
  rules?: RulesPort,
  targets: readonly Finding[] = [],
): string => {
  const trail = state.trails.get(me)?.size ?? 0;
  const myShares = shareCount(geometry, state, me);
  const tipLines: string[] = [];
  for (const [arrow, group] of [...state.groups.entries()].toSorted((a, b) =>
    String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0,
  )) {
    if (group.owner !== me) continue;
    if (!(state.trails.get(me)?.has(arrow) ?? false)) continue;
    tipLines.push(
      `${String(arrow)} tipDist=${String(distanceToTerritory(geometry, state, me, arrow))} heads=${String(group.heads)}`,
    );
  }
  const rows =
    rules === undefined ? [] : offerTagRows(geometry, rules, state, me, moves);
  const counts = seatCountMaps(geometry, state);
  const threat = threatLineFromCounts({
    me: String(me),
    players: state.players.map(String),
    shares: counts.shares,
    territory: counts.territory,
    trailLen: counts.trailLen,
    offerTags: collectedOfferTags(rows),
    nearTrail: nearTrailFromRows(rows),
  });
  const storedPlan = byokPlans.get(me);
  const planEcho = storedPlan === undefined ? [] : [`Plan: ${storedPlan}`];
  const baseline =
    rules === undefined ? [] : greedyBaselineLines(geometry, rules, state, me, moves, rows);
  return [
    `Seat ${String(me)}. Return an ordered moves index array from this offer and set endTurn when this seat is done.`,
    `Shares=${String(myShares)}, trailLen=${String(trail)}.`,
    tipLines.length > 0 ? `Exposed tips: ${tipLines.join('; ')}` : 'Exposed tips: none',
    threat,
    ...planEcho,
    '',
    'STATE_JSON:',
    JSON.stringify(snapshotForPrompt(geometry, state, me, moves)),
    '',
    'LEGAL_MOVES grouped by from (arrow id). Global [i]. count=heads in the portion; spd=speed(count) or merge override; spent=already walked on from, leftover keeps it; steps left this turn = spd-spent; leave=heads staying on from; tags=outcomes. endTurn is a flag, not a numbered row:',
    formatLegalMoves(moves, geometry, rules, state, me, targets),
    '',
    ...baseline,
    ...(baseline.length > 0 ? [''] : []),
    'Reply with only JSON: {"moves":[i,...],"endTurn":true|false,"why":"short","plan":"short"}',
  ].join('\n');
};
export interface ParsedMoveBatch {
  readonly indices: readonly number[];
  readonly endTurn: boolean;
}

const stripMarkdownFence = (text: string): string => {
  const trimmed = text.trim();
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) return trimmed;
  const first = lines[0]?.trim() ?? '';
  const last = lines[lines.length - 1]?.trim() ?? '';
  if (!/^```(?:json)?$/i.test(first) || last !== '```') return trimmed;
  return lines.slice(1, -1).join('\n').trim();
};

const integerIndices = (moves: unknown): number[] | undefined => {
  if (!Array.isArray(moves)) return undefined;
  const indices: number[] = [];
  for (const entry of moves) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) return undefined;
    indices.push(entry);
  }
  return indices;
};

export const asUsableBatch = (value: unknown): ParsedMoveBatch | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec['endTurn'] !== 'boolean') return undefined;
  const indices = integerIndices(rec['moves']);
  if (indices === undefined) return undefined;
  return { indices, endTurn: rec['endTurn'] };
};

const tryJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Brace-depth walk; `{` inside strings/escapes is not a start. Nested objects included. */
const collectJsonObjectSlices = (text: string): string[] => {
  const slices: string[] = [];
  const starts: number[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      starts.push(i);
      continue;
    }
    if (ch === '}') {
      const start = starts.pop();
      if (start === undefined) continue;
      slices.push(text.slice(start, i + 1));
    }
  }
  return slices;
};

interface ParsedBatchResult {
  readonly batch: ParsedMoveBatch;
  readonly salvaged: boolean;
  readonly plan: unknown;
}

const planKeyOf = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)['plan'];
};

const lastUsableFromSlices = (stripped: string): ParsedBatchResult | undefined => {
  const slices = collectJsonObjectSlices(stripped);
  for (let i = slices.length - 1; i >= 0; i -= 1) {
    const slice = slices[i];
    if (slice === undefined) continue;
    const value = tryJsonParse(slice);
    const batch = asUsableBatch(value);
    if (batch !== undefined) return { batch, salvaged: true, plan: planKeyOf(value) };
  }
  return undefined;
};

/**
 * Live turn parse: usable batch JSON only. Whole-string first; else last usable
 * object from a brace walk. No digit harvest, no extract retry.
 */
const parseMoveBatchResult = (text: string): ParsedBatchResult | undefined => {
  const stripped = stripMarkdownFence(text);
  const wholeValue = tryJsonParse(stripped);
  const whole = asUsableBatch(wholeValue);
  if (whole !== undefined) return { batch: whole, salvaged: false, plan: planKeyOf(wholeValue) };
  return lastUsableFromSlices(stripped);
};

export const parseMoveBatch = (text: string): ParsedMoveBatch | undefined =>
  parseMoveBatchResult(text)?.batch;

/** Metadata only — never quote model content or reasoning_content. */
const unusableReplyError = (text: string): string => {
  const stripped = stripMarkdownFence(text);
  return `unusable model reply (chars=${String(stripped.length)}, objects=${String(collectJsonObjectSlices(stripped).length)})`;
};

/** Request body fields shared by move picks and the lobby probe. */
export const byokCompletionBody = (
  config: ByokConfig,
  messages: readonly { readonly role: string; readonly content: string }[],
  maxTokens?: number,
  thinking?: typeof BYOK_THINKING_ON | typeof BYOK_THINKING_OFF,
): Record<string, unknown> => {
  const tokens = maxTokens ?? liveTurnMaxTokens(config);
  const kwargs = thinking ?? liveTurnThinking(config);
  return {
    model: config.model.trim(),
    temperature: 0,
    max_tokens: tokens,
    messages,
    response_format: { type: 'json_object' },
    chat_template_kwargs: kwargs,
    extra_body: { chat_template_kwargs: kwargs },
  };
};

interface ChatCompletionResponse {
  readonly choices?: readonly {
    readonly finish_reason?: unknown;
    readonly message?: {
      readonly content?: string | null;
      readonly reasoning_content?: string | null;
    };
  }[];
  readonly finish_reason?: unknown;
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
  };
}

const recordNumber = (rec: Record<string, unknown>, key: string): number => {
  const value = rec[key];
  return typeof value === 'number' ? value : 0;
};

const finishReasonOf = (body: Record<string, unknown>): string | undefined => {
  const choices = body['choices'];
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  if (typeof first === 'object' && first !== null) {
    const choiceReason = (first as Record<string, unknown>)['finish_reason'];
    if (typeof choiceReason === 'string') return choiceReason;
  }
  const top = body['finish_reason'];
  return typeof top === 'string' ? top : undefined;
};

const completionUsage = (
  body: unknown,
): {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly lengthOut: boolean;
} => {
  if (typeof body !== 'object' || body === null) {
    return { promptTokens: 0, completionTokens: 0, lengthOut: false };
  }
  const rec = body as Record<string, unknown>;
  const usage = rec['usage'];
  const usageRec = typeof usage === 'object' && usage !== null ? (usage as Record<string, unknown>) : {};
  const reason = finishReasonOf(rec);
  return {
    promptTokens: recordNumber(usageRec, 'prompt_tokens'),
    completionTokens: recordNumber(usageRec, 'completion_tokens'),
    lengthOut: reason === 'length' || reason === 'max_tokens',
  };
};

const extractReplyText = (body: ChatCompletionResponse): string => {
  const message = body.choices?.[0]?.message;
  if (message === undefined) return '';
  const content = typeof message.content === 'string' ? message.content : '';
  const reasoning =
    typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
  if (content.trim().length > 0) return content;
  return reasoning;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type LlmBatchFetchResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly promptTokens: number;
      readonly completionTokens: number;
      readonly lengthOut: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/** POST chat/completions via optional same-origin / player-owned CORS relay. */
export const postChatCompletions = (
  config: ByokConfig,
  body: unknown,
  fetchImpl: FetchLike = fetch,
): Promise<Response> => {
  const upstream = chatCompletionsUrl(config.baseUrl);
  const proxy = resolveByokProxyUrl(config);
  const url = proxy.length > 0 ? proxy : upstream;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey.trim()}`,
  };
  if (proxy.length > 0) headers[BYOK_UPSTREAM_HEADER] = upstream;
  return fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
};

/**
 * One chat/completions POST. No extract retry, no /v1/pick, no conversation history.
 */
export const fetchLlmMoveBatch = async (
  config: ByokConfig,
  prompt: string,
  me: PlayerId,
  fetchImpl: FetchLike = fetch,
): Promise<LlmBatchFetchResult> => {
  if (!isByokReady(config)) return { ok: false, reason: 'byok not ready' };
  const messages = [
    { role: 'system', content: buildSystemPrompt(me, config.reasoning) },
    { role: 'user', content: prompt },
  ];
  let response: Response;
  try {
    response = await postChatCompletions(config, byokCompletionBody(config, messages), fetchImpl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error';
    const via = resolveByokProxyUrl(config);
    return {
      ok: false,
      reason:
        via.length === 0 ? `fetch failed: ${msg} (${BYOK_CORS_HINT})` : `fetch failed: ${msg}`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: `HTTP ${String(response.status)} from ${chatCompletionsUrl(config.baseUrl)}`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'response was not JSON' };
  }
  const text = extractReplyText(body as ChatCompletionResponse);
  if (text.trim().length === 0) {
    return { ok: false, reason: 'missing choices[0].message.content' };
  }
  const usage = completionUsage(body);
  return {
    ok: true,
    text,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    lengthOut: usage.lengthOut,
  };
};

/** Tiny probe so the lobby can verify base URL + key + model before a match. */
export type ByokProbeResult =
  | { readonly ok: true; readonly sample: string }
  | { readonly ok: false; readonly reason: string };

export const testByokConnection = async (
  config: ByokConfig,
  fetchImpl: FetchLike = fetch,
): Promise<ByokProbeResult> => {
  if (!isByokReady(config)) {
    return { ok: false, reason: 'fill base URL, API key, and model first' };
  }
  let response: Response;
  try {
    response = await postChatCompletions(
      config,
      byokCompletionBody(
        config,
        [
          {
            role: 'system',
            content: 'Reply ONLY with JSON: {"move":0,"why":"probe"}',
          },
          { role: 'user', content: 'Return {"move":0,"why":"probe"}' },
        ],
        64,
        BYOK_THINKING_OFF,
      ),
      fetchImpl,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error';
    const via = resolveByokProxyUrl(config);
    return {
      ok: false,
      reason:
        via.length === 0
          ? `fetch failed: ${msg} (${BYOK_CORS_HINT})`
          : `fetch failed: ${msg}`,
    };
  }
  if (!response.ok) {
    let detail = '';
    try {
      const errBody: unknown = await response.json();
      if (typeof errBody === 'object' && errBody !== null) {
        detail = ` · ${JSON.stringify(errBody).slice(0, 240)}`;
      }
    } catch {
      // ignore body parse
    }
    return {
      ok: false,
      reason: `HTTP ${String(response.status)} from ${chatCompletionsUrl(config.baseUrl)}${detail}`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'response was not JSON' };
  }
  if (typeof body === 'object' && body !== null && 'error' in body) {
    return {
      ok: false,
      reason: `HTTP ${String(response.status)} · ${JSON.stringify(body).slice(0, 240)}`,
    };
  }
  const text = extractReplyText(body as ChatCompletionResponse);
  const sample = text.trim().length > 0 ? text.trim().slice(0, 40) : 'HTTP 200';
  return { ok: true, sample };
};

export interface LlmBotTurn extends BotTurn {
  readonly llmHits: number;
  readonly llmFallbacks: number;
  readonly lastError: string | undefined;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly lengthOuts?: number;
  readonly salvageParses?: number;
  readonly maxTokens?: number;
}

const ZERO_TURN_STATS = {
  promptTokens: 0,
  completionTokens: 0,
  lengthOuts: 0,
  salvageParses: 0,
  maxTokens: 0,
} as const;

interface SeatTurnCtx {
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
  readonly me: PlayerId;
}

const recordApplied = (ctx: SeatTurnCtx, move: Move, moves: Move[]): void => {
  advanceTargetLock(ctx.me, move, ctx.geometry);
  moves.push(move);
};

const forceEndTurn = (ctx: SeatTurnCtx, at: GameState, moves: Move[]): GameState => {
  if (at.winner !== undefined || at.activePlayer !== ctx.me) return at;
  const forced = endTurn();
  const next = ctx.rules.apply(at, forced);
  recordApplied(ctx, forced, moves);
  return next;
};

const greedyRemainder = (ctx: SeatTurnCtx, at: GameState, moves: Move[]): GameState => {
  const remainder = chooseTurnGreedy(ctx.geometry, ctx.rules, at, ctx.me);
  let now = at;
  for (const move of remainder) {
    now = ctx.rules.apply(now, move);
    recordApplied(ctx, move, moves);
  }
  return now;
};

const stepIsLegalNow = (rules: RulesPort, state: GameState, move: Move): boolean =>
  rules.legalMoves(state).some((offered) => movesEqual(offered, move));

interface MappedPrefix {
  readonly at: GameState;
  readonly applied: readonly Move[];
  readonly illegalIndices: readonly number[];
}

const applyMappedPrefix = (
  rules: RulesPort,
  at: GameState,
  offer: readonly Move[],
  indices: readonly number[],
): MappedPrefix => {
  const applied: Move[] = [];
  const illegalIndices: number[] = [];
  let now = at;
  let stopped = false;
  for (const index of indices) {
    if (now.winner !== undefined) break;
    if (stopped) {
      illegalIndices.push(index);
      continue;
    }
    const mapped = index >= 0 ? offer[index] : undefined;
    if (mapped === undefined || !stepIsLegalNow(rules, now, mapped)) {
      stopped = true;
      illegalIndices.push(index);
      continue;
    }
    now = rules.apply(now, mapped);
    applied.push(mapped);
  }
  return { at: now, applied, illegalIndices };
};

const commitPrefix = (ctx: SeatTurnCtx, mapped: MappedPrefix, moves: Move[]): GameState => {
  for (const move of mapped.applied) recordApplied(ctx, move, moves);
  return mapped.at;
};

type AfterPrefix =
  | {
      readonly kind: 'stop';
      readonly at: GameState;
      readonly lastError: string | undefined;
      readonly fellBack: boolean;
    }
  | { readonly kind: 'continue'; readonly at: GameState; readonly lastError: string | undefined };

const afterPrefix = (
  ctx: SeatTurnCtx,
  parsed: ParsedMoveBatch,
  mapped: MappedPrefix,
  moves: Move[],
): AfterPrefix => {
  const at = mapped.at;
  const tailError =
    mapped.illegalIndices.length > 0
      ? `illegal tail indices: ${mapped.illegalIndices.join(', ')}`
      : undefined;
  if (at.winner !== undefined) {
    return { kind: 'stop', at, lastError: tailError, fellBack: false };
  }
  if (mapped.applied.length === 0) {
    if (parsed.endTurn && mapped.illegalIndices.length === 0) {
      return {
        kind: 'stop',
        at: forceEndTurn(ctx, at, moves),
        lastError: tailError,
        fellBack: false,
      };
    }
    return {
      kind: 'stop',
      at: greedyRemainder(ctx, at, moves),
      lastError: tailError,
      fellBack: true,
    };
  }
  if (mapped.illegalIndices.length > 0) {
    return { kind: 'continue', at, lastError: tailError };
  }
  const remaining = movesForLlm(ctx.rules.legalMoves(at));
  if (remaining.length === 0 || parsed.endTurn) {
    return {
      kind: 'stop',
      at: forceEndTurn(ctx, at, moves),
      lastError: tailError,
      fellBack: false,
    };
  }
  return { kind: 'continue', at, lastError: tailError };
};

export const playLlmBotTurn = async (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  config: ByokConfig,
  fetchImpl: FetchLike = fetch,
): Promise<LlmBotTurn> => {
  if (state.activePlayer !== me || state.winner !== undefined) {
    return { state, moves: [], llmHits: 0, llmFallbacks: 0, lastError: undefined, ...ZERO_TURN_STATS };
  }
  if (!isByokReady(config)) {
    const fallback = playBotTurn(geometry, rules, state, me);
    return {
      ...fallback,
      llmHits: 0,
      llmFallbacks: 0,
      lastError: 'byok not ready',
      ...ZERO_TURN_STATS,
    };
  }

  const ctx: SeatTurnCtx = { geometry, rules, me };
  const moves: Move[] = [];
  let at = state;
  let completions = 0;
  let fellBack = false;
  let lastError: string | undefined;
  let promptTokens = 0;
  let completionTokens = 0;
  let lengthOuts = 0;
  let salvageParses = 0;

  while (at.winner === undefined && at.activePlayer === me) {
    const offer = movesForLlm(rules.legalMoves(at));
    if (offer.length === 0 || completions >= MAX_COMPLETIONS_PER_TURN) {
      at = forceEndTurn(ctx, at, moves);
      break;
    }
    if (completions === 7) console.warn('BYOK batch turn: 8th completion this seat-turn');
    completions += 1;
    const targets = syncTargetLocks(geometry, rules, at, me);
    const prompt = buildUserPrompt(geometry, at, me, offer, config.reasoning, rules, targets);
    const fetched = await fetchLlmMoveBatch(config, prompt, me, fetchImpl);
    if (!fetched.ok) {
      lastError = fetched.reason;
      at = greedyRemainder(ctx, at, moves);
      fellBack = true;
      break;
    }
    promptTokens += fetched.promptTokens;
    completionTokens += fetched.completionTokens;
    if (fetched.lengthOut) lengthOuts += 1;
    const parsedResult = parseMoveBatchResult(fetched.text);
    if (parsedResult === undefined) {
      lastError = unusableReplyError(fetched.text);
      at = greedyRemainder(ctx, at, moves);
      fellBack = true;
      break;
    }
    if (parsedResult.salvaged) salvageParses += 1;
    const parsed = parsedResult.batch;
    rememberByokPlan(me, {
      moves: parsed.indices,
      endTurn: parsed.endTurn,
      ...(parsedResult.plan !== undefined ? { plan: parsedResult.plan } : {}),
    });
    const mapped = applyMappedPrefix(rules, at, offer, parsed.indices);
    at = commitPrefix(ctx, mapped, moves);
    const decision = afterPrefix(ctx, parsed, mapped, moves);
    at = decision.at;
    if (decision.lastError !== undefined) lastError = decision.lastError;
    if (decision.kind === 'stop') {
      if (decision.fellBack) fellBack = true;
      break;
    }
  }

  if (at.winner === undefined && at.activePlayer === me) {
    at = forceEndTurn(ctx, at, moves);
  }
  return {
    state: at,
    moves,
    llmHits: fellBack ? 0 : 1,
    llmFallbacks: fellBack ? 1 : 0,
    lastError,
    promptTokens,
    completionTokens,
    lengthOuts,
    salvageParses,
    maxTokens: completions > 0 ? liveTurnMaxTokens(config) : 0,
  };
};
