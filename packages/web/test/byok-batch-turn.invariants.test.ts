/**
 * EARS invariants for docs/spec/byok-batch-turn/byok-batch-turn.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/botPlayback.invariants.test.ts).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import { movesForLlm, parseMoveBatch, playLlmBotTurn } from '../src/byokBot';
import { chooseTurnGreedy } from '../src/botSearch';
import * as botSearch from '../src/botSearch';
import {
  batchJson,
  byokBotSource,
  geometry,
  indexOfStep,
  mockChat,
  offerSteps,
  openingThree,
  pagesHeuristicSource,
  readyConfig,
  rules,
  t2Board,
} from './byok-batch-turn.support';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('byok-batch-turn invariants', () => {
  it('WHEN playLlmBotTurn runs with a ready config and the mock returns a full origin batch plus endTurn true, the system shall issue exactly one completion.', async () => {
    const { state, me, from, exit } = t2Board();
    const i = indexOfStep(state, (m) => m.from === from && m.exit === exit && m.count === 3);
    const spy = mockChat([batchJson([i], true)]);
    await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('WHEN the legal prefix is nonempty and an illegal tail remains, the system shall ignore endTurn true and shall not skip the illegal item.', async () => {
    const { state, me } = openingThree();
    const offer = offerSteps(state);
    expect(offer.length).toBeGreaterThan(2);
    const first = offer[0];
    const later = offer[1];
    expect(first).toBeDefined();
    expect(later).toBeDefined();
    if (first === undefined || later === undefined) return;
    const spy = mockChat([batchJson([0, 99, 1], true), batchJson([], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves[0]).toEqual(first);
    expect(result.moves).not.toContainEqual(later);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.moves.at(-1)).toEqual(endTurn());
  });

  it('WHEN the prefix is empty, the system shall finish with greedy-v1 and shall not call chooseTurnBeam or issue an extract-retry POST.', async () => {
    const { state, me } = openingThree();
    const cases = [
      batchJson([], false),
      'prose that is not the batch JSON object',
      '{"moves":[0]}',
      '{"endTurn":true}',
      '{"moves":[0.5],"endTurn":true}',
      '{"moves":["0"],"endTurn":true}',
    ];
    for (const reply of cases) {
      const beam = vi.spyOn(botSearch, 'chooseTurnBeam');
      const spy = mockChat([reply]);
      const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
      expect(result.moves).toEqual(chooseTurnGreedy(geometry, rules, state, me));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(beam).not.toHaveBeenCalled();
      expect(result.llmFallbacks).toBe(1);
      expect(result.llmHits).toBe(0);
      beam.mockRestore();
    }
  });

  it('The system shall apply a mocked count=3 lump and shall also apply three mocked count=1 steps — it shall not hide singletons.', async () => {
    const { state, me, from, exit } = t2Board();
    const lumpI = indexOfStep(state, (m) => m.from === from && m.exit === exit && m.count === 3);
    const oneI = indexOfStep(state, (m) => m.from === from && m.exit === exit && m.count === 1);
    const lump = offerSteps(state)[lumpI];
    const one = offerSteps(state)[oneI];
    expect(lump).toBeDefined();
    expect(one).toBeDefined();
    if (lump === undefined || one === undefined) return;
    const lumped = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChat([batchJson([lumpI], true)]),
    );
    expect(lumped.moves.filter((m) => m.kind === 'step')).toEqual([lump]);
    const peeled = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChat([batchJson([oneI, oneI, oneI], true)]),
    );
    expect(peeled.moves.filter((m) => m.kind === 'step')).toEqual([one, one, one]);
  });

  it('WHILE the offer is built, endTurn shall not occupy an index.', () => {
    const boards = [openingThree().state, t2Board().state];
    for (const state of boards) {
      const legal = rules.legalMoves(state);
      expect(movesForLlm(legal).some((m) => m.kind === 'endTurn')).toBe(false);
      expect(movesForLlm(legal)).toEqual(legal.filter((m) => m.kind === 'step'));
    }
  });

  it('playLlmBotTurn is the only live BYOK turn protocol', () => {
    const src = byokBotSource();
    const start = src.indexOf('export const playLlmBotTurn');
    expect(start).toBeGreaterThanOrEqual(0);
    const body = src.slice(start);
    expect(body).toContain('fetchLlmMoveBatch');
    expect(body).not.toContain('chooseLlmMove');
    expect(body).not.toContain('fetchLlmMoveIndex');
    expect(body).not.toContain('parseMoveIndex');
  });

  it('parseMoveBatch accepts only the batch JSON object', () => {
    expect(parseMoveBatch('{"moves":[3,0],"endTurn":false}')).toEqual({
      indices: [3, 0],
      endTurn: false,
    });
    expect(parseMoveBatch('{"moves":[],"endTurn":true,"why":"pass"}')).toEqual({
      indices: [],
      endTurn: true,
    });
    expect(parseMoveBatch('{"moves":[-1,99],"endTurn":false,"extra":true}')).toEqual({
      indices: [-1, 99],
      endTurn: false,
    });
    expect(parseMoveBatch('```json\n{"moves":[0],"endTurn":true}\n```')).toEqual({
      indices: [0],
      endTurn: true,
    });
    expect(parseMoveBatch('{"move":0,"endTurn":true}')).toBeUndefined();
    expect(parseMoveBatch('{"moves":[0]}')).toBeUndefined();
    expect(parseMoveBatch('{"endTurn":true}')).toBeUndefined();
    expect(parseMoveBatch('{"moves":[0.5],"endTurn":true}')).toBeUndefined();
    expect(parseMoveBatch('{"moves":["0"],"endTurn":true}')).toBeUndefined();
    expect(parseMoveBatch('{"moves":[0],"endTurn":"true"}')).toBeUndefined();
    expect(parseMoveBatch('thinking...\nANSWER: 2')).toBeUndefined();
    expect(parseMoveBatch('<<<MOVE:2>>>')).toBeUndefined();
    expect(parseMoveBatch('3')).toBeUndefined();
    expect(parseMoveBatch('')).toBeUndefined();
  });

  it('WHEN the same state and the same mock replies are given twice, the returned Move lists shall be byte-identical. Chooser paths shall not use Date.now, Math.random, or performance.now.', async () => {
    const { state, me } = openingThree();
    const replies = [batchJson([], true)];
    const a = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), mockChat(replies));
    const b = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), mockChat(replies));
    expect(JSON.stringify(a.moves)).toBe(JSON.stringify(b.moves));
    const src = byokBotSource();
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
  });

  it('pages-heuristic.ts shall keep importing chooseMove and shall not import chooseTurnBeam or playLlmBotTurn.', () => {
    const src = pagesHeuristicSource();
    expect(src).toMatch(/import \{[^}]*chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
    expect(src).not.toContain('playLlmBotTurn');
  });
});
