/**
 * Optional LLM move chooser — adapter only (P15 / P61).
 *
 * The model never invents a move: one completion returns an ordered batch of
 * `legalMoves` step indices plus an `endTurn` flag. Empty prefix falls back to
 * frozen greedy-v1 for the rest of the seat-turn. Hits and fallbacks count
 * seat-turns, not steps.
 *
 * The offer text and the reply parser live in `@conquarrow/byok-offer`. This
 * file re-exports them and keeps the HTTP call to the model.
 */

import type {
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
} from '@conquarrow/contracts';
import { endTurn, movesEqual } from '@conquarrow/contracts';
import {
  buildUserPrompt,
  movesForLlm,
  parseMoveBatchResult,
  rememberByokPlan,
  unusableReplyError,
  type ParsedMoveBatch,
} from '@conquarrow/byok-offer';
import { chooseTurnGreedy } from './botSearch';
import type { ByokConfig } from './byokConfig';
import {
  BYOK_CORS_HINT,
  BYOK_UPSTREAM_HEADER,
  chatCompletionsUrl,
  isByokReady,
  resolveByokProxyUrl,
} from './byokConfig';
import { playBotTurn, type BotTurn } from './opponent';
import { advanceTargetLock, syncTargetLocks } from './targets';
import teachingBody from 'docs/byok-teaching.md?raw';

export {
  PLAN_CAP,
  annotateMove,
  asUsableBatch,
  baselineIndexFromTags,
  buildUserPrompt,
  clearByokPlans,
  dirtClosesFromRows,
  formatLegalMoves,
  isDirtClose,
  isFullStackClose,
  isTagChasePlan,
  millOmit,
  movesForLlm,
  offerText,
  parseMoveBatch,
  parseReply,
  rememberByokPlan,
  snapshotForPrompt,
  threatLineFromCounts,
  type ByokPlanBatch,
  type OfferTagRow,
  type OfferTarget,
  type ParsedMoveBatch,
  type ParsedReply,
  type ThreatLineInput,
} from '@conquarrow/byok-offer';

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

/** Completions cap (POSTs), not applied steps — a single batch may spend the offer. */
const MAX_COMPLETIONS_PER_TURN = 64;

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
