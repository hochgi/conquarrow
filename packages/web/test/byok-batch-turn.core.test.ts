/**
 * docs/spec/byok-batch-turn/byok-batch-turn.core.feature
 * One it() per Gherkin scenario. Adapter only — no RTL, no jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import type { StepMove } from '@conquarrow/contracts';
import { playLlmBotTurn } from '../src/byokBot';
import { chooseTurnBeam, chooseTurnGreedy } from '../src/botSearch';
import * as botSearch from '../src/botSearch';
import {
  batchJson,
  botTurnSearchCoreFeature,
  botTurnSearchCoreTest,
  botTurnSearchSpec,
  fetchUrls,
  fromBlocks,
  fromsAreGrouped,
  indexOfStep,
  lastStepBoard,
  mockChat,
  offerSteps,
  openingThree,
  postedMessage,
  readyConfig,
  rules,
  geometry,
  t2Board,
  twoFromsBoard,
} from './byok-batch-turn.support';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BYOK commits an ordered step batch per completion', () => {
  it('Constructed T2 3-stack accepts a mocked count=3 lump', async () => {
    const { state, me, from, exit } = t2Board();
    const i = indexOfStep(state, (m) => m.from === from && m.exit === exit && m.count === 3);
    const spy = mockChat([batchJson([i], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    const lump = offerSteps(state)[i];
    expect(lump).toBeDefined();
    expect(result.moves).toEqual([lump, endTurn()]);
    expect(spy).toHaveBeenCalledTimes(1);
    const user = postedMessage(spy, 'user');
    const system = postedMessage(spy, 'system');
    expect(user).toMatch(/\[0\]/);
    expect(fromsAreGrouped(fromBlocks(user))).toBe(true);
    expect(user.toLowerCase()).not.toMatch(/pick one/);
    expect(system).toMatch(/"moves"/);
    expect(system).toMatch(/endTurn/);
    expect(system).toMatch(/2\^k/);
    expect(system).not.toMatch(/reject a shuttle|shuttles? are illegal|cannot shuttle/i);
    expect(user).not.toMatch(/\[\d+\] endTurn/);
    expect(system).not.toContain('{"move":N');
    expect(result.llmHits).toBe(1);
    expect(result.llmFallbacks).toBe(0);
  });

  it('Three mocked count=1 indices still apply — singletons are not hidden', async () => {
    const { state, me, from, exit } = t2Board();
    const i = indexOfStep(state, (m) => m.from === from && m.exit === exit && m.count === 1);
    const singleton = offerSteps(state)[i];
    expect(singleton).toBeDefined();
    if (singleton === undefined) return;
    const spy = mockChat([batchJson([i, i, i], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves.filter((m) => m.kind === 'step')).toEqual([singleton, singleton, singleton]);
    expect(result.moves.at(-1)).toEqual(endTurn());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.moves.filter((m) => m.kind === 'step' && m.count === 3)).toEqual([]);
  });

  it('Lump then 2-way split from the landing — leftover inherits spent', async () => {
    const { state, me } = openingThree();
    const lump = offerSteps(state).find((m) => m.count === 3);
    expect(lump).toBeDefined();
    if (lump === undefined) return;
    const lumpIndex = indexOfStep(
      state,
      (m) => m.from === lump.from && m.exit === lump.exit && m.count === 3,
    );
    const afterLump = rules.apply(state, lump);
    const ones = offerSteps(afterLump).filter((m) => m.from === lump.exit && m.count === 1);
    const a = ones[0];
    const b = ones.find((m) => m.exit !== a?.exit);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    const aI = indexOfStep(
      afterLump,
      (m) => m.from === a.from && m.exit === a.exit && m.count === 1,
    );
    const bI = indexOfStep(
      afterLump,
      (m) => m.from === b.from && m.exit === b.exit && m.count === 1,
    );
    const spy = mockChat([batchJson([lumpIndex], false), batchJson([aI, bI], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves).toEqual([lump, a, b, endTurn()]);
    const leftover = result.state.groups.get(lump.exit);
    expect(leftover?.owner).toBe(me);
    expect(leftover?.heads).toBe(1);
    const secondTiles = result.moves.filter(
      (m): m is StepMove => m.kind === 'step' && m.from === lump.exit,
    );
    expect(secondTiles).toHaveLength(2);
    expect(new Set(secondTiles.map((m) => String(m.exit))).size).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.llmHits).toBe(1);
  });

  it('Empty moves with endTurn true is a listed pass', async () => {
    const { state, me } = openingThree();
    const spy = mockChat([batchJson([], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves).toEqual([endTurn()]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.llmHits).toBe(1);
    expect(result.llmFallbacks).toBe(0);
  });

  it('Empty moves with endTurn false is empty prefix', async () => {
    const { state, me } = openingThree();
    const beam = vi.spyOn(botSearch, 'chooseTurnBeam');
    const spy = mockChat([batchJson([], false)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves).toEqual(chooseTurnGreedy(geometry, rules, state, me));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(beam).not.toHaveBeenCalled();
    expect(result.llmHits).toBe(0);
    expect(result.llmFallbacks).toBe(1);
  });

  it('Illegal tail ignores endTurn and re-prompts', async () => {
    const { state, me } = openingThree();
    const L = 0;
    const first = offerSteps(state)[L];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const after = rules.apply(state, first);
    expect(offerSteps(after).length).toBeGreaterThan(0);
    const spy = mockChat([batchJson([L, 99], true), batchJson([], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves).toEqual([first, endTurn()]);
    expect(result.lastError).toMatch(/99/);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.llmHits).toBe(1);
  });

  it('Prefix that exhausts steps forces endTurn even when the flag is false', async () => {
    const { state, me, lumpIndex } = lastStepBoard();
    const lump = offerSteps(state)[lumpIndex];
    expect(lump).toBeDefined();
    const spy = mockChat([batchJson([lumpIndex], false)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves.at(-1)).toEqual(endTurn());
    expect(result.moves[0]).toEqual(lump);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.llmHits).toBe(1);
    expect(result.llmFallbacks).toBe(0);
  });

  it('Two different froms in one moves array keep array order', async () => {
    const { state, me } = twoFromsBoard();
    const offer = offerSteps(state);
    const firstSeen = offer[0]?.from;
    expect(firstSeen).toBeDefined();
    const later = offer.find((m) => m.from !== firstSeen);
    const earlier = offer.find((m) => m.from === firstSeen);
    expect(later).toBeDefined();
    expect(earlier).toBeDefined();
    if (later === undefined || earlier === undefined) return;
    const iLater = offer.indexOf(later);
    const iEarlier = offer.indexOf(earlier);
    expect(iLater).toBeGreaterThan(iEarlier);
    rules.apply(rules.apply(state, later), earlier);
    const spy = mockChat([batchJson([iLater, iEarlier], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves[0]).toEqual(later);
    expect(result.moves[1]).toEqual(earlier);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Three completions of one successful seat-turn count as one hit', async () => {
    const { state, me, from, exit } = t2Board();
    const i1 = indexOfStep(state, (m) => m.from === from && m.exit === exit && m.count === 1);
    const s1 = offerSteps(state)[i1];
    expect(s1).toBeDefined();
    if (s1 === undefined) return;
    const mid1 = rules.apply(state, s1);
    const i2 = indexOfStep(mid1, (m) => m.from === from && m.exit === exit && m.count === 1);
    const s2 = offerSteps(mid1)[i2];
    expect(s2).toBeDefined();
    if (s2 === undefined) return;
    const mid2 = rules.apply(mid1, s2);
    const i3 = indexOfStep(mid2, (m) => m.from === from && m.exit === exit && m.count === 1);
    const spy = mockChat([
      batchJson([i1], false),
      batchJson([i2], false),
      batchJson([i3], true),
    ]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.llmHits).toBe(1);
    expect(result.llmFallbacks).toBe(0);
  });

  it('Unusable JSON is empty prefix with no extract retry', async () => {
    const { state, me } = openingThree();
    const beam = vi.spyOn(botSearch, 'chooseTurnBeam');
    const spy = mockChat(['Let me analyze. Group at tiling:a:-5,5,0. I think move 0 is best because...']);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves).toEqual(chooseTurnGreedy(geometry, rules, state, me));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fetchUrls(spy)).toHaveLength(1);
    expect(beam).not.toHaveBeenCalled();
    expect(result.llmFallbacks).toBe(1);
    expect(result.llmHits).toBe(0);
  });

  it('P53 shuttle/stride inventory is not rewritten', () => {
    expect(botTurnSearchSpec()).toMatch(/shuttle/i);
    expect(botTurnSearchCoreFeature()).toMatch(/stride/i);
    expect(botTurnSearchCoreTest()).toContain('strideTwoStackPosition');
    expect(botTurnSearchCoreTest()).toContain('chooseTurnBeam');
    const { state, me } = openingThree();
    const greedy = chooseTurnGreedy(geometry, rules, state, me);
    expect(greedy).toEqual(chooseTurnGreedy(geometry, rules, state, me));
    expect(chooseTurnBeam(geometry, rules, state, me).length).toBeGreaterThan(0);
  });
});
