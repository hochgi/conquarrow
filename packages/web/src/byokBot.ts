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

/** Completion budget when the model is allowed to reason. */
export const BYOK_REASONING_MAX_TOKENS = 512;
/** Tiny budget when thinking is disabled. */
export const BYOK_FAST_MAX_TOKENS = 64;

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

/** Compact, JSON-serializable view for the prompt — not a rules DTO. */
export const snapshotForPrompt = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
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
  const interestingSpawners: {
    vertex: string;
    force: string;
    held: Record<string, number>;
    unclaimed: number;
  }[] = [];
  const spawnerEntries = [...state.spawners.entries()].toSorted((a, b) =>
    String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0,
  );
  for (const [vertex, spawner] of spawnerEntries) {
    const borders = [...geometry.borderArrows(vertex)].toSorted(compareArrows);
    const held: Record<string, number> = {};
    let unclaimed = 0;
    for (const arrow of borders) {
      const owner = state.territory.get(arrow);
      if (owner === undefined) {
        unclaimed += 1;
        continue;
      }
      const key = String(owner);
      held[key] = (held[key] ?? 0) + 1;
      shareCounts[key] = (shareCounts[key] ?? 0) + 1;
    }
    // Only surface contested / unclaimed / mine — not the whole radial field.
    const mine = (held[String(me)] ?? 0) > 0;
    const contested = Object.keys(held).length > 1 || (unclaimed > 0 && Object.keys(held).length > 0);
    if (!(mine || contested || unclaimed === 3)) continue;
    if (interestingSpawners.length < MAX_SPAWNER_ROWS) {
      interestingSpawners.push({
        vertex: String(vertex),
        force: forceKey(spawner.force),
        held,
        unclaimed,
      });
    }
  }

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
      if (gainedShare > 0) tags.push('share');
      if (bordersOpenSpawner(geometry, state, move.exit)) tags.push('borders_spawner');
      if (fromHome && !ontoHome) tags.push('leave_home');
      if (fromHome && ontoHome) tags.push('home_mill');
      if (d1 < d0) tags.push('homeward');
      else if (d1 > d0) tags.push('outward');
      if (ontoHome) tags.push('onto_home');
      if (tagOnTarget(move, targets)) tags.push('on_target');
      for (const [player, set] of state.trails) {
        if (player !== me && set.has(move.exit)) {
          tags.push('cut');
          break;
        }
      }
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
        `${leaveStr} spd=${String(portionSpd)} spent=${String(spent)}` +
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

const greedyBaselineLines = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  offer: readonly Move[],
): readonly string[] => {
  if (offer.length === 0) return [];
  const chosen = chooseMove(geometry, rules, state, me);
  if (chosen.kind !== 'step') return [];
  const index = offer.findIndex((entry) => movesEqual(entry, chosen));
  if (index < 0) return [];
  return [
    `A weak one-ply baseline would play \`[${String(index)}]\` (\`count=${String(chosen.count)} from=${String(chosen.from)} exit=${String(chosen.exit)}\`).`,
    'Suggestion only — you may return any ordered indices from this offer.',
  ];
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
  const baseline =
    rules === undefined ? [] : greedyBaselineLines(geometry, rules, state, me, moves);
  return [
    `Seat ${String(me)}. Return an ordered moves index array from this offer and set endTurn when this seat is done.`,
    `Shares=${String(myShares)}, trailLen=${String(trail)}.`,
    tipLines.length > 0 ? `Exposed tips: ${tipLines.join('; ')}` : 'Exposed tips: none',
    '',
    'STATE_JSON:',
    JSON.stringify(snapshotForPrompt(geometry, state, me)),
    '',
    'LEGAL_MOVES grouped by from (arrow id). Global [i]. count=heads in the portion; spd=speed(count) or merge override; spent=already walked on from, leftover keeps it; steps left this turn = spd-spent; leave=heads staying on from; tags=outcomes. endTurn is a flag, not a numbered row:',
    formatLegalMoves(moves, geometry, rules, state, me, targets),
    '',
    ...baseline,
    ...(baseline.length > 0 ? [''] : []),
    'Reply with only JSON: {"moves":[i,...],"endTurn":true|false,"why":"short"}',
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

/**
 * Live turn parse: JSON batch object only. No digit harvest, no last-match-wins,
 * no extract retry. Out-of-range integers stay and become illegal items at apply.
 */
export const parseMoveBatch = (text: string): ParsedMoveBatch | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(stripMarkdownFence(text));
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec['endTurn'] !== 'boolean') return undefined;
  const indices = integerIndices(rec['moves']);
  if (indices === undefined) return undefined;
  return { indices, endTurn: rec['endTurn'] };
};

/** Request body fields shared by move picks and the lobby probe. */
export const byokCompletionBody = (
  config: ByokConfig,
  messages: readonly { readonly role: string; readonly content: string }[],
  maxTokens?: number,
): Record<string, unknown> => {
  // Structured picks need thinking *off*: forcing enable_thinking dumps CoT into
  // content and models burn the whole budget mid-essay (finish_reason=length).
  // Strategy stays in the system prompt; optional `why` carries a short rationale.
  const tokens =
    maxTokens ?? (config.reasoning ? BYOK_REASONING_MAX_TOKENS : BYOK_FAST_MAX_TOKENS);
  return {
    model: config.model.trim(),
    temperature: 0,
    max_tokens: tokens,
    messages,
    response_format: { type: 'json_object' },
    chat_template_kwargs: BYOK_THINKING_OFF,
    extra_body: { chat_template_kwargs: BYOK_THINKING_OFF },
  };
};

interface ChatCompletionResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null;
      readonly reasoning_content?: string | null;
    };
  }[];
}

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
  | { readonly ok: true; readonly text: string }
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
  return { ok: true, text };
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
}

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
    return { state, moves: [], llmHits: 0, llmFallbacks: 0, lastError: undefined };
  }
  if (!isByokReady(config)) {
    const fallback = playBotTurn(geometry, rules, state, me);
    return { ...fallback, llmHits: 0, llmFallbacks: 0, lastError: 'byok not ready' };
  }

  const ctx: SeatTurnCtx = { geometry, rules, me };
  const moves: Move[] = [];
  let at = state;
  let completions = 0;
  let fellBack = false;
  let lastError: string | undefined;

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
    const parsed = parseMoveBatch(fetched.text);
    if (parsed === undefined) {
      lastError = `unusable model reply: ${JSON.stringify(fetched.text.slice(0, 240))}`;
      at = greedyRemainder(ctx, at, moves);
      fellBack = true;
      break;
    }
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
  };
};
