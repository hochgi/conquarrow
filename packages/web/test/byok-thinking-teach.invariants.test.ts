/**
 * EARS invariants for docs/spec/byok-thinking-teach/byok-thinking-teach.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/byok-teaching-prompt.invariants.test.ts).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import {
  BYOK_FAST_MAX_TOKENS,
  BYOK_REASONING_MAX_TOKENS,
  annotateMove,
  buildSystemPrompt,
  byokCompletionBody,
  formatLegalMoves,
  parseMoveBatch,
  playLlmBotTurn,
  testByokConnection,
} from '../src/byokBot';
import { chooseTurnGreedy } from '../src/botSearch';
import { withByokStats } from '../src/matchLog';
import {
  batchJson,
  byokBotSource,
  indexOfStep,
  mockChat,
  offerSteps,
  pagesHeuristicSource,
  postedBody,
  readyConfig,
  t2Board,
} from './byok-batch-turn.support';
import {
  CLOSE_VS_CUT_LABELS,
  SPEED_FORMULA,
  TEACHING_LOCKS,
  readTeachingFile,
  t1Opening,
} from './byok-teaching-prompt.support';
import {
  ESSAY_THEN_ONE_BATCH,
  ESSAY_THEN_TWO_BATCHES,
  PINWHEEL_LABELS,
  UNUSABLE_PROSE,
  WHOLE_STRING_NESTED,
  firstStep,
  geometry,
  hasBareShareTag,
  matchLogSource,
  mockChatCompletions,
  oldByokMatchLog,
  openingThree,
  parseSpdSpentLeft,
  rules,
  rulesWithShareGain,
  shareCountOf,
  stepRows,
  t1Section,
  thinkingFlags,
  webTestSource,
} from './byok-thinking-teach.support';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('byok-thinking-teach invariants', () => {
  it('WHEN config.reasoning is true, a live-turn byokCompletionBody shall send enable_thinking: true on both kwargs copies and max_tokens === 4096.', () => {
    const body = byokCompletionBody(readyConfig(), [{ role: 'user', content: '{}' }]);
    const flags = thinkingFlags(body);
    expect(flags.kwargs).toBe(true);
    expect(flags.extra).toBe(true);
    expect(body['max_tokens']).toBe(4096);
    expect(BYOK_REASONING_MAX_TOKENS).toBe(4096);
  });

  it('WHEN config.reasoning is false, a live-turn byokCompletionBody shall send enable_thinking: false on both kwargs copies and max_tokens === 64.', () => {
    const body = byokCompletionBody(readyConfig({ reasoning: false }), [
      { role: 'user', content: '{}' },
    ]);
    const flags = thinkingFlags(body);
    expect(flags.kwargs).toBe(false);
    expect(flags.extra).toBe(false);
    expect(body['max_tokens']).toBe(64);
    expect(BYOK_FAST_MAX_TOKENS).toBe(64);
  });

  it('WHEN testByokConnection runs, the posted body shall use thinking off and max_tokens === 64 even if config.reasoning is true, and shall still be the move-0 probe (not the batch contract).', async () => {
    const spy = mockChat(['{"move":0,"why":"probe"}']);
    const result = await testByokConnection(readyConfig({ reasoning: true }), spy);
    expect(result.ok).toBe(true);
    const body = postedBody(spy);
    expect(thinkingFlags(body).kwargs).toBe(false);
    expect(thinkingFlags(body).extra).toBe(false);
    expect(body['max_tokens']).toBe(64);
  });

  it('The teaching file shall not contain Play [2]. It shall still list [0] count=1, [1] count=2, [2] count=3, teach lump = 2 tiles vs split 2+1 = 3 tiles, and say not to peel three count=1 as three POSTs.', () => {
    const teaching = readTeachingFile();
    const t1 = t1Section(teaching);
    expect(teaching).not.toContain('Play [2]');
    expect(t1).toContain('[0]');
    expect(t1).toContain('count=1');
    expect(t1).toContain('[1]');
    expect(t1).toContain('count=2');
    expect(t1).toContain('[2]');
    expect(t1).toContain('count=3');
    expect(t1).toMatch(/2 tiles/);
    expect(t1).toMatch(/2\s*\+\s*1/);
    expect(t1).toMatch(/3 tiles|three tiles/i);
    expect(t1).toMatch(/POST/i);
  });

  it('The teaching file and every buildSystemPrompt result shall contain Before, After 1-share, and After 3-share, and shall contain Close vs cut, After close, and After cut.', () => {
    const teaching = readTeachingFile();
    const { me } = t1Opening();
    const system = buildSystemPrompt(me, true);
    for (const label of [...PINWHEEL_LABELS, ...CLOSE_VS_CUT_LABELS]) {
      expect(teaching, label).toContain(label);
      expect(system, label).toContain(label);
    }
  });

  it('WHEN gainedShare > 0, the LEGAL_MOVES step row shall contain share+N with N equal to that delta and shall not use a bare share tag. WHEN gainedShare is 0, the row shall omit a share tag.', () => {
    const { state, me } = openingThree();
    const wrapped = rulesWithShareGain(me, 2);
    const gaining = firstStep(state);
    expect(shareCountOf(wrapped.apply(state, gaining), me) - shareCountOf(state, me)).toBe(2);
    const plus = annotateMove(geometry, wrapped, state, me, gaining);
    expect(plus).toContain('share+2');
    expect(hasBareShareTag(plus)).toBe(false);
    for (const move of offerSteps(state)) {
      let after;
      try {
        after = rules.apply(state, move);
      } catch {
        continue;
      }
      const gain = shareCountOf(after, me) - shareCountOf(state, me);
      const row = annotateMove(geometry, rules, state, me, move);
      if (gain > 0) {
        expect(row).toContain(`share+${String(gain)}`);
        expect(hasBareShareTag(row)).toBe(false);
      } else {
        expect(row).not.toContain('share+');
        expect(hasBareShareTag(row)).toBe(false);
      }
    }
  });

  it('WHEN a step row is printed, it shall contain left=K with K = portionSpd - spent (the same integers as spd and spent).', () => {
    const { state, me } = openingThree();
    const listed = formatLegalMoves(offerSteps(state), geometry, rules, state, me);
    for (const row of stepRows(listed)) {
      const parsed = parseSpdSpentLeft(row);
      expect(row).toContain(`left=${String(parsed.spd - parsed.spent)}`);
      expect(parsed.left).toBe(parsed.spd - parsed.spent);
    }
    const pair = offerSteps(state).find((m) => m.count === 2);
    expect(pair).toBeDefined();
    if (pair === undefined) return;
    const after = rules.apply(state, pair);
    const spentListed = formatLegalMoves(offerSteps(after), geometry, rules, after, me);
    const inherited = stepRows(spentListed).find((row) => /spent=1/.test(row));
    expect(inherited).toBeDefined();
    if (inherited === undefined) return;
    const parsed = parseSpdSpentLeft(inherited);
    expect(parsed.left).toBe(parsed.spd - parsed.spent);
  });

  it('WHEN fence-stripped text is an essay plus more than one JSON object, parseMoveBatch shall return the last usable batch.', () => {
    expect(parseMoveBatch(ESSAY_THEN_TWO_BATCHES)).toEqual({
      indices: [0],
      endTurn: true,
    });
  });

  it('WHEN whole-string JSON.parse yields a usable batch, salvageParses shall stay 0 for that completion.', async () => {
    expect(parseMoveBatch(WHOLE_STRING_NESTED)).toEqual({
      indices: [1],
      endTurn: true,
    });
    const { state, me } = openingThree();
    const result = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChat([batchJson([0], true)]),
    );
    expect(result.salvageParses ?? 0).toBe(0);
  });

  it('WHEN no usable batch exists, the system shall treat the prefix as empty, run greedy-v1 remainder, issue no extract-retry POST, and count a fallback.', async () => {
    const { state, me } = openingThree();
    const spy = mockChat([UNUSABLE_PROSE]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves).toEqual(chooseTurnGreedy(geometry, rules, state, me));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.llmFallbacks).toBe(1);
  });

  it('WHEN the whole-string parse fails and a nested/last usable batch succeeds, salvageParses shall increase by 1 for that completion and fetch shall have been called once.', async () => {
    const { state, me } = openingThree();
    const spy = mockChat([ESSAY_THEN_ONE_BATCH]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(parseMoveBatch(ESSAY_THEN_ONE_BATCH)).toEqual({ indices: [0], endTurn: true });
    expect(result.salvageParses).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('WHEN usage / finish_reason is missing, token fields shall read as 0 and the fold shall not throw.', async () => {
    const { state, me } = openingThree();
    const result = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChatCompletions([{ content: batchJson([0], true) }]),
    );
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
    expect(result.lengthOuts).toBe(0);
  });

  it('WHEN an old match log omits the new stats fields, load and withByokStats shall treat them as 0.', () => {
    const next = withByokStats(oldByokMatchLog(), {
      llmHits: 0,
      llmFallbacks: 0,
      lastError: undefined,
      promptTokens: 3,
      completionTokens: 5,
      lengthOuts: 1,
      salvageParses: 1,
      maxTokens: 4096,
    });
    expect(next.byokStats?.promptTokens).toBe(3);
    expect(next.byokStats?.maxTokens).toBe(4096);
  });

  it('WHEN finish_reason is length (or max_tokens) and last-JSON is still a usable batch whose prefix is nonempty, the system shall increment lengthOuts and shall still count a hit.', async () => {
    const { state, me } = openingThree();
    const length = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChatCompletions([{ content: ESSAY_THEN_ONE_BATCH, finish_reason: 'length' }]),
    );
    expect(length.llmHits).toBe(1);
    expect(length.lengthOuts).toBe(1);
    const synonym = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChatCompletions([{ content: ESSAY_THEN_ONE_BATCH, finish_reason: 'max_tokens' }]),
    );
    expect(synonym.lengthOuts).toBe(1);
    expect(synonym.llmHits).toBe(1);
  });

  it('WHEN finish_reason is length and the text is unusable, the system shall increment lengthOuts and shall count a fallback.', async () => {
    const { state, me } = openingThree();
    const result = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChatCompletions([{ content: UNUSABLE_PROSE, finish_reason: 'length' }]),
    );
    expect(result.lengthOuts).toBe(1);
    expect(result.llmFallbacks).toBe(1);
    expect(result.llmHits).toBe(0);
  });

  it('The teaching file shall still contain the P62 locked substrings and shall not contain domination (any case), §11, even-odd, or evaporation front.', () => {
    const teaching = readTeachingFile();
    for (const phrase of TEACHING_LOCKS) {
      expect(teaching, phrase).toContain(phrase);
    }
    expect(teaching).toContain(SPEED_FORMULA);
    expect(teaching).not.toMatch(/domination/i);
    expect(teaching).not.toContain('§11');
    expect(teaching).not.toContain('even-odd');
    expect(teaching).not.toContain('evaporation front');
  });

  it('packages/online-api/src/pages-heuristic.ts shall keep importing chooseMove and shall not import chooseTurnBeam. opponent.ts scoring shall not be edited. The system shall not call evaluate or chooseTurnBeam to grade or hint BYOK.', () => {
    const src = pagesHeuristicSource();
    expect(src).toMatch(/import \{[^}]*chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
    expect(byokBotSource()).not.toMatch(/chooseTurnBeam/);
    expect(byokBotSource()).not.toMatch(/\bevaluate\(/);
  });

  it('Parse, prompt builders, byokCompletionBody, and the withByokStats numeric fold shall not use Date.now, Math.random, or performance.now.', () => {
    const bot = byokBotSource();
    expect(bot).not.toContain('Date.now');
    expect(bot).not.toContain('Math.random');
    expect(bot).not.toContain('performance.now');
    const fold = matchLogSource().slice(
      matchLogSource().indexOf('export const withByokStats'),
      matchLogSource().indexOf('export const withWinner'),
    );
    expect(fold).not.toContain('Date.now');
    expect(fold).not.toContain('Math.random');
    expect(fold).not.toContain('performance.now');
  });

  it('There shall be one live thinking contract: lobby true → on/4096; lobby false → off/64; probe → off/64. P62/P61 tests shall not pin enable_thinking: false on a reasoning-true live-turn body.', () => {
    expect(
      byokCompletionBody(readyConfig(), [{ role: 'user', content: '{}' }])['max_tokens'],
    ).toBe(4096);
    expect(
      thinkingFlags(byokCompletionBody(readyConfig(), [{ role: 'user', content: '{}' }])).kwargs,
    ).toBe(true);
    expect(webTestSource('byokBot.test.ts')).not.toMatch(/toBe\(512\)/);
    expect(webTestSource('byok-teaching-prompt.invariants.test.ts')).not.toMatch(/toBe\(512\)/);
    expect(webTestSource('byok-teaching-prompt.edge-cases.test.ts')).not.toContain(
      'Token budgets and thinking-off stay P61',
    );
  });

  it('P61 illegal-tail re-prompt, empty-prefix greedy-v1, and mocked count=3 lump apply shall stay green.', async () => {
    const { state, me, from, exit } = t2Board();
    const i = indexOfStep(state, (m) => m.from === from && m.exit === exit && m.count === 3);
    const lump = offerSteps(state)[i];
    const lumped = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChat([batchJson([i], true)]),
    );
    expect(lumped.moves).toEqual([lump, endTurn()]);
    expect(lumped.llmHits).toBe(1);
    const { state: open, me: openMe } = openingThree();
    const empty = await playLlmBotTurn(
      geometry,
      rules,
      open,
      openMe,
      readyConfig(),
      mockChat([batchJson([], false)]),
    );
    expect(empty.llmFallbacks).toBe(1);
    expect(parseMoveBatch(UNUSABLE_PROSE)).toBeUndefined();
  });

  it('withByokStats shall persist maxTokens as the max of previous and delta (missing = 0).', () => {
    const first = withByokStats(oldByokMatchLog(), {
      llmHits: 0,
      llmFallbacks: 0,
      lastError: undefined,
      maxTokens: 64,
    });
    expect(first.byokStats?.maxTokens).toBe(64);
    const second = withByokStats(first, {
      llmHits: 0,
      llmFallbacks: 0,
      lastError: undefined,
      maxTokens: 4096,
    });
    expect(second.byokStats?.maxTokens).toBe(4096);
    const third = withByokStats(second, {
      llmHits: 0,
      llmFallbacks: 0,
      lastError: undefined,
      maxTokens: 64,
    });
    expect(third.byokStats?.maxTokens).toBe(4096);
  });

  it('Stats, lastError, and match logs shall not contain the API key, raw content, or reasoning_content.', async () => {
    const { state, me } = openingThree();
    const result = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig({ apiKey: 'sk-secret-key' }),
      mockChat([batchJson([0], true)]),
    );
    expect(JSON.stringify(result)).not.toContain('sk-secret-key');
    expect(JSON.stringify(result)).not.toContain('reasoning_content');
    const log = withByokStats(oldByokMatchLog(), {
      llmHits: result.llmHits,
      llmFallbacks: result.llmFallbacks,
      lastError: result.lastError,
    });
    expect(JSON.stringify(log.byokStats)).not.toContain('sk-secret-key');
    expect(log.byokStats).not.toHaveProperty('content');
    expect(log.byokStats).not.toHaveProperty('reasoning_content');
  });
});
