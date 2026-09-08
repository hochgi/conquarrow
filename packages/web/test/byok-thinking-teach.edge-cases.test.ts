/**
 * docs/spec/byok-thinking-teach/byok-thinking-teach.edge-cases.feature
 * One it() per Gherkin scenario. Adapter only — no RTL, no jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BYOK_FAST_MAX_TOKENS,
  BYOK_REASONING_MAX_TOKENS,
  BYOK_THINKING_OFF,
  BYOK_THINKING_ON,
  annotateMove,
  buildSystemPrompt,
  byokCompletionBody,
  parseMoveBatch,
  playLlmBotTurn,
} from '../src/byokBot';
import * as botSearch from '../src/botSearch';
import * as botEvaluate from '../src/botEvaluate';
import { withByokStats, type ByokRunStats } from '../src/matchLog';
import {
  batchJson,
  byokBotSource,
  mockChat,
  pagesHeuristicSource,
  readyConfig,
} from './byok-batch-turn.support';
import {
  SPEED_FORMULA,
  opponentSource,
  readTeachingFile,
  specSection1,
  t1Opening,
} from './byok-teaching-prompt.support';
import {
  ESSAY_THEN_ONE_BATCH,
  FRACTION_THEN_BATCH,
  THOUGHT_THEN_BATCH,
  UNUSABLE_PROSE,
  WHOLE_STRING_NESTED,
  geometry,
  hasBareShareTag,
  hudSource,
  matchLogSource,
  mockChatCompletions,
  oldByokMatchLog,
  openingThree,
  rules,
  stepWithShareGain,
  teachingPromptCoreFeature,
  teachingPromptEdgeFeature,
  thinkingFlags,
  webTestSource,
} from './byok-thinking-teach.support';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BYOK thinking-teach — token totals, salvage, sync, unchanged seams', () => {
  it('Missing usage and finish_reason yield zero token fields without throwing', async () => {
    const { state, me } = openingThree();
    const spy = mockChatCompletions([{ content: batchJson([0], true) }]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
    expect(result.lengthOuts).toBe(0);
  });

  it('Old match log without new fields loads and fold treats them as 0', () => {
    const log = oldByokMatchLog();
    expect(log.byokStats?.promptTokens).toBeUndefined();
    const delta: ByokRunStats = {
      llmHits: 1,
      llmFallbacks: 0,
      lastError: undefined,
      promptTokens: 3,
      completionTokens: 5,
      lengthOuts: 1,
      salvageParses: 1,
      maxTokens: 4096,
    };
    const next = withByokStats(log, delta);
    expect(next.byokStats?.promptTokens).toBe(3);
    expect(next.byokStats?.completionTokens).toBe(5);
    expect(next.byokStats?.lengthOuts).toBe(1);
    expect(next.byokStats?.salvageParses).toBe(1);
    expect(next.byokStats?.maxTokens).toBe(4096);
    expect(next.byokStats?.llmHits).toBe(1);
  });

  it('finish_reason length increments lengthOuts and can still be a hit', async () => {
    const { state, me } = openingThree();
    const spy = mockChatCompletions([
      { content: ESSAY_THEN_ONE_BATCH, finish_reason: 'length' },
    ]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.llmHits).toBe(1);
    expect(result.llmFallbacks).toBe(0);
    expect(result.lengthOuts).toBe(1);
  });

  it('Salvage increments only when whole-string parse failed and a nested batch succeeded', async () => {
    expect(parseMoveBatch('{"moves":[1],"endTurn":true}')).toEqual({
      indices: [1],
      endTurn: true,
    });
    expect(parseMoveBatch(ESSAY_THEN_ONE_BATCH)).toEqual({
      indices: [0],
      endTurn: true,
    });
    const { state, me } = openingThree();
    const salvaged = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChat([ESSAY_THEN_ONE_BATCH]),
    );
    expect(salvaged.salvageParses).toBe(1);
    expect(salvaged.llmHits).toBe(1);
    expect(salvaged.llmFallbacks).toBe(0);
    const whole = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChat([batchJson([0], true)]),
    );
    expect(whole.salvageParses ?? 0).toBe(0);
  });

  it('maxTokens on the aggregate is the max of previous and delta', () => {
    const log = oldByokMatchLog();
    const seeded = {
      ...log,
      byokStats: {
        llmHits: 0,
        llmFallbacks: 0,
        lastError: undefined,
        maxTokens: 64,
      },
    };
    const up = withByokStats(seeded, {
      llmHits: 0,
      llmFallbacks: 0,
      lastError: undefined,
      maxTokens: 4096,
    });
    expect(up.byokStats?.maxTokens).toBe(4096);
    const down = withByokStats(up, {
      llmHits: 0,
      llmFallbacks: 0,
      lastError: undefined,
      maxTokens: 64,
    });
    expect(down.byokStats?.maxTokens).toBe(4096);
  });

  it('A CoT example object that is not a batch is skipped if a later usable batch exists', () => {
    expect(parseMoveBatch(THOUGHT_THEN_BATCH)).toEqual({
      indices: [2],
      endTurn: true,
    });
    expect(parseMoveBatch(FRACTION_THEN_BATCH)).toEqual({
      indices: [2],
      endTurn: true,
    });
    expect(parseMoveBatch(UNUSABLE_PROSE)).toBeUndefined();
    expect(parseMoveBatch(WHOLE_STRING_NESTED)).toEqual({
      indices: [1],
      endTurn: true,
    });
  });

  it('Length-out plus unusable text is a fallback', async () => {
    const { state, me } = openingThree();
    const spy = mockChatCompletions([
      { content: UNUSABLE_PROSE, finish_reason: 'length' },
    ]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.lengthOuts).toBe(1);
    expect(result.llmFallbacks).toBe(1);
    expect(result.llmHits).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('A step that gains 0 shares omits a share tag', () => {
    const { state, me } = openingThree();
    const move = stepWithShareGain(state, me, 0);
    const row = annotateMove(geometry, rules, state, me, move);
    expect(row).not.toContain('share+');
    expect(hasBareShareTag(row)).toBe(false);
  });

  it('Pages still chooseMove, opponent unscored, parse prompt and stats fold stay pure', () => {
    const pages = pagesHeuristicSource();
    expect(pages).toMatch(/import \{[^}]*chooseMove/);
    expect(pages).not.toContain('chooseTurnBeam');
    expect(pages).not.toContain('playLlmBotTurn');
    expect(opponentSource()).toContain('export const chooseMove');
    expect(opponentSource()).toContain('let score = evaluate');
    const bot = byokBotSource();
    expect(bot).not.toMatch(/chooseTurnBeam/);
    expect(bot).not.toMatch(/\bevaluate\(/);
    expect(bot).not.toContain('Date.now');
    expect(bot).not.toContain('Math.random');
    expect(bot).not.toContain('performance.now');
    const foldStart = matchLogSource().indexOf('export const withByokStats');
    const foldEnd = matchLogSource().indexOf('export const withWinner');
    const fold = matchLogSource().slice(foldStart, foldEnd);
    expect(fold).not.toContain('Date.now');
    expect(fold).not.toContain('Math.random');
    expect(fold).not.toContain('performance.now');
    const log = withByokStats(oldByokMatchLog(), {
      llmHits: 1,
      llmFallbacks: 0,
      lastError: 'illegal tail indices: 99',
    });
    expect(JSON.stringify(log.byokStats)).not.toContain('sk-test');
    expect(log.byokStats).not.toHaveProperty('content');
    expect(log.byokStats).not.toHaveProperty('reasoning_content');
  });

  it('Teaching sync keeps P62 locks and drops the Play [2] assertion', () => {
    const teaching = readTeachingFile();
    const { me } = t1Opening();
    const system = buildSystemPrompt(me, true);
    expect(system).toContain(teaching);
    expect(teaching).toContain(SPEED_FORMULA);
    expect(teaching).toContain('On a split, both parts inherit');
    expect(teaching).toContain('majority');
    expect(teaching).toContain('speed 0');
    expect(teaching).toContain('follows the grain');
    expect(teaching).toContain('3-in / 3-out');
    expect(teaching).toContain('girth is 3');
    expect(teaching).toContain('unbounded');
    expect(teaching).toContain('one seat remains');
    expect(teaching).toContain('starvation');
    expect(teaching).toContain('"moves"');
    expect(teaching).toContain('endTurn');
    expect(teaching).not.toMatch(/domination/i);
    expect(teaching).not.toContain('§11');
    expect(teaching).not.toContain('even-odd');
    expect(teaching).not.toContain('evaporation front');
    expect(teaching).not.toContain('Play [2]');
    expect(teaching).not.toContain('L0');
    expect(teachingPromptCoreFeature()).toMatch(
      /@superseded-P63\s+Scenario: T1 tempo example prefers the lump index not peel-and-pass/,
    );
  });

  it('No per-completion rows, HUD graph, or evaluate score', () => {
    expect(matchLogSource()).not.toMatch(/readonly completions\s*:/);
    expect(hudSource()).not.toContain('promptTokens');
    expect(hudSource()).not.toContain('lengthOuts');
    const evalSpy = vi.spyOn(botEvaluate, 'evaluate');
    const beam = vi.spyOn(botSearch, 'chooseTurnBeam');
    withByokStats(oldByokMatchLog(), {
      llmHits: 0,
      llmFallbacks: 0,
      lastError: undefined,
    });
    expect(evalSpy).not.toHaveBeenCalled();
    expect(beam).not.toHaveBeenCalled();
    expect(byokBotSource()).toContain('chooseTurnGreedy');
  });

  it('One live thinking contract — P62 thinking-off is superseded', () => {
    const on = byokCompletionBody(readyConfig(), [{ role: 'user', content: '{}' }]);
    expect(thinkingFlags(on).kwargs).toBe(true);
    expect(on['max_tokens']).toBe(4096);
    expect(on['chat_template_kwargs']).toEqual(BYOK_THINKING_ON);
    const off = byokCompletionBody(readyConfig({ reasoning: false }), [
      { role: 'user', content: '{}' },
    ]);
    expect(thinkingFlags(off).kwargs).toBe(false);
    expect(off['max_tokens']).toBe(64);
    expect(off['chat_template_kwargs']).toEqual(BYOK_THINKING_OFF);
    expect(BYOK_REASONING_MAX_TOKENS).toBe(4096);
    expect(BYOK_FAST_MAX_TOKENS).toBe(64);
    expect(teachingPromptEdgeFeature()).toMatch(
      /@superseded-P63\s+Scenario: Token budgets and thinking-off stay P61/,
    );
    expect(webTestSource('byokBot.test.ts')).not.toMatch(/thinking forced off/);
    expect(webTestSource('byokBot.test.ts')).not.toMatch(/toBe\(512\)/);
    expect(webTestSource('byok-teaching-prompt.core.test.ts')).not.toContain(
      'T1 tempo example prefers the lump index not peel-and-pass',
    );
    expect(webTestSource('byok-teaching-prompt.edge-cases.test.ts')).not.toContain(
      'Token budgets and thinking-off stay P61',
    );
    expect(webTestSource('byok-teaching-prompt.invariants.test.ts')).not.toMatch(/toBe\(512\)/);
    const section1 = specSection1();
    expect(section1).toContain('docs/byok-teaching.md');
    expect(section1).toMatch(/non-normative/i);
    const spec = section1;
    expect(spec.match(/docs\/byok-teaching\.md/g)).toHaveLength(1);
  });
});
