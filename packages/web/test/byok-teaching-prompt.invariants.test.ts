/**
 * EARS invariants for docs/spec/byok-teaching-prompt/byok-teaching-prompt.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/byok-batch-turn.invariants.test.ts).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTurn, movesEqual } from '@conquarrow/contracts';
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseMoveBatch,
  playLlmBotTurn,
} from '../src/byokBot';
import * as botSearch from '../src/botSearch';
import { clearTargetLocks, formatTargetsForPrompt, syncTargetLocks } from '../src/targets';
import {
  batchJson,
  indexOfStep,
  mockChat,
  readyConfig,
  t2Board,
} from './byok-batch-turn.support';
import {
  SPEED_FORMULA,
  SUGGESTION_ONLY,
  TEACHING_LOCKS,
  baselineLine,
  byokBotSource,
  chooseOfferStep,
  geometry,
  offerIndexOf,
  offerSteps,
  pagesHeuristicSource,
  readTeachingFile,
  rules,
  specSection1,
  t1Opening,
  withEmptyTerritory,
  withTrailLen,
} from './byok-teaching-prompt.support';

afterEach(() => {
  vi.restoreAllMocks();
  clearTargetLocks();
});

describe('byok-teaching-prompt invariants', () => {
  it('The system shall include the full docs/byok-teaching.md body in every buildSystemPrompt result.', () => {
    const teaching = readTeachingFile();
    const { me } = t1Opening();
    for (const reasoning of [true, false]) {
      const system = buildSystemPrompt(me, reasoning);
      expect(system).toContain(SPEED_FORMULA);
      expect(system).not.toContain('Domination needs shares');
    }
    expect(teaching.length).toBeGreaterThan(0);
    expect(buildSystemPrompt(me, true)).toContain(teaching);
  });

  it('WHEN the teaching file is read, it shall contain the locked substrings in BSSN 3.', () => {
    const teaching = readTeachingFile();
    for (const phrase of TEACHING_LOCKS) {
      expect(teaching, phrase).toContain(phrase);
    }
    expect(teaching).toContain(SPEED_FORMULA);
  });

  it('The teaching file shall not contain domination (any case).', () => {
    expect(readTeachingFile()).not.toMatch(/domination/i);
  });

  it('WHEN buildUserPrompt runs, the live user prompt shall not contain via count= and shall not contain prefer (case-insensitive).', () => {
    const { state, me, offer } = t1Opening();
    const targets = syncTargetLocks(geometry, rules, state, me);
    const live = buildUserPrompt(geometry, state, me, offer, true, rules, targets);
    expect(live).not.toContain('via count=');
    expect(live).not.toMatch(/prefer /i);
  });

  it('WHEN chooseMove returns a step that is in this offer, the user prompt shall name that step’s offer index as a weak one-ply baseline labelled suggestion only.', () => {
    const { state, me, offer } = t1Opening();
    const chosen = chooseOfferStep(state, me);
    const index = offerIndexOf(offer, chosen);
    const prompt = buildUserPrompt(geometry, state, me, offer, true, rules);
    expect(prompt).toContain(baselineLine(index, chosen));
    expect(prompt).toContain(SUGGESTION_ONLY);
  });

  it('WHEN the offer is empty, or rules is omitted, or chooseMove is endTurn, or the chosen step is not in the offer, the system shall omit the baseline paragraph.', () => {
    const { state, me, offer } = t1Opening();
    const empty = buildUserPrompt(geometry, state, me, [], true, rules);
    const noRules = buildUserPrompt(geometry, state, me, offer, true);
    const chosen = chooseOfferStep(state, me);
    const filtered = offer.filter((move) => !movesEqual(move, chosen));
    const notInOffer = buildUserPrompt(geometry, state, me, filtered, true, rules);
    for (const prompt of [empty, noRules, notInOffer]) {
      expect(prompt).not.toContain('weak one-ply baseline');
      expect(prompt).not.toContain(SUGGESTION_ONLY);
    }
  });

  it('WHILE target locks exist, the system shall still tag matching LEGAL_MOVES rows on_target and shall not print a TARGETS block in the live user prompt.', () => {
    const { state, me, offer } = t1Opening();
    const targets = syncTargetLocks(geometry, rules, state, me);
    expect(targets.length).toBeGreaterThan(0);
    expect(formatTargetsForPrompt(targets)).toContain('TARGETS');
    const prompt = buildUserPrompt(geometry, state, me, offer, true, rules, targets);
    expect(prompt).toContain('on_target');
    expect(prompt).not.toContain('TARGETS');
  });

  it('The system shall not call chooseTurnBeam to produce the baseline.', () => {
    const { state, me, offer } = t1Opening();
    const beam = vi.spyOn(botSearch, 'chooseTurnBeam');
    buildUserPrompt(geometry, state, me, offer, true, rules);
    expect(beam).not.toHaveBeenCalled();
    expect(byokBotSource()).not.toMatch(/chooseTurnBeam/);
  });

  it('WHEN the same state, offer, and ports are given twice, the baseline index shall be identical.', () => {
    const { state, me, offer } = t1Opening();
    const chosen = chooseOfferStep(state, me);
    const index = offerIndexOf(offer, chosen);
    const a = buildUserPrompt(geometry, state, me, offer, true, rules);
    const b = buildUserPrompt(geometry, state, me, offer, true, rules);
    expect(a).toBe(b);
    const marker = `A weak one-ply baseline would play \`[${String(index)}]\``;
    expect(a).toContain(marker);
    expect(b).toContain(marker);
  });

  it('The prompt builder in packages/web/src/byokBot.ts shall not use Date.now, Math.random, or performance.now.', () => {
    const src = byokBotSource();
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
  });

  it('packages/online-api/src/pages-heuristic.ts shall keep importing chooseMove and shall not import chooseTurnBeam.', () => {
    const src = pagesHeuristicSource();
    expect(src).toMatch(/import \{[^}]*chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
    expect(src).not.toContain('playLlmBotTurn');
  });

  it('The P61 batch parse / illegal-tail / empty-prefix loop shall stay the live turn protocol.', async () => {
    expect(parseMoveBatch('{"moves":[3,0],"endTurn":false}')).toEqual({
      indices: [3, 0],
      endTurn: false,
    });
    expect(parseMoveBatch('{"move":0,"endTurn":true}')).toBeUndefined();
    const { state, me, from, exit } = t2Board();
    const i = indexOfStep(state, (m) => m.from === from && m.exit === exit && m.count === 3);
    const lump = offerSteps(state)[i];
    expect(lump).toBeDefined();
    const spy = mockChat([batchJson([i], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.moves).toEqual([lump, endTurn()]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.llmHits).toBe(1);
  });

  it('SPEC.md §1 shall point at docs/byok-teaching.md as non-normative and shall say the teaching file must not add a game rule.', () => {
    const section1 = specSection1();
    expect(section1).toContain('docs/byok-teaching.md');
    expect(section1).toMatch(/non-normative/i);
    expect(section1).toContain('must not add a game rule');
  });

  it('WHILE shares are 0 or trailLen >= 4, the phase line shall still be facts only (Shares=, trailLen=).', () => {
    const { state, me, offer } = t1Opening();
    const zero = buildUserPrompt(geometry, withEmptyTerritory(state), me, offer, true, rules);
    const long = buildUserPrompt(geometry, withTrailLen(state, me, 4), me, offer, true, rules);
    for (const prompt of [zero, long]) {
      expect(prompt).toMatch(/^Shares=\d+, trailLen=\d+\.$/m);
      expect(prompt).not.toMatch(/prefer /i);
    }
  });

  it('The teaching file shall not contain §11, even-odd, or evaporation front.', () => {
    const teaching = readTeachingFile();
    expect(teaching).not.toContain('§11');
    expect(teaching).not.toContain('even-odd');
    expect(teaching).not.toContain('evaporation front');
  });
});
