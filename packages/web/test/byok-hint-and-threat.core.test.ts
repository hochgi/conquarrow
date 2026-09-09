/**
 * docs/spec/byok-hint-and-threat/byok-hint-and-threat.core.feature
 * One it() per Gherkin scenario. Adapter only — no RTL, no jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import {
  asUsableBatch,
  baselineIndexFromTags,
  buildSystemPrompt,
  buildUserPrompt,
  clearByokPlans,
  isFullStackClose,
  millOmit,
  parseMoveBatch,
  playLlmBotTurn,
  threatLineFromCounts,
} from '../src/byokBot';
import { chooseTurnGreedy } from '../src/botSearch';
import { mockChat, offerSteps, readyConfig } from './byok-batch-turn.support';
import { SPEED_FORMULA, TEACHING_LOCKS, t1Opening } from './byok-teaching-prompt.support';
import {
  JSON_REPLY_WITH_PLAN,
  PREFER_ORDER_RE,
  annotateMoveSource,
  botSearchSource,
  byokBotSource,
  closeCutMillSection,
  geometry,
  hit12Rows,
  hit12ThreatInput,
  hit15Rows,
  isNonExpandingMillRow,
  jsonContractSection,
  leadLine,
  lineIndex,
  opponentSource,
  p64Fixture,
  pagesHeuristicSource,
  readTeachingFile,
  requireSeatB,
  rules,
} from './byok-hint-and-threat.support';

afterEach(() => {
  vi.restoreAllMocks();
  clearByokPlans();
});

describe('BYOK tags are hints, threat line names the lead, baseline names the lump close', () => {
  it('Teaching file contains the tags-are-hints paragraph and every P62/P63 lock', () => {
    const teaching = readTeachingFile();
    const mill = closeCutMillSection(teaching);
    expect(teaching.toLowerCase()).toContain('tags');
    expect(teaching.toLowerCase()).toContain('not orders');
    expect(mill).toMatch(/on_target/);
    expect(mill).toMatch(/loses to/);
    expect(mill).toMatch(/closes/);
    expect(mill).toMatch(/cut/);
    expect(mill).toMatch(/share|territory/);
    expect(mill).toMatch(/trailLen/);
    expect(mill).toMatch(/girth/);
    expect(mill).toMatch(/tipDist/);
    expect(mill).toMatch(/not shrinking/i);
    expect(mill).toMatch(/invent a tag/i);
    expect(mill).toMatch(/borders_spawner/);
    expect(mill).toMatch(/walk(?:ing)? past the close/i);
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
    for (const phrase of TEACHING_LOCKS) {
      expect(teaching, phrase).toContain(phrase);
    }
    expect(teaching).not.toMatch(/domination/i);
    expect(teaching).not.toContain('§11');
    expect(teaching).not.toContain('even-odd');
    expect(teaching).not.toContain('evaporation front');
    const { me } = t1Opening();
    expect(buildSystemPrompt(me, true)).toContain('## Close, cut, mill');
    expect(buildSystemPrompt(me, true)).toContain(mill);
  });

  it('Teaching JSON contract includes plan and a Plan section with the Hit 12 contrast', () => {
    const teaching = readTeachingFile();
    const { me } = t1Opening();
    const system = buildSystemPrompt(me, true);
    expect(teaching).toContain('## Plan');
    expect(jsonContractSection(teaching)).toContain('"plan":"short"');
    expect(teaching).toContain('Hit 12 shape');
    expect(teaching).toContain('Good:');
    expect(teaching).toContain('"plan":"close the open trail"');
    expect(teaching).toContain('Bad:');
    expect(teaching).toContain('"moves":[4,0]');
    expect(teaching).toMatch(/not an offer index/i);
    expect(teaching).toMatch(/cannot create a cut that is not a row/i);
    expect(teaching).not.toMatch(PREFER_ORDER_RE);
    expect(teaching).toContain('Close vs cut');
    expect(teaching).toContain('After 1-share');
    expect(teaching).toContain('After 3-share');
    expect(teaching).not.toContain('Play [2]');
    expect(system).toContain('## Plan');
  });

  it('buildUserPrompt prints one threat line with share lead, longest enemy trail, and offer tags', () => {
    const { state, me, offer } = requireSeatB();
    const prompt = buildUserPrompt(geometry, state, me, offer, true, rules);
    const lead = leadLine(prompt);
    expect(lead, 'no Lead: line').toBeDefined();
    expect(prompt.split('\n').filter((line) => line.startsWith('Lead:'))).toHaveLength(1);
    const sharesIdx = lineIndex(prompt, 'Shares=');
    const tipsIdx = lineIndex(prompt, 'Exposed tips:');
    const leadIdx = lineIndex(prompt, 'Lead:');
    const jsonIdx = lineIndex(prompt, 'STATE_JSON:');
    expect(leadIdx).toBeGreaterThan(sharesIdx);
    expect(leadIdx).toBeGreaterThan(tipsIdx);
    expect(leadIdx).toBeLessThan(jsonIdx);
    expect(lead).toMatch(/\bB \d+/);
    expect(lead).toMatch(/Longest enemy trail: (none|[A-C] \d+)/);
    expect(lead).toMatch(/cut|closes|No cut\/contest\/deny row/);
  });

  it('Same state yields the same threat line', () => {
    const { state, me, offer } = requireSeatB();
    const first = buildUserPrompt(geometry, state, me, offer, true, rules);
    const second = buildUserPrompt(geometry, state, me, offer, true, rules);
    expect(first).toBe(second);
    expect(leadLine(first), 'no Lead: line').toBeDefined();
    expect(leadLine(first)).toBe(leadLine(second));
  });

  it('Hit 12 shape baseline names a count=3 close not chooseMove count=1', () => {
    const rows = hit12Rows();
    const index = baselineIndexFromTags(rows);
    expect([2, 8], 'baseline still [0]').toContain(index);
    expect(index).not.toBe(0);
    const named = rows.find((row) => row.index === index);
    expect(named?.tags.includes('closes')).toBe(true);
    expect(named?.count).toBe(3);
    expect(baselineIndexFromTags([...rows].reverse())).toBe(2);
    expect(millOmit(rows)).toBe(false);
    const threat = threatLineFromCounts(hit12ThreatInput());
    expect(threat).toContain('C 18 shares / 25 terr');
    expect(threat).toContain('B 5 / 14');
    expect(threat).toContain('Longest enemy trail: C 6');
    expect(threat).toContain('Offer tags: closes, borders_spawner');
    expect(threat).not.toContain('No cut/contest/deny row');
  });

  it('Hit 15 shape mill-only offer omits the baseline paragraph', () => {
    const rows = hit15Rows();
    const fixture = p64Fixture().hit15;
    expect(baselineIndexFromTags(rows), 'baseline still [0]').toBeUndefined();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(isNonExpandingMillRow)).toBe(true);
    expect(millOmit(rows), 'mill-omit must fire so the live paragraph is omitted').toBe(true);
    expect(fixture.baselineRecorded).toContain('`[0]`');
    expect(fixture.expectedReply.moves).not.toEqual([0]);
  });

  it('Hit 12 full-stack close helper accepts [2] or [8] and rejects [4,0]', () => {
    const rows = hit12Rows();
    const fixture = p64Fixture().hit12;
    expect(
      isFullStackClose({ moves: [2], endTurn: true }, rows),
      'isFullStackClose false for [2]',
    ).toBe(true);
    expect(isFullStackClose({ moves: [8], endTurn: false }, rows)).toBe(true);
    expect(isFullStackClose({ moves: [4, 0], endTurn: false }, rows)).toBe(false);
    expect(fixture.expectedReply.plan).toBe('close the open trail');
  });

  it('Hit 15 expected batch is an empty pass', () => {
    const rows = hit15Rows();
    const fixture = p64Fixture().hit15;
    expect(fixture.expectedReply.moves).toEqual([]);
    expect(fixture.expectedReply.endTurn).toBe(true);
    expect(isFullStackClose(fixture.expectedReply, rows)).toBe(false);
    const plan = fixture.expectedReply.plan;
    expect(plan === undefined || plan === '').toBe(true);
    expect(fixture.expectedReply.moves).not.toEqual([0]);
  });

  it('Extra keys why and plan do not affect asUsableBatch or apply-prefix', async () => {
    const { state, me } = t1Opening();
    const content = JSON.stringify({
      moves: [0],
      endTurn: true,
      why: 'x',
      plan: 'close the open trail',
      mission: 'nope',
    });
    expect(parseMoveBatch(content)).toEqual({ indices: [0], endTurn: true });
    const usable = asUsableBatch(JSON.parse(content) as unknown);
    expect(usable).toEqual({ indices: [0], endTurn: true });
    expect(usable).not.toHaveProperty('why');
    expect(usable).not.toHaveProperty('plan');
    const first = offerSteps(state)[0];
    expect(first).toBeDefined();
    const applied = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChat([content]),
    );
    expect(applied.moves[0]).toEqual(first);
    expect(applied.moves.at(-1)).toEqual(endTurn());
    expect(usable?.indices).toEqual([0]);
    expect(buildUserPrompt(geometry, state, me, offerSteps(state), true, rules)).toContain(
      'Plan: close the open trail',
    );
    const fallback = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChat([
        JSON.stringify({ moves: [], endTurn: false, plan: 'still on the trail' }),
      ]),
    );
    expect(fallback.moves).toEqual(chooseTurnGreedy(geometry, rules, state, me));
    expect(fallback.llmFallbacks).toBe(1);
  });

  it('Pages still chooseMove and chooseTurnBeam is untouched', () => {
    const pages = pagesHeuristicSource();
    expect(pages).toMatch(/import \{[^}]*chooseMove/);
    expect(pages).not.toContain('chooseTurnBeam');
    expect(byokBotSource()).not.toMatch(/chooseTurnBeam/);
    expect(byokBotSource()).not.toMatch(/\bevaluate\(/);
    expect(opponentSource()).toContain('export const chooseMove');
    expect(botSearchSource()).toContain('export const chooseTurnGreedy');
    expect(botSearchSource()).toContain('export const chooseTurnBeam');
    expect(annotateMoveSource()).not.toContain('chooseTurnBeam');
    expect(pages).not.toContain('playLlmBotTurn');
    expect(JSON_REPLY_WITH_PLAN).toContain('"plan":"short"');
  });
});
