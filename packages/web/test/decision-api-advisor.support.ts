/**
 * Fixtures for P72 decision-api-advisor.
 * docs/spec/decision-api-advisor/decision-api-advisor.md
 *
 * Adapter only. A seat-turn is driven through `playLlmBotTurn` with one
 * scripted `FetchLike` that routes on the request's *upstream* (the
 * `X-Arrows-Byok-Upstream` header under a relay, else the URL): a
 * `/systemone` upstream takes the next advisor step, anything else the next
 * chat reply. Every request is captured so tests read what was sent.
 *
 * "The plain prompt" is always observed, never rebuilt: it is the user prompt
 * an advisor-off run of the same board and the same model replies sends
 * ({@link plainRun}). Module state that feeds the prompt (stored plans, target
 * locks) is cleared before every run ({@link runTurn}).
 *
 * Boards are generated-tiling positions (the BYOK prompt needs the real
 * tiling's spawners and fill): the opening, a 3-row board, a two-completion
 * lump-then-split board, and two cap boards — exactly 255 rows, and the
 * smallest offer past it (258: every stack here adds a multiple of 3 rows, so
 * the spec's example 256 is not constructible on this tiling).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArrowId, GameState, Group, Move, PlayerId, StepMove } from '@conquarrow/contracts';
import { vi } from 'vitest';
import type { AdvisorRequestBody } from '../src/advisor';
import { clearByokPlans, movesForLlm, playLlmBotTurn } from '../src/byokBot';
import type { FetchLike, LlmBotTurn } from '../src/byokBot';
import { BYOK_UPSTREAM_HEADER, DEFAULT_ADVISOR } from '../src/byokConfig';
import type { AdvisorConfig, ByokConfig } from '../src/byokConfig';
import { appendMoves, createMatchLog } from '../src/matchLog';
import type { AdvisorRecord, MatchLog } from '../src/matchLog';
import { clearTargetLocks } from '../src/targets';
import {
  batchJson,
  geometry,
  indexOfStep,
  jsonResponse,
  offerSteps,
  openingThree,
  readyConfig,
  replaceOwnerGroups,
  rules,
  THREE_MATCH,
} from './byok-batch-turn.support';
import { installMemoryLocalStorage } from './match-summary-telemetry.support';

export { batchJson, geometry, installMemoryLocalStorage, offerSteps, openingThree, rules, THREE_MATCH };

const here = dirname(fileURLToPath(import.meta.url));
export const lobbySource = (): string => readFileSync(join(here, '../src/Lobby.tsx'), 'utf8');
export const appSource = (): string => readFileSync(join(here, '../src/App.tsx'), 'utf8');

// ---------------------------------------------------------------- keys & configs

export const SEAT_KEY = 'sk-seat-SECRET';
export const ADVISOR_KEY = 'ts-adv-SECRET';
export const SYSTEM_ONE = 'https://api.typesafe.ai/v1/systemone';
export const LEGEND =
  "advisor=p on a row is an independent decision model's probability that the row is the best next step. It is advice; you choose.";

export const readyAdvisor = (over: Partial<AdvisorConfig> = {}): AdvisorConfig => ({
  ...DEFAULT_ADVISOR,
  enabled: true,
  apiKey: ADVISOR_KEY,
  ...over,
});

/** A ready BYOK seat (key {@link SEAT_KEY}) carrying `advisor`. */
export const seatConfig = (
  advisor: AdvisorConfig = readyAdvisor(),
  over: Partial<ByokConfig> = {},
): ByokConfig => readyConfig({ apiKey: SEAT_KEY, advisor, ...over });

/** The same seat with the advisor at its default (off, nothing filled). */
export const offConfig = (over: Partial<ByokConfig> = {}): ByokConfig =>
  seatConfig(DEFAULT_ADVISOR, over);

// ---------------------------------------------------------------- advisor replies

/** One scripted advisor reply. Receives the request init (for its signal). */
export type AdvisorStep = (init: RequestInit | undefined) => Promise<Response>;

const jsonBody = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** 200 with `answers.move.probabilities`; `model` omitted when undefined. */
export const advisorAnswers =
  (probabilities: Readonly<Record<string, unknown>>, model?: string): AdvisorStep =>
  () =>
    Promise.resolve(
      jsonBody(200, {
        ...(model === undefined ? {} : { model }),
        answers: { move: { probabilities } },
      }),
    );

export const advisorStatus =
  (status: number): AdvisorStep =>
  () =>
    Promise.resolve(jsonBody(status, { error: { message: 'scripted' } }));

export const advisorJson =
  (body: unknown): AdvisorStep =>
  () =>
    Promise.resolve(jsonBody(200, body));

