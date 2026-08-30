/**
 * Optional LLM move chooser — adapter only (P15).
 *
 * The model never invents a move: it picks an index from an exhaustive
 * `legalMoves` list. Failures fall back to the heuristic `chooseMove`, and the
 * caller can see how often that happened (silent fallback hid bugs in playtest).
 */

import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
} from '@conquarrow/contracts';
import { endTurn, speed } from '@conquarrow/contracts';
import { compareArrows } from '@conquarrow/rules-core';
import type { ByokConfig } from './byokConfig';
import {
  BYOK_CORS_HINT,
  BYOK_UPSTREAM_HEADER,
  chatCompletionsUrl,
  isByokReady,
  resolveByokProxyUrl,
  resolveTurnRunnerUrl,
} from './byokConfig';
import { chooseMove, closeUrgency, distanceToTerritory, playBotTurn, type BotTurn } from './opponent';
import type { Finding } from './findings';
import {
  advanceTargetLock,
  formatTargetsForPrompt,
  syncTargetLocks,
  tagOnTarget,
} from './targets';

const MAX_MOVES_PER_TURN = 64;
const MAX_LISTED_ARROWS = 24;
/** Keep the board summary small — huge spawner dumps make models restate state until max_tokens. */
const MAX_SPAWNER_ROWS = 12;

/**
 * Reasoning models (Nemotron Ultra, etc.) need thinking on to play well.
 * Output must still be machine-parseable via `{"move":N}` / `<<<MOVE:N>>>`.
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

/** Distinctive machine tag — accepted by the parser as a non-JSON fallback. */
export const MOVE_TAG = (n: number): string => `<<<MOVE:${String(n)}>>>`;

export const buildSystemPrompt = (me: PlayerId, reasoning: boolean): string => {
  const priorities = `Goal: claim spawner shares by leaving home, walking a SHORT open trail, then closing. Domination needs shares; milling forever on home loses.
Priorities (context-dependent):
1. If you hold few/no shares: prefer tags leave_home, share, borders_spawner, on_target, or short outward scouts. Do NOT pick onto_home / home_mill just to keep tipDist=0.
2. Prefer tags closes / land_bridge / share / on_target when available — claim ground.
3. When trailLen>=4 (or tipDist is high): prefer homeward / onto_home / closes. Do NOT grow tipDist then. Giant loops lose.
4. Prefer cut when it does not strand a long trail. Merge toward powers of 2.
Tempo: a 2^k lump walks k+1 steps this turn — send it as one count=2^k (spd=k+1), not as 2^k singletons. The band 2^k..2^{k+1}-1 is the same speed (a 3-stack is as fast as a pair). Split order does not trap the leftover: it keeps the parent's spent, so you may send the lump first and still move the remainder, or peel 1 first then walk the lump. After a split, prefer the lump's count over another count=1.
onto_home with trailLen=0 and no expansion is wasted tempo.`;
  const contract = `Return ONLY a JSON object (no markdown fence):
{"move":N,"why":"short reason"}
N is a LEGAL_MOVES index. Read count, spd, leave, tags, and tipDist. Do not invent moves. Do not reprint STATE_JSON.`;
  if (reasoning) {
    return `You are seat ${String(me)} in Conquarrow (territorial conquest on directed arrows).
Choose the best LEGAL_MOVES index for this seat.
${priorities}

${contract}`;
  }
  return `You are seat ${String(me)} in Conquarrow.
Choose the best LEGAL_MOVES index for this seat.
${priorities}

${contract}`;
};

/**
 * Moves shown to the model: the offer as the engine made it.
 *
 * This used to drop the no-op move kind while any step existed, or models burned
 * the whole turn on it. There is no such kind any more (P51), so the offer is
 * steps plus `endTurn` and every one of them is worth showing. Kept as the one
 * named place that decides what a model sees.
 */
export const movesForLlm = (moves: readonly Move[]): readonly Move[] => moves;

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

