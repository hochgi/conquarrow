/**
 * docs/spec/byok-teaching-prompt/byok-teaching-prompt.edge-cases.feature
 * One it() per Gherkin scenario. Adapter only — no RTL, no jsdom.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { movesEqual } from '@conquarrow/contracts';
import { buildSystemPrompt, buildUserPrompt } from '../src/byokBot';
import { clearTargetLocks, formatTargetsForPrompt, syncTargetLocks } from '../src/targets';
import {
  SPEED_FORMULA,
  botTurnSearchDir,
  byokBatchTurnDir,
  byokBotSource,
  chooseOfferStep,
  geometry,
  offerIndexOf,
  opponentSource,
  pagesHeuristicSource,
  readTeachingFile,
  rules,
  specSection1,
  t1Opening,
} from './byok-teaching-prompt.support';

afterEach(() => {
  vi.restoreAllMocks();
  clearTargetLocks();
});

describe('BYOK teaching prompt — sync, omit, purity, unchanged seams', () => {
  it('Teaching file and system prompt stay in lockstep', () => {
    const teaching = readTeachingFile();
    const { me } = t1Opening();
    const system = buildSystemPrompt(me, true);
    expect(teaching).toContain(SPEED_FORMULA);
    expect(teaching).toContain('starvation');
    expect(teaching).not.toMatch(/domination/i);
    expect(teaching.length, 'loaded from disk without fetch').toBeGreaterThan(0);
    expect(system).toContain(teaching);
  });

  it('Same state yields the same baseline index', () => {
    const { state, me, offer } = t1Opening();
    const chosen = chooseOfferStep(state, me);
    const index = offerIndexOf(offer, chosen);
    const first = buildUserPrompt(geometry, state, me, offer, true, rules);
    const second = buildUserPrompt(geometry, state, me, offer, true, rules);
    expect(first).toBe(second);
    const line = `A weak one-ply baseline would play \`[${String(index)}]\``;
    expect(first).toContain(line);
    expect(second).toContain(line);
    expect(movesEqual(offer[index] ?? chosen, chosen)).toBe(true);
  });

  it('Baseline is omitted when it cannot name an offer index', () => {
    const { state, me, offer } = t1Opening();
    const withoutRules = buildUserPrompt(geometry, state, me, offer, true);
    expect(withoutRules).not.toContain('weak one-ply baseline');
    const chosen = chooseOfferStep(state, me);
    const filtered = offer.filter((move) => !movesEqual(move, chosen));
    expect(filtered.length).toBeLessThan(offer.length);
    const missing = buildUserPrompt(geometry, state, me, filtered, true, rules);
    expect(missing).not.toContain('weak one-ply baseline');
  });

  it('SPEC.md §1 points at the teaching file as non-normative', () => {
    const section1 = specSection1();
    expect(section1).toContain('docs/byok-teaching.md');
    expect(section1).toMatch(/non-normative/i);
    expect(section1).toContain('must not add a game rule');
  });

  it('Pages heuristic still imports chooseMove', () => {
    const src = pagesHeuristicSource();
    expect(src).toMatch(/import \{[^}]*chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
    expect(src).not.toContain('playLlmBotTurn');
  });

  it('chooseTurnBeam is not the baseline', () => {
    expect(byokBotSource()).not.toMatch(/chooseTurnBeam/);
    expect(opponentSource()).toContain('export const chooseMove');
    expect(existsSync(join(botTurnSearchDir(), 'bot-turn-search.md'))).toBe(true);
    expect(existsSync(join(botTurnSearchDir(), 'bot-turn-search.core.feature'))).toBe(true);
    expect(existsSync(join(byokBatchTurnDir(), 'byok-batch-turn.md'))).toBe(true);
    expect(existsSync(join(byokBatchTurnDir(), 'byok-batch-turn.core.feature'))).toBe(true);
  });

  it('Prompt builder stays pure', () => {
    const src = byokBotSource();
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
  });

  it('formatTargetsForPrompt may exist but is not concatenated live', () => {
    const { state, me, offer } = t1Opening();
    const targets = syncTargetLocks(geometry, rules, state, me);
    expect(targets.length).toBeGreaterThan(0);
    const formatted = formatTargetsForPrompt(targets);
    expect(formatted).toContain('TARGETS');
    const prompt = buildUserPrompt(geometry, state, me, offer, true, rules, targets);
    expect(prompt).not.toContain('TARGETS');
    expect(typeof formatTargetsForPrompt).toBe('function');
  });
});