export const advisorText =
  (text: string): AdvisorStep =>
  () =>
    Promise.resolve(new Response(text, { status: 200 }));

export const advisorThrows =
  (message: string): AdvisorStep =>
  () =>
    Promise.reject(new Error(message));

/**
 * Behaves like `fetch` under an aborted signal: rejects with the signal's
 * reason. A request with no signal rejects with a message no reason string
 * matches, so a missing timeout fails loudly instead of hanging.
 */
export const advisorHonoursSignal: AdvisorStep = (init) => {
  const signal = init?.signal;
  if (signal === undefined || signal === null) {
    return Promise.reject(new Error('scripted: advisor request carried no AbortSignal'));
  }
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<Response>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });
};

/** The message `AbortSignal.timeout` aborts with. */
export const TIMEOUT_MESSAGE = 'The operation was aborted due to timeout';

/**
 * Make `AbortSignal.timeout(ms)` return an already-timed-out signal, as it
 * would 10 s later. Returns the spy so a test can read the `ms` asked for.
 */
export const fireTimeoutsImmediately = () =>
  vi
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation(() =>
      AbortSignal.abort(new DOMException(TIMEOUT_MESSAGE, 'TimeoutError')),
    );

// ---------------------------------------------------------------- scripted fetch

export interface CapturedRequest {
  readonly url: string;
  readonly method: string | undefined;
  /** Header upstream under a relay, else the URL. */
  readonly upstream: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal | undefined;
}

export const isAdvisorRequest = (r: CapturedRequest): boolean => r.upstream.endsWith('/systemone');

const headerRecord = (init: RequestInit | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  const raw = init?.headers;
  if (raw === undefined) return out;
  new Headers(raw).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
};

/** A chat reply: message content (HTTP 200), or a scripted response. */
export type ChatStep = string | (() => Promise<Response>);

export const chatStatus =
  (status: number): (() => Promise<Response>) =>
  () =>
    Promise.resolve(jsonBody(status, { error: { message: 'scripted' } }));

export interface ScriptedFetch {
  readonly fetch: FetchLike;
  readonly requests: CapturedRequest[];
}

/**
 * Advisor steps are consumed in order; the last repeats. With no advisor
 * steps, an advisor request rejects (so "no call" tests stay honest).
 */
export const scriptedFetch = (
  chat: readonly ChatStep[],
  advisor: readonly AdvisorStep[] = [],
): ScriptedFetch => {
  const requests: CapturedRequest[] = [];
  let c = 0;
  let a = 0;
  const fetchImpl: FetchLike = (url, init) => {
    const headers = headerRecord(init);
    const upstream = headers[BYOK_UPSTREAM_HEADER.toLowerCase()] ?? url;
    const body = typeof init?.body === 'string' ? init.body : '';
    const request: CapturedRequest = {
      url,
      method: init?.method,
      upstream,
      headers,
      body,
      signal: init?.signal ?? undefined,
    };
    requests.push(request);
    if (isAdvisorRequest(request)) {
      const next = advisor[a] ?? advisor[advisor.length - 1];
      if (a < advisor.length) a += 1;
      if (next === undefined) return Promise.reject(new Error('scripted: unexpected advisor call'));
      return next(init);
    }
    const reply = chat[c] ?? chat[chat.length - 1] ?? '';
    if (c < chat.length) c += 1;
    return typeof reply === 'string' ? Promise.resolve(jsonResponse(reply)) : reply();
  };
  return { fetch: fetchImpl, requests };
};

export const advisorRequests = (s: ScriptedFetch): CapturedRequest[] =>
  s.requests.filter(isAdvisorRequest);

export const chatRequests = (s: ScriptedFetch): CapturedRequest[] =>
  s.requests.filter((r) => !isAdvisorRequest(r));

const parsed = (r: CapturedRequest | undefined): Record<string, unknown> => {
  if (r === undefined) return {};
  const value: unknown = JSON.parse(r.body);
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
};

/** Parsed JSON body of a captured request. */
export const bodyOf = (r: CapturedRequest | undefined): Record<string, unknown> => parsed(r);

/** The `role` message of a captured chat request. */
export const chatMessage = (r: CapturedRequest | undefined, role: 'system' | 'user'): string => {
  const messages = parsed(r)['messages'];
  if (!Array.isArray(messages)) return '';
  for (const item of messages) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    if (row['role'] === role && typeof row['content'] === 'string') return row['content'];
  }
  return '';
};

/** User prompts of every chat request, in order. */
export const chatPrompts = (s: ScriptedFetch): string[] =>
  chatRequests(s).map((r) => chatMessage(r, 'user'));

// ---------------------------------------------------------------- running turns

export interface Board {
  readonly state: GameState;
  readonly me: PlayerId;
}