export const formatLegalMoves = (
  moves: readonly Move[],
  geometry?: GeometryPort,
  rules?: RulesPort,
  state?: GameState,
  me?: PlayerId,
  targets: readonly Finding[] = [],
): string =>
  moves
    .map((m, i) => {
      const body =
        geometry !== undefined &&
        rules !== undefined &&
        state !== undefined &&
        me !== undefined
          ? annotateMove(geometry, rules, state, me, m, targets)
          : (() => {
              switch (m.kind) {
                case 'step':
                  return `step from=${String(m.from)} exit=${String(m.exit)} count=${String(m.count)}`;
                case 'endTurn':
                  return `endTurn`;
              }
            })();
      return `[${String(i)}] ${body}`;
    })
    .join('\n');

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
  const phaseHint =
    myShares === 0
      ? `You hold 0 spawner shares. Prefer leave_home / borders_spawner / on_target / short outward — do NOT home_mill.`
      : trail >= 4
        ? `Open trailLen=${String(trail)} with ${String(myShares)} shares — prefer homeward/closes; do not extend tipDist.`
        : `Shares=${String(myShares)}, trailLen=${String(trail)}. Prefer on_target when present; short scouts OK.`;
  return [
    `Seat ${String(me)}. Pick one LEGAL_MOVES index.`,
    phaseHint,
    tipLines.length > 0 ? `Exposed tips: ${tipLines.join('; ')}` : 'Exposed tips: none',
    formatTargetsForPrompt(targets),
    '',
    'STATE_JSON:',
    JSON.stringify(snapshotForPrompt(geometry, state, me)),
    '',
    'LEGAL_MOVES (count=heads in the portion; spd=speed(count) or merge override; spent=already walked on from, leftover keeps it; steps left this turn = spd-spent; leave=heads staying on from; tags=outcomes):',
    formatLegalMoves(moves, geometry, rules, state, me, targets),
    '',
    'Reply with only JSON: {"move":N,"why":"short"}',
  ].join('\n');
};
/**
 * Strict move-index parse — never harvest digits from arrow ids in prose.
 * Accepts: `{"move":N}`, `<<<MOVE:N>>>`, `ANSWER: N`, lone digit line/string.
 */
export const parseMoveIndex = (text: string, length: number): number | undefined => {
  if (length <= 0) return undefined;

  const accept = (raw: string): number | undefined => {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < length) return n;
    return undefined;
  };

  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return accept(trimmed);

  // Prefer explicit machine forms anywhere (last match wins — models often draft then fix).
  const tagged: number[] = [];
  for (const m of trimmed.matchAll(/\{\s*"move"\s*:\s*(\d+)\s*\}/g)) {
    const n = accept(m[1] ?? '');
    if (n !== undefined) tagged.push(n);
  }
  for (const m of trimmed.matchAll(/"move"\s*:\s*(\d+)/g)) {
    const n = accept(m[1] ?? '');
    if (n !== undefined) tagged.push(n);
  }
  for (const m of trimmed.matchAll(/<<<MOVE:(\d+)>>>/g)) {
    const n = accept(m[1] ?? '');
    if (n !== undefined) tagged.push(n);
  }
  if (tagged.length > 0) return tagged[tagged.length - 1];

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (/^\d+$/.test(line)) {
      const n = accept(line);
      if (n !== undefined) return n;
    }
    const legacy = /^(?:ANSWER|INDEX|MOVE|PICK)\s*[:=]\s*(\d+)\s*$/i.exec(line);
    if (legacy?.[1] !== undefined) {
      const n = accept(legacy[1]);
      if (n !== undefined) return n;
    }
  }
  return undefined;
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

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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

export type LlmFetchResult =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly reason: string };

