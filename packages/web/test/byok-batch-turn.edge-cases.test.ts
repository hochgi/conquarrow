/**
 * docs/spec/byok-batch-turn/byok-batch-turn.edge-cases.feature
 * One it() per Gherkin scenario. Adapter only — no RTL, no jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import { playLlmBotTurn, testByokConnection } from '../src/byokBot';
import { chooseTurnGreedy } from '../src/botSearch';
import * as botSearch from '../src/botSearch';
import * as opponent from '../src/opponent';
import { playBotTurn } from '../src/opponent';
import { DEFAULT_BYOK } from '../src/byokConfig';
import {
  batchJson,
  byokBotSource,
  fetchUrls,
  geometry,
  indexOfStep,
  manyStacksBoard,
  mockChat,
  offerSteps,
  openingThree,
  pagesHeuristicSource,
  postedBody,
  postedMessage,
  readyConfig,
  rules,
  spentOutBoard,
  t2Board,
  winningStepBoard,
} from './byok-batch-turn.support';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BYOK batch turn — win, caps, seams, purity', () => {
  it('Mid-batch win stops without endTurn and is not a fallback', async () => {
    const { state, me, winIndex, extraIndex, winning } = winningStepBoard();
    const spy = mockChat([batchJson([winIndex, extraIndex], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves).toEqual([winning]);
    expect(result.moves.some((m) => m.kind === 'endTurn')).toBe(false);
    const extra = offerSteps(state)[extraIndex];
    expect(extra).toBeDefined();
    expect(result.moves).not.toContainEqual(extra);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.llmHits).toBe(1);
    expect(result.llmFallbacks).toBe(0);
    expect(result.state.winner).toBe(me);
  });

  it('Eighth completion warns; sixty-four completions then still active force endTurn', async () => {
    const { state, me } = manyStacksBoard();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = mockChat([batchJson([0], false)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(result.llmFallbacks).toBe(0);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(64);
    expect(result.moves.at(-1)).toEqual(endTurn());
    expect(result.state.winner).toBeUndefined();
    expect(result.llmHits).toBe(1);
  });

  it('not-ready config calls playBotTurn beam-v1 not the batch protocol', async () => {
    const { state, me } = openingThree();
    const beam = vi.spyOn(botSearch, 'chooseTurnBeam');
    const greedyMove = vi.spyOn(opponent, 'chooseMove');
    const spy = mockChat([batchJson([], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, DEFAULT_BYOK, spy);
    const expected = playBotTurn(geometry, rules, state, me);
    expect(result.moves).toEqual(expected.moves);
    expect(spy).not.toHaveBeenCalled();
    expect(beam).toHaveBeenCalled();
    expect(greedyMove).not.toHaveBeenCalled();
    expect(result.llmHits).toBe(0);
    expect(result.llmFallbacks).toBe(0);
    expect(result.lastError).toBe('byok not ready');
  });

  it('useTurnRunner true still does not call the runner', async () => {
    const { state, me } = openingThree();
    const spy = mockChat([batchJson([], true)]);
    const result = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig({
        useTurnRunner: true,
        turnRunnerUrl: 'http://127.0.0.1:4010',
      }),
      spy,
    );
    expect(fetchUrls(spy).some((url) => url.includes('/v1/pick'))).toBe(false);
    expect(spy).toHaveBeenCalled();
    const body = postedBody(spy, 0);
    expect(body['messages']).toBeDefined();
    expect(body['response_format']).toEqual({ type: 'json_object' });
    expect(result.llmHits).toBe(1);
  });

  it('testByokConnection still accepts a move-0 probe', async () => {
    const spy = mockChat(['{"move":0,"why":"probe"}']);
    const result = await testByokConnection(readyConfig(), spy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sample).toContain('move');
    const system = postedMessage(spy, 'system');
    const user = postedMessage(spy, 'user');
    expect(system).toContain('{"move":0,"why":"probe"}');
    expect(user).toContain('{"move":0,"why":"probe"}');
    expect(system).not.toMatch(/"moves"/);
    expect(user).not.toMatch(/"moves"/);
  });

  it('Same state and same mock replies yield byte-identical Move lists', async () => {
    const { state, me, from, exit } = t2Board();
    const i = indexOfStep(state, (m) => m.from === from && m.exit === exit && m.count === 3);
    const replies = [batchJson([i], true)];
    const a = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), mockChat(replies));
    const b = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), mockChat(replies));
    expect(JSON.stringify(a.moves)).toBe(JSON.stringify(b.moves));
    expect(offerSteps(state)).toEqual(
      rules.legalMoves(state).filter((m): m is (typeof m & { kind: 'step' }) => m.kind === 'step'),
    );
    const src = byokBotSource();
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
  });

  it('Pages heuristic still imports chooseMove', () => {
    const src = pagesHeuristicSource();
    expect(src).toMatch(/import \{[^}]*chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
    expect(src).not.toContain('playLlmBotTurn');
  });

  it('HTTP failure is empty prefix with no extract retry', async () => {
    const { state, me } = openingThree();
    const beam = vi.spyOn(botSearch, 'chooseTurnBeam');
    const spy = vi.fn(() => Promise.reject(new Error('network')));
    const result = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig({ apiKey: 'sk-secret-key-do-not-leak' }),
      spy,
    );
    expect(result.moves).toEqual(chooseTurnGreedy(geometry, rules, state, me));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(beam).not.toHaveBeenCalled();
    expect(result.llmFallbacks).toBe(1);
    expect(result.lastError ?? '').not.toContain('sk-secret-key-do-not-leak');
  });

  it('Unusable second completion after a good prefix falls back once', async () => {
    const { state, me } = openingThree();
    const first = offerSteps(state)[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const after = rules.apply(state, first);
    expect(offerSteps(after).length).toBeGreaterThan(0);
    const beam = vi.spyOn(botSearch, 'chooseTurnBeam');
    const spy = mockChat([batchJson([0], false), 'not-json-at-all']);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves[0]).toEqual(first);
    expect(result.moves.slice(1)).toEqual(chooseTurnGreedy(geometry, rules, after, me));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(beam).not.toHaveBeenCalled();
    expect(result.llmHits).toBe(0);
    expect(result.llmFallbacks).toBe(1);
  });

  it('Empty offer forces endTurn without a POST', async () => {
    const { state, me } = spentOutBoard();
    const spy = mockChat([batchJson([], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves).toEqual([endTurn()]);
    expect(spy).not.toHaveBeenCalled();
    expect(result.llmHits).toBe(1);
    expect(result.llmFallbacks).toBe(0);
  });
});