export interface Run {
  readonly turn: LlmBotTurn;
  readonly fetch: ScriptedFetch;
}

/** One seat-turn from clean module state. */
export const runTurn = async (
  board: Board,
  config: ByokConfig,
  chat: readonly ChatStep[],
  advisor: readonly AdvisorStep[] = [],
): Promise<Run> => {
  clearByokPlans();
  clearTargetLocks();
  const fetch = scriptedFetch(chat, advisor);
  const turn = await playLlmBotTurn(geometry, rules, board.state, board.me, config, fetch.fetch);
  return { turn, fetch };
};

/** The advisor-off run against the same model replies: the reference for "plain". */
export const plainRun = (board: Board, chat: readonly ChatStep[]): Promise<Run> =>
  runTurn(board, offConfig(), chat);

// ---------------------------------------------------------------- prompt reading

export const LEGAL_MOVES_PREFIX = 'LEGAL_MOVES';
const ROW = /^\[(\d+)\] /;

/** Every offer row line of the LEGAL_MOVES block, as `{index, line}` in prompt order. */
export const offerRowLines = (
  prompt: string,
): readonly { readonly index: number; readonly line: string }[] => {
  const lines = prompt.split('\n');
  const header = lines.findIndex((l) => l.startsWith(LEGAL_MOVES_PREFIX));
  if (header < 0) return [];
  const out: { index: number; line: string }[] = [];
  for (const line of lines.slice(header + 1)) {
    const match = ROW.exec(line);
    if (match?.[1] === undefined) {
      if (line === LEGEND) continue;
      break;
    }
    out.push({ index: Number(match[1]), line });
  }
  return out;
};

/** Row text: the plain row without its `[i] ` prefix, indexed by `i`. */
export const rowTexts = (plainPrompt: string): readonly string[] => {
  const rows = offerRowLines(plainPrompt);
  const texts: string[] = [];
  for (const { index, line } of rows) texts[index] = line.replace(ROW, '');
  return texts;
};

/** The plain prompt up to, not including, the LEGAL_MOVES line, with no trailing blank line. */
export const statePrefix = (plainPrompt: string): string => {
  const lines = plainPrompt.split('\n');
  const header = lines.findIndex((l) => l.startsWith(LEGAL_MOVES_PREFIX));
  if (header < 0) throw new Error('setup: prompt has no LEGAL_MOVES line');
  return lines.slice(0, header).join('\n').replace(/\n+$/, '');
};

const SUFFIX = / advisor=\d+\.\d\d$/;

/** Undo an advised prompt: drop the legend line and every row's ` advisor=d.dd`. */
export const stripAdvice = (advised: string): string =>
  advised
    .split('\n')
    .filter((line) => line !== LEGEND)
    .map((line) => (ROW.test(line) ? line.replace(SUFFIX, '') : line))
    .join('\n');

/** The reference argmax: highest value, ties to the lowest index. */
export const argmaxLowest = (values: readonly number[]): number => {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if ((values[i] ?? 0) > (values[best] ?? 0)) best = i;
  }
  return best;
};

/** Seeded LCG — deterministic property inputs, no `Math.random`. */
export const lcg = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

// ---------------------------------------------------------------- boards

const myHome = (state: GameState, me: PlayerId): ArrowId => {
  const home = [...state.groups.entries()].find(([, g]) => g.owner === me)?.[0];
  if (home === undefined) throw new Error('setup: opening stack missing');
  return home;
};

/** The opening, seat to move: a 3-stack at home. */
export const openingBoard = (): Board => openingThree();

/**
 * The opening with the seat's stack cut to one head on some home arrow whose
 * offer has exactly three rows. The model's `[1]` is legal.
 */
