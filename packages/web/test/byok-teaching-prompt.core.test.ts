/**
 * docs/spec/byok-teaching-prompt/byok-teaching-prompt.core.feature
 * One it() per Gherkin scenario. Adapter only — no RTL, no jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import {
  buildSystemPrompt,
  buildUserPrompt,
  playLlmBotTurn,
} from '../src/byokBot';
import { clearTargetLocks, syncTargetLocks, tagOnTarget } from '../src/targets';
import {
  batchJson,
  indexOfStep,
  mockChat,
  postedMessage,
  readyConfig,
  t2Board,
} from './byok-batch-turn.support';
import {
  CLOSE_VS_CUT_LABELS,
  SPEED_FORMULA,
  SUGGESTION_ONLY,
  TEACHING_ALSO,
  TEACHING_LOCKS,
  baselineLine,
  chooseOfferStep,
  geometry,
  offerIndexOf,
  offerSteps,
  readTeachingFile,
  rules,
  t1Opening,
  withEmptyTerritory,
  withTrailLen,
} from './byok-teaching-prompt.support';

afterEach(() => {
  vi.restoreAllMocks();
  clearTargetLocks();
});

describe('BYOK teaching prompt is curated rules and user-prompt facts', () => {
  it('buildSystemPrompt includes the teaching file body', () => {
    const { me } = t1Opening();
    const teaching = readTeachingFile();
    const system = buildSystemPrompt(me, true);
    expect(system).toContain(SPEED_FORMULA);
    expect(system).not.toContain('Domination needs shares');
    for (const phrase of TEACHING_LOCKS) {
      expect(system, phrase).toContain(phrase);
    }
    for (const phrase of TEACHING_ALSO) {
      expect(system, phrase).toContain(phrase);
    }
    expect(system).toContain(`seat ${String(me)}`);
    expect(teaching.length, 'docs/byok-teaching.md must have a body').toBeGreaterThan(0);
    expect(system).toContain(teaching);
  });

  it('Teaching file does not teach domination as a win', () => {
    const teaching = readTeachingFile();
    expect(teaching).toContain('one seat remains');
    expect(teaching).toContain('starvation');
    expect(teaching).not.toMatch(/domination/i);
    expect(teaching).not.toContain('§11');
    expect(teaching).not.toContain('even-odd');
    expect(teaching).not.toContain('evaporation front');
  });

  it('Close vs cut example has two after snapshots', () => {
    const teaching = readTeachingFile();
    const { me } = t1Opening();
    const system = buildSystemPrompt(me, true);
    for (const label of CLOSE_VS_CUT_LABELS) {
      expect(teaching, label).toContain(label);
      expect(system, label).toContain(label);
    }
    expect(teaching).toContain('apply(state, move)');
    expect(teaching).toContain('The closing trail is now territory');
  });

  it('T1-shaped user prompt has no via count= and no Prefer on_target', () => {
    const { state, me, offer } = t1Opening();
    const chosen = chooseOfferStep(state, me);
    const index = offerIndexOf(offer, chosen);
    const targets = syncTargetLocks(geometry, rules, state, me);
    const prompt = buildUserPrompt(geometry, state, me, offer, true, rules, targets);
    expect(prompt).not.toContain('via count=');
    expect(prompt).not.toMatch(/prefer /i);
    expect(prompt).not.toContain('TARGETS');
    expect(prompt).toContain('Shares=');
    expect(prompt).toContain('trailLen=');
    expect(prompt).toContain(baselineLine(index, chosen));
    expect(prompt).toContain(SUGGESTION_ONLY);
  });

  it('Phase line stays facts when shares are 0 or the trail is long', () => {
    const { state, me, offer } = t1Opening();
    const cases = [state, withEmptyTerritory(state), withTrailLen(state, me, 4)];
    for (const board of cases) {
      const prompt = buildUserPrompt(geometry, board, me, offer, true, rules);
      expect(prompt, 'phase line').toMatch(/^Shares=\d+, trailLen=\d+\.$/m);
      expect(prompt).not.toContain('do NOT home_mill');
      expect(prompt).not.toContain('prefer homeward');
    }
  });

  it('on_target may tag a row without ordering it', () => {
    const { state, me, offer } = t1Opening();
    const targets = syncTargetLocks(geometry, rules, state, me);
    expect(targets.length).toBeGreaterThan(0);
    const tagged = offer.some((move) => tagOnTarget(move, targets));
    expect(tagged).toBe(true);
    const prompt = buildUserPrompt(geometry, state, me, offer, true, rules, targets);
    expect(prompt).toContain('on_target');
    expect(prompt).not.toContain('via count=');
    expect(prompt).not.toMatch(/prefer /i);
    expect(prompt).not.toContain('TARGETS');
  });

  it('Empty offer omits the baseline paragraph', () => {
    const { state, me } = t1Opening();
    const prompt = buildUserPrompt(geometry, state, me, [], true, rules);
    expect(prompt).not.toContain('weak one-ply baseline');
  });

  it('playLlmBotTurn posts the new prompts and still applies a lump', async () => {
    const { state, me, from, exit } = t2Board();
    const i = indexOfStep(state, (m) => m.from === from && m.exit === exit && m.count === 3);
    const lump = offerSteps(state)[i];
    expect(lump).toBeDefined();
    const teaching = readTeachingFile();
    const spy = mockChat([batchJson([i], true)]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.moves).toEqual([lump, endTurn()]);
    expect(result.llmHits).toBe(1);
    const system = postedMessage(spy, 'system');
    const user = postedMessage(spy, 'user');
    expect(system).not.toContain('Domination needs shares');
    expect(user).not.toContain('via count=');
    expect(user).not.toMatch(/prefer /i);
    expect(system).toContain(SPEED_FORMULA);
    expect(teaching.length).toBeGreaterThan(0);
    expect(system).toContain(teaching);
  });
});
