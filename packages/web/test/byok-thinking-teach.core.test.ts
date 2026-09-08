/**
 * docs/spec/byok-thinking-teach/byok-thinking-teach.core.feature
 * One it() per Gherkin scenario. Adapter only — no RTL, no jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import {
  BYOK_REASONING_MAX_TOKENS,
  BYOK_THINKING_OFF,
  BYOK_THINKING_ON,
  annotateMove,
  buildSystemPrompt,
  byokCompletionBody,
  formatLegalMoves,
  parseMoveBatch,
  playLlmBotTurn,
  testByokConnection,
} from '../src/byokBot';
import { chooseTurnGreedy } from '../src/botSearch';
import {
  batchJson,
  indexOfStep,
  mockChat,
  offerSteps,
  postedBody,
  postedMessage,
  readyConfig,
  t2Board,
} from './byok-batch-turn.support';
import { CLOSE_VS_CUT_LABELS, readTeachingFile, t1Opening } from './byok-teaching-prompt.support';
import {
  ESSAY_THEN_TWO_BATCHES,
  PINWHEEL_LABELS,
  UNUSABLE_PROSE,
  firstStep,
  geometry,
  hasBareShareTag,
  openingThree,
  parseSpdSpentLeft,
  rules,
  rulesWithShareGain,
  shareCountOf,
  stepRows,
  t1Section,
  thinkingFlags,
} from './byok-thinking-teach.support';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BYOK thinking follows the lobby, teaching shows split and share counts', () => {
  it('Reasoning true posts thinking on and 4096 tokens', () => {
    const body = byokCompletionBody(readyConfig(), [{ role: 'user', content: '{}' }]);
    const flags = thinkingFlags(body);
    expect(flags.kwargs).toBe(true);
    expect(flags.extra).toBe(true);
    expect(body['chat_template_kwargs']).toEqual(BYOK_THINKING_ON);
    expect(
      (body['extra_body'] as { readonly chat_template_kwargs: unknown })['chat_template_kwargs'],
    ).toEqual(BYOK_THINKING_ON);
    expect(body['max_tokens']).toBe(4096);
    expect(BYOK_REASONING_MAX_TOKENS).toBe(4096);
    expect(body['temperature']).toBe(0);
    expect(body['response_format']).toEqual({ type: 'json_object' });
  });

  it('Reasoning false posts thinking off and 64 tokens', () => {
    const body = byokCompletionBody(readyConfig({ reasoning: false }), [
      { role: 'user', content: '{}' },
    ]);
    const flags = thinkingFlags(body);
    expect(flags.kwargs).toBe(false);
    expect(flags.extra).toBe(false);
    expect(body['chat_template_kwargs']).toEqual(BYOK_THINKING_OFF);
    expect(
      (body['extra_body'] as { readonly chat_template_kwargs: unknown })['chat_template_kwargs'],
    ).toEqual(BYOK_THINKING_OFF);
    expect(body['max_tokens']).toBe(64);
    expect(body['temperature']).toBe(0);
    expect(body['response_format']).toEqual({ type: 'json_object' });
  });

  it('testByokConnection stays a thinking-off probe even when reasoning is true', async () => {
    const spy = mockChat(['{"move":0,"why":"probe"}']);
    const result = await testByokConnection(readyConfig(), spy);
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const body = postedBody(spy);
    const flags = thinkingFlags(body);
    expect(flags.kwargs).toBe(false);
    expect(flags.extra).toBe(false);
    expect(body['max_tokens']).toBe(64);
    expect(body['max_tokens']).not.toBe(4096);
    const system = postedMessage(spy, 'system');
    expect(system).toContain('{"move":0,"why":"probe"}');
    expect(system).not.toContain('"moves"');
  });

  it('T1 teaches split 2+1 throughput not Play [2] as the only answer', () => {
    const teaching = readTeachingFile();
    expect(teaching).toContain('T1 tempo');
    expect(teaching).toContain('[0]');
    expect(teaching).toContain('count=1');
    expect(teaching).toContain('[1]');
    expect(teaching).toContain('count=2');
    expect(teaching).toContain('[2]');
    expect(teaching).toContain('count=3');
    expect(teaching).not.toContain('Play [2]');
    const t1 = t1Section(teaching);
    expect(t1).toMatch(/speed\(3\)\s*=\s*2/);
    expect(t1).toMatch(/2 tiles/);
    expect(t1).toMatch(/2\s*\+\s*1/);
    expect(t1).toMatch(/before walking/i);
    expect(t1).toMatch(/3 tiles|three tiles/i);
    expect(t1).toMatch(/POST/i);
    expect(teaching).not.toMatch(/prefer split/i);
    const { me } = t1Opening();
    expect(buildSystemPrompt(me, true)).toContain('T1 tempo');
    expect(buildSystemPrompt(me, true)).not.toContain('Play [2]');
  });

  it('Pinwheel example has Before plus After 1-share and After 3-share', () => {
    const teaching = readTeachingFile();
    const { me } = t1Opening();
    const system = buildSystemPrompt(me, true);
    expect(teaching).toContain('pinwheel');
    for (const label of PINWHEEL_LABELS) {
      expect(teaching, label).toContain(label);
      expect(system, label).toContain(label);
    }
    expect(teaching).toContain('apply(state, move)');
    expect(teaching).toMatch(/1-share/);
    expect(teaching).toMatch(/3-share/);
    expect(teaching).not.toMatch(/prefer the 3-share/i);
  });

  it('Close vs cut example is still present', () => {
    const teaching = readTeachingFile();
    const { me } = t1Opening();
    const system = buildSystemPrompt(me, true);
    for (const label of CLOSE_VS_CUT_LABELS) {
      expect(teaching, label).toContain(label);
      expect(system, label).toContain(label);
    }
  });

  it('A step that gains 2 shares is tagged share+2 not bare share', () => {
    const { state, me } = openingThree();
    const wrapped = rulesWithShareGain(me, 2);
    const move = firstStep(state);
    const after = wrapped.apply(state, move);
    expect(shareCountOf(after, me) - shareCountOf(state, me)).toBe(2);
    const row = annotateMove(geometry, wrapped, state, me, move);
    expect(row).toContain('share+2');
    expect(hasBareShareTag(row)).toBe(false);
    expect(formatLegalMoves([move], geometry, wrapped, state, me)).toContain('share+2');
  });

  it('Step rows contain left= equal to spd minus spent', () => {
    const { state, me } = openingThree();
    const listed = formatLegalMoves(offerSteps(state), geometry, rules, state, me);
    const rows = stepRows(listed);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toContain('left=');
      const parsed = parseSpdSpentLeft(row);
      expect(parsed.left).toBe(parsed.spd - parsed.spent);
    }
  });

  it('Two batch objects after an essay use the last usable one', async () => {
    expect(parseMoveBatch(ESSAY_THEN_TWO_BATCHES)).toEqual({
      indices: [0],
      endTurn: true,
    });
    const { state, me } = openingThree();
    const spy = mockChat([ESSAY_THEN_TWO_BATCHES]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.llmHits).toBe(1);
    expect(result.moves[0]).toEqual(offerSteps(state)[0]);
  });

  it('Whole-string JSON still parses and does not increment salvage', async () => {
    const { state, me } = openingThree();
    const content = batchJson([0], true);
    expect(parseMoveBatch(content)).toEqual({ indices: [0], endTurn: true });
    const spy = mockChat([content]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.salvageParses ?? 0).toBe(0);
    expect(result.llmHits).toBe(1);
  });

  it('Unusable text with no batch object is empty prefix greedy', async () => {
    const { state, me } = openingThree();
    const spy = mockChat([UNUSABLE_PROSE]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves).toEqual(chooseTurnGreedy(geometry, rules, state, me));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.llmFallbacks).toBe(1);
    expect(result.llmHits).toBe(0);
    expect(result.salvageParses ?? 0).toBe(0);
  });

  it('P61 illegal-tail, empty-prefix, and lump apply stay live', async () => {
    const { state: t2, me: t2Me, from, exit } = t2Board();
    const lumpIndex = indexOfStep(
      t2,
      (m) => m.from === from && m.exit === exit && m.count === 3,
    );
    const lump = offerSteps(t2)[lumpIndex];
    expect(lump).toBeDefined();
    const lumpSpy = mockChat([batchJson([lumpIndex], true)]);
    const lumped = await playLlmBotTurn(geometry, rules, t2, t2Me, readyConfig(), lumpSpy);
    expect(lumped.moves).toEqual([lump, endTurn()]);
    expect(lumped.llmHits).toBe(1);

    const { state, me } = openingThree();
    const emptySpy = mockChat([batchJson([], false)]);
    const empty = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), emptySpy);
    expect(empty.moves).toEqual(chooseTurnGreedy(geometry, rules, state, me));
    expect(empty.llmFallbacks).toBe(1);

    const L = 0;
    const first = offerSteps(state)[L];
    expect(first).toBeDefined();
    const tailSpy = mockChat([batchJson([L, 99], true), batchJson([], true)]);
    const tailed = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), tailSpy);
    expect(tailed.moves).toEqual([first, endTurn()]);
    expect(tailSpy.mock.calls.length).toBeGreaterThan(1);
    expect(tailed.llmHits).toBe(1);
  });
});