const extractReplyText = (body: ChatCompletionResponse): string => {
  const message = body.choices?.[0]?.message;
  if (message === undefined) return '';
  const content = typeof message.content === 'string' ? message.content : '';
  const reasoning =
    typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
  // Prefer content (usually the final ANSWER line); fall back to reasoning tail.
  if (content.trim().length > 0) return content;
  return reasoning;
};

/** POST /v1/pick on the local turn runner (plan→commit→validate). */
export const fetchTurnRunnerMoveIndex = async (
  config: ByokConfig,
  prompt: string,
  moveCount: number,
  me: PlayerId,
  fetchImpl: FetchLike = fetch,
): Promise<LlmFetchResult> => {
  const runner = resolveTurnRunnerUrl(config);
  if (runner.length === 0) return { ok: false, reason: 'turn runner not configured' };
  if (moveCount === 0) return { ok: false, reason: 'no legal moves' };

  const url = `${runner.replace(/\/+$/, '')}/v1/pick`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstream: config.baseUrl.trim(),
        apiKey: config.apiKey.trim(),
        model: config.model.trim(),
        seat: String(me),
        moveCount,
        system: buildSystemPrompt(me, config.reasoning),
        user: prompt,
        // Reasoning seats get a free-form plan step; fast seats skip to commit.
        plan: config.reasoning,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error';
    return {
      ok: false,
      reason: `turn runner fetch failed: ${msg} (run pnpm byok-turn on :4010)`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: `turn runner HTTP ${String(response.status)}: not JSON` };
  }
  if (typeof body !== 'object' || body === null) {
    return { ok: false, reason: 'turn runner returned non-object' };
  }
  const o = body as Record<string, unknown>;
  if (o['ok'] === true && typeof o['move'] === 'number' && Number.isInteger(o['move'])) {
    const index = o['move'];
    if (index >= 0 && index < moveCount) return { ok: true, index };
    return { ok: false, reason: `turn runner move out of range: ${String(index)}` };
  }
  const err =
    typeof o['error'] === 'string'
      ? o['error']
      : `HTTP ${String(response.status)} from turn runner`;
  return { ok: false, reason: err };
};

