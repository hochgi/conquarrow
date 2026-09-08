/**
 * Fixtures for P63 BYOK thinking-teach tests.
 * Adapter only — tiling boards + injected fetch. No RTL, no jsdom.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintPlayerId } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { vi } from 'vitest';
import type { FetchLike } from '../src/byokBot';
import { createMatchLog, type MatchLog } from '../src/matchLog';
import {
  geometry,
  offerSteps,
  openingThree,
  rules,
  THREE_MATCH,
} from './byok-batch-turn.support';

export {
  geometry,
  offerSteps,
  openingThree,
  rules,
  THREE_MATCH,
};

const here = dirname(fileURLToPath(import.meta.url));

export const PINWHEEL_LABELS = ['Before', 'After 1-share', 'After 3-share'] as const;

export const ESSAY_THEN_TWO_BATCHES = [
  'Considering tempo and the 3-stack.',
  '{"moves":[1],"endTurn":true}',
  'On second thought the last index is better.',
  '{"moves":[0],"endTurn":true}',
].join('\n');

export const ESSAY_THEN_ONE_BATCH = [
  'Considering tempo.',
  '{"moves":[0],"endTurn":true}',
].join('\n');

export const THOUGHT_THEN_BATCH = '{"thought":true}\n{"moves":[2],"endTurn":true}';

export const FRACTION_THEN_BATCH =
  '{"moves":[0.5],"endTurn":true}\n{"moves":[2],"endTurn":true}';

export const UNUSABLE_PROSE = 'thinking...\nANSWER: 2';

export const WHOLE_STRING_NESTED =
  '{"moves":[1],"endTurn":true,"hint":{"moves":[9],"endTurn":false}}';

export const matchLogSource = (): string =>
  readFileSync(join(here, '../src/matchLog.ts'), 'utf8');

export const hudSource = (): string => readFileSync(join(here, '../src/Hud.tsx'), 'utf8');

export const teachingPromptCoreFeature = (): string =>
  readFileSync(
    join(here, '../../../docs/spec/byok-teaching-prompt/byok-teaching-prompt.core.feature'),
    'utf8',
  );

export const teachingPromptEdgeFeature = (): string =>
  readFileSync(
    join(here, '../../../docs/spec/byok-teaching-prompt/byok-teaching-prompt.edge-cases.feature'),
    'utf8',
  );

export const webTestSource = (file: string): string =>
  readFileSync(join(here, file), 'utf8');

export const t1Section = (teaching: string): string => {
  const start = teaching.indexOf('T1 tempo');
  if (start < 0) return '';
  const next = teaching.indexOf('\n## ', start + 1);
  return next < 0 ? teaching.slice(start) : teaching.slice(start, next);
};

export const thinkingFlags = (
  body: Record<string, unknown>,
): { readonly kwargs: boolean | undefined; readonly extra: boolean | undefined } => {
  const read = (value: unknown): boolean | undefined => {
    if (typeof value !== 'object' || value === null) return undefined;
    const flag = (value as Record<string, unknown>)['enable_thinking'];
    return typeof flag === 'boolean' ? flag : undefined;
  };
  const extraBody = body['extra_body'];
  const extraKwargs =
    typeof extraBody === 'object' && extraBody !== null
      ? (extraBody as Record<string, unknown>)['chat_template_kwargs']
      : undefined;
  return {
    kwargs: read(body['chat_template_kwargs']),
    extra: read(extraKwargs),
  };
};

export type ChatMock = {
  readonly content: string;
  readonly finish_reason?: string;
  readonly topFinishReason?: string;
  readonly usage?: { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown };
};

export const chatJsonResponse = (mock: ChatMock): Response => {
  const choice: Record<string, unknown> = {
    message: { content: mock.content },
  };
  if (mock.finish_reason !== undefined) choice['finish_reason'] = mock.finish_reason;
  const payload: Record<string, unknown> = { choices: [choice] };
  if (mock.topFinishReason !== undefined) payload['finish_reason'] = mock.topFinishReason;
  if (mock.usage !== undefined) payload['usage'] = mock.usage;
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const mockChatCompletions = (
  replies: readonly ChatMock[],
): ReturnType<typeof vi.fn<FetchLike>> => {
  let i = 0;
  return vi.fn<FetchLike>(() => {
    const mock = replies[i] ?? replies[replies.length - 1];
    if (i < replies.length) i += 1;
    if (mock === undefined) return Promise.resolve(chatJsonResponse({ content: '' }));
    return Promise.resolve(chatJsonResponse(mock));
  });
};

export const shareCountOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) {
      if (state.territory.get(arrow) === player) n += 1;
    }
  }
  return n;
};

const uniqueBorders = (state: GameState): ArrowId[] => {
  const seen = new Set<string>();
  const out: ArrowId[] = [];
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) {
      const key = String(arrow);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(arrow);
    }
  }
  return out;
};

/** Test-only RulesPort: after a real apply, force `me`'s share delta to `targetGain`. */
export const rulesWithShareGain = (me: PlayerId, targetGain: number): RulesPort => ({
  ...rules,
  apply: (state, move) => {
    const after = rules.apply(state, move);
    const beforeShares = shareCountOf(state, me);
    const natural = shareCountOf(after, me) - beforeShares;
    if (natural === targetGain) return after;
    let territory = new Map(after.territory);
    for (const arrow of uniqueBorders(after)) {
      const current = { ...after, territory };
      if (shareCountOf(current, me) - beforeShares === targetGain) return current;
      if (territory.get(arrow) === me) continue;
      const trial = new Map(territory);
      trial.set(arrow, me);
      const gain = shareCountOf({ ...after, territory: trial }, me) - beforeShares;
      if (gain <= targetGain) territory = trial;
    }
    const forced = { ...after, territory };
    if (shareCountOf(forced, me) - beforeShares !== targetGain) {
      throw new Error(`setup: could not force share gain ${String(targetGain)}`);
    }
    return forced;
  },
});