export const threeRowBoard = (): Board => {
  const { state, me } = openingThree();
  const candidates = [...state.territory.entries()]
    .filter(([id, owner]) => owner === me && (!state.groups.has(id) || state.groups.get(id)?.owner === me))
    .map(([id]) => id)
    .toSorted((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  for (const at of candidates) {
    const next = replaceOwnerGroups(state, me, new Map([[at, { owner: me, heads: 1, spent: 0 }]]));
    if (movesForLlm(rules.legalMoves(next)).length === 3) return { state: next, me };
  }
  throw new Error('setup: no home arrow with a 3-row offer');
};

/**
 * Two completions: `[lump]` with endTurn false, then a 2-way split from the
 * landing with endTurn true. `chat` is that reply script.
 */
export const twoCompletionBoard = (): Board & {
  readonly chat: readonly string[];
  readonly firstOfferSize: number;
} => {
  const { state, me } = openingThree();
  const lump = offerSteps(state).find((m) => m.count === 3);
  if (lump === undefined) throw new Error('setup: no count=3 lump');
  const lumpIndex = indexOfStep(
    state,
    (m) => m.from === lump.from && m.exit === lump.exit && m.count === 3,
  );
  const afterLump = rules.apply(state, lump);
  const ones = offerSteps(afterLump).filter((m) => m.from === lump.exit && m.count === 1);
  const a = ones[0];
  const b = ones.find((m) => m.exit !== a?.exit);
  if (a === undefined || b === undefined) throw new Error('setup: no 2-way split');
  const same = (x: StepMove) => (m: StepMove) =>
    m.from === x.from && m.exit === x.exit && m.count === x.count;
  const chat = [
    batchJson([lumpIndex], false),
    batchJson([indexOfStep(afterLump, same(a)), indexOfStep(afterLump, same(b))], true),
  ];
  return { state, me, chat, firstOfferSize: movesForLlm(rules.legalMoves(state)).length };
};

const capCandidates = (state: GameState, me: PlayerId): readonly ArrowId[] =>
  [...geometry.window(geometry.origin(myHome(state, me)), 8).arrows]
    .filter((id) => !(state.groups.has(id) && state.groups.get(id)?.owner !== me))
    .toSorted((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));

/**
 * Stacks owned by the seat on nearby free arrows, 3 heads where that does not
 * pass the System One choice cap, else 2, else 1. Every stack here adds a
 * multiple of 3 rows, so the cap itself (255) is reachable and 256 is not.
 */
const fillToCap = (): { readonly board: Board; readonly groups: Map<ArrowId, Group>; readonly rest: readonly ArrowId[] } => {
  const { state, me } = openingThree();
  const groups = new Map<ArrowId, Group>();
  const candidates = capCandidates(state, me);
  for (const [i, id] of candidates.entries()) {
    for (const heads of [3, 2, 1]) {
      groups.set(id, { owner: me, heads, spent: 0 });
      const next = replaceOwnerGroups(state, me, groups);
      const size = movesForLlm(rules.legalMoves(next)).length;
      if (size === 255) return { board: { state: next, me }, groups, rest: candidates.slice(i + 1) };
      if (size < 255) break;
      groups.delete(id);
    }
  }
  throw new Error('setup: could not build a 255-row offer');
};

/** An offer of exactly 255 rows: at the cap, so the advisor is still asked. */
export const atCapBoard = (): Board & { readonly offerSize: number } => ({
  ...fillToCap().board,
  offerSize: 255,
});

/**
 * The smallest offer past the cap this tiling can host (255 + one 1-head
 * stack). The spec's example is 256; any n > 255 is the same rule.
 */
export const overCapBoard = (): Board & { readonly offerSize: number } => {
  const { board, groups, rest } = fillToCap();
  const extra = rest[0];
  if (extra === undefined) throw new Error('setup: no arrow left past the cap');
  groups.set(extra, { owner: board.me, heads: 1, spent: 0 });
  const state = replaceOwnerGroups(board.state, board.me, groups);
  const offerSize = movesForLlm(rules.legalMoves(state)).length;
  if (offerSize <= 255) throw new Error('setup: over-cap board is not over the cap');
  return { state, me: board.me, offerSize };
};

// ---------------------------------------------------------------- bodies, records, logs

/** A well-formed System One body over `n` placeholder rows (askAdvisor only posts it). */
export const sampleBody = (n: number): AdvisorRequestBody => {
  const criteria: Record<string, string> = {};
  for (let i = 0; i < n; i += 1) criteria[`m${String(i)}`] = `row ${String(i)}`;
  return {
    model: 'jev-latest',
    state: 'state',
    questions: { move: { type: 'choice', instructions: 'instructions', criteria } },
  };
};

export const advisorRecord = (seat: PlayerId, over: Partial<AdvisorRecord> = {}): AdvisorRecord => ({
  seat,
  turnMoveIndex: 0,
  model: 'jev-1.14.0',
  offerSize: 3,
  top: 1,
  probabilities: [0.1, 0.6, 0.3],
  picked: 1,
  ...over,
});

/** A three-seat log (seat B a BYOK seat) for THREE_MATCH, with `moves` logged. */
export const matchLogWith = (players: readonly PlayerId[], moves: readonly Move[]): MatchLog => {
  const [a, b, c] = players;
  if (a === undefined || b === undefined || c === undefined) throw new Error('setup: three seats');
  const log = createMatchLog({
    config: THREE_MATCH,
    vsBot: true,
    botMode: 'mixed',
    seats: [
      { player: a, kind: 'human' },
      { player: b, kind: 'byok', model: 'test-model' },
      { player: c, kind: 'heuristic' },
    ],
    humanSeat: a,
    botSeat: b,
    startedAt: '2026-11-02T00:00:00.000Z',
  });
  return appendMoves(log, moves);
};