export const fetchLlmMoveIndex = async (
  config: ByokConfig,
  prompt: string,
  moveCount: number,
  me: PlayerId,
  fetchImpl: FetchLike = fetch,
): Promise<LlmFetchResult> => {
  if (!isByokReady(config)) return { ok: false, reason: 'byok not ready' };
  if (moveCount === 0) return { ok: false, reason: 'no legal moves' };

  if (resolveTurnRunnerUrl(config).length > 0) {
    return fetchTurnRunnerMoveIndex(config, prompt, moveCount, me, fetchImpl);
  }

  const runOnce = async (
    messages: readonly { readonly role: string; readonly content: string }[],
    maxTokens?: number,
    forceFast?: boolean,
  ): Promise<{ text: string } | { error: string }> => {
    const cfg = forceFast === true ? { ...config, reasoning: false } : config;
    let response: Response;
    try {
      response = await postChatCompletions(
        config,
        byokCompletionBody(cfg, messages, maxTokens),
        fetchImpl,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'network error';
      const via = resolveByokProxyUrl(config);
      return {
        error:
          via.length === 0
            ? `fetch failed: ${msg} (${BYOK_CORS_HINT})`
            : `fetch failed: ${msg}`,
      };
    }
    if (!response.ok) {
      return { error: `HTTP ${String(response.status)} from ${chatCompletionsUrl(config.baseUrl)}` };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { error: 'response was not JSON' };
    }
    const text = extractReplyText(body as ChatCompletionResponse);
    if (text.trim().length === 0) {
      return { error: 'missing choices[0].message.content' };
    }
    return { text };
  };

  const first = await runOnce([
    { role: 'system', content: buildSystemPrompt(me, config.reasoning) },
    { role: 'user', content: prompt },
  ]);
  if ('error' in first) return { ok: false, reason: first.error };

  let index = parseMoveIndex(first.text, moveCount);
  if (index !== undefined) return { ok: true, index };

  // Second shot: extract a move from the truncated essay (thinking dumped into content).
  const draft = first.text.slice(0, 1200);
  const extract = await runOnce(
    [
      {
        role: 'system',
        content: `Extract the LEGAL_MOVES index the draft was about to choose. Reply ONLY JSON: {"move":N}. Valid N is 0..${String(moveCount - 1)}.`,
      },
      {
        role: 'user',
        content: `Draft (may be truncated):\n${draft}\n\nLEGAL_MOVES count=${String(moveCount)}. Reply {"move":N} only.`,
      },
    ],
    64,
    true,
  );
  if ('error' in extract) {
    return {
      ok: false,
      reason: `unusable model reply: ${JSON.stringify(first.text.slice(0, 240))}`,
    };
  }
  index = parseMoveIndex(extract.text, moveCount);
  if (index === undefined) {
    return {
      ok: false,
      reason: `unusable model reply: ${JSON.stringify(first.text.slice(0, 240))}`,
    };
  }
  return { ok: true, index };
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

export interface LlmChoice {
  readonly move: Move;
  readonly source: 'llm' | 'heuristic';
  readonly reason?: string;
}

export const chooseLlmMove = async (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  config: ByokConfig,
  fetchImpl: FetchLike = fetch,
): Promise<LlmChoice> => {
  const offered = movesForLlm(rules.legalMoves(state));
  if (offered.length === 0) {
    return {
      move: chooseMove(geometry, rules, state, me),
      source: 'heuristic',
      reason: 'no legal moves listed',
    };
  }
  const targets = syncTargetLocks(geometry, rules, state, me);
  const prompt = buildUserPrompt(
    geometry,
    state,
    me,
    offered,
    config.reasoning,
    rules,
    targets,
  );
  const result = await fetchLlmMoveIndex(config, prompt, offered.length, me, fetchImpl);
  if (result.ok) {
    const picked = offered[result.index];
    if (picked !== undefined) return { move: picked, source: 'llm' };
  }
  const reason = result.ok ? 'index out of range' : result.reason;
  // Prefer locked target step when falling back.
  const guided = targets[0]?.move;
  if (guided !== undefined) {
    const ok = offered.some(
      (m) =>
        m.kind === 'step' &&
        m.from === guided.from &&
        m.exit === guided.exit &&
        m.count === guided.count,
    );
    if (ok) {
      return { move: guided, source: 'heuristic', reason };
    }
  }
  return {
    move: chooseMove(geometry, rules, state, me),
    source: 'heuristic',
    reason,
  };
};

export interface LlmBotTurn extends BotTurn {
  readonly llmHits: number;
  readonly llmFallbacks: number;
  readonly lastError: string | undefined;
}

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
    return {
      ...fallback,
      llmHits: 0,
      llmFallbacks: fallback.moves.length,
      lastError: 'byok not ready',
    };
  }

  const moves: Move[] = [];
  let at = state;
  let llmHits = 0;
  let llmFallbacks = 0;
  let lastError: string | undefined;
  for (let i = 0; i < MAX_MOVES_PER_TURN; i += 1) {
    if (at.winner !== undefined || at.activePlayer !== me) break;
    const choice = await chooseLlmMove(geometry, rules, at, me, config, fetchImpl);
    if (choice.source === 'llm') llmHits += 1;
    else {
      llmFallbacks += 1;
      if (choice.reason !== undefined) lastError = choice.reason;
    }
    at = rules.apply(at, choice.move);
    advanceTargetLock(me, choice.move, geometry);
    moves.push(choice.move);
    if (choice.move.kind === 'endTurn') break;
  }
  if (at.winner === undefined && at.activePlayer === me) {
    const forced = endTurn();
    at = rules.apply(at, forced);
    moves.push(forced);
  }
  return { state: at, moves, llmHits, llmFallbacks, lastError };
};