export const firstStep = (state: GameState): StepMove => {
  const move = offerSteps(state)[0];
  if (move === undefined) throw new Error('setup: no legal step');
  return move;
};

export const stepWithShareGain = (
  state: GameState,
  me: PlayerId,
  gain: number,
): StepMove => {
  for (const move of offerSteps(state)) {
    let after: GameState;
    try {
      after = rules.apply(state, move);
    } catch {
      continue;
    }
    if (shareCountOf(after, me) - shareCountOf(state, me) === gain) return move;
  }
  throw new Error(`setup: no legal step with share gain ${String(gain)}`);
};

export const hasBareShareTag = (row: string): boolean =>
  /\bshare\b/.test(row.replace(/share\+\d+/g, ''));

export const stepRows = (listed: string): string[] =>
  listed.split('\n').filter((line) => /\[\d+\]\s+step /.test(line));

export const parseSpdSpentLeft = (
  row: string,
): { readonly spd: number; readonly spent: number; readonly left: number | undefined } => {
  const spd = Number(/spd=(-?\d+)/.exec(row)?.[1]);
  const spent = Number(/spent=(-?\d+)/.exec(row)?.[1]);
  const leftMatch = /left=(-?\d+)/.exec(row);
  return {
    spd,
    spent,
    left: leftMatch?.[1] === undefined ? undefined : Number(leftMatch[1]),
  };
};

export const oldByokMatchLog = (): MatchLog => {
  const A = mintPlayerId('A');
  const B = mintPlayerId('B');
  return createMatchLog({
    config: THREE_MATCH,
    vsBot: true,
    botMode: 'mixed',
    seats: [
      { player: A, kind: 'human' },
      { player: B, kind: 'byok', model: 'test-model' },
    ],
    humanSeat: A,
    botSeat: B,
    startedAt: '2026-09-08T00:00:00.000Z',
  });
};
