/**
 * docs/spec/byok-hint-and-threat/byok-hint-and-threat.edge-cases.feature
 * One it() per Gherkin scenario. Adapter only — no RTL, no jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import {
  annotateMove,
  baselineIndexFromTags,
  buildUserPrompt,
  clearByokPlans,
  millOmit,
  playLlmBotTurn,
  rememberByokPlan,
  snapshotForPrompt,
  threatLineFromCounts,
} from '../src/byokBot';
import { chooseTurnGreedy } from '../src/botSearch';
import * as botSearch from '../src/botSearch';
import { withByokStats } from '../src/matchLog';
import {
  batchJson,
  indexOfStep,
  mockChat,
  offerSteps,
  readyConfig,
  t2Board,
} from './byok-batch-turn.support';
import { oldByokMatchLog } from './byok-thinking-teach.support';
import { t1Opening } from './byok-teaching-prompt.support';
import {
  JSON_REPLY_WITH_PLAN,
  annotateMoveSource,
  asPromptSnap,
  botSearchSource,
  byokBotSource,
  echoedPlanText,
  geometry,
  hit15Rows,
  incidentVertices,
  interestingSpawnerCount,
  lineIndex,
  matchLogSource,
  nearTrailState,
  opponentSource,
  p64Fixture,
  pagesHeuristicSource,
  planLine,
  readTeachingFile,
  requireSeatB,
  rules,
  specSection1,
  startMatchSource,
} from './byok-hint-and-threat.support';

afterEach(() => {
  vi.restoreAllMocks();
  clearByokPlans();
});

describe('BYOK hint-and-threat — plan echo, observation rank, unchanged seams', () => {
  it('Tied shares use state.players as the last sort key', () => {
    const base = {
      me: 'C',
      shares: { A: 6, B: 6, C: 5 },
      territory: { A: 5, B: 5, C: 4 },
      trailLen: { A: 0, B: 0, C: 0 },
      offerTags: [] as const,
      nearTrail: false,
    };
    const abc = threatLineFromCounts({ ...base, players: ['A', 'B', 'C'] });
    const leadAbc = abc.split('. ')[0] ?? abc;
    expect(leadAbc, 'no Lead: line').toMatch(/^Lead:/);
    expect(leadAbc.indexOf('A ')).toBeGreaterThanOrEqual(0);
    expect(leadAbc.indexOf('A ')).toBeLessThan(leadAbc.indexOf('B '));
    const bac = threatLineFromCounts({ ...base, players: ['B', 'A', 'C'] });
    const leadBac = bac.split('. ')[0] ?? bac;
    expect(leadBac.indexOf('B ')).toBeGreaterThanOrEqual(0);
    expect(leadBac.indexOf('B ')).toBeLessThan(leadBac.indexOf('A '));
  });

  it('No enemy trail prints Longest enemy trail none', () => {
    const line = threatLineFromCounts({
      me: 'B',
      players: ['A', 'B', 'C'],
      shares: { A: 1, B: 1, C: 1 },
      territory: { A: 1, B: 1, C: 1 },
      trailLen: { A: 0, B: 0, C: 0 },
      offerTags: [],
      nearTrail: false,
    });
    expect(line).toContain('Longest enemy trail: none');
  });

  it('No cut and no closes prints No cut/contest/deny row and does not invent deny', () => {
    const withBorders = threatLineFromCounts({
      me: 'B',
      players: ['A', 'B', 'C'],
      shares: { A: 1, B: 1, C: 1 },
      territory: { A: 1, B: 1, C: 1 },
      trailLen: { A: 0, B: 0, C: 0 },
      offerTags: ['borders_spawner'],
      nearTrail: false,
    });
    expect(withBorders).toContain('Offer tags: borders_spawner');
    expect(withBorders).toContain('No cut/contest/deny row');
    expect(annotateMoveSource()).not.toMatch(/['"]deny['"]/);
    const { state, me } = requireSeatB();
    const move = offerSteps(state)[0];
    expect(move).toBeDefined();
    if (move === undefined) return;
    expect(annotateMove(geometry, rules, state, me, move)).not.toContain('deny');
    const empty = threatLineFromCounts({
      me: 'B',
      players: ['A', 'B', 'C'],
      shares: { A: 1, B: 1, C: 1 },
      territory: { A: 1, B: 1, C: 1 },
      trailLen: { A: 0, B: 0, C: 0 },
      offerTags: [],
      nearTrail: false,
    });
    expect(empty).toContain('No cut/contest/deny row');
    expect(empty).not.toContain('Offer tags:');
  });

  it('No shared point with an enemy trail prints the locked vertex phrase', () => {
    const none = threatLineFromCounts({
      me: 'B',
      players: ['A', 'B', 'C'],
      shares: { A: 1, B: 1, C: 1 },
      territory: { A: 1, B: 1, C: 1 },
      trailLen: { A: 1, B: 0, C: 2 },
      offerTags: ['closes'],
      nearTrail: false,
    });
    expect(none).toContain('no enemy trail on a legal vertex');
    const some = threatLineFromCounts({
      me: 'B',
      players: ['A', 'B', 'C'],
      shares: { A: 1, B: 1, C: 1 },
      territory: { A: 1, B: 1, C: 1 },
      trailLen: { A: 1, B: 0, C: 2 },
      offerTags: ['closes'],
      nearTrail: true,
    });
    expect(some).not.toContain('no enemy trail on a legal vertex');
  });

  it('An exit that shares a point with an enemy trail is tagged near_trail', () => {
    const { state, me, enemy, move } = nearTrailState();
    const flank = vi.spyOn(geometry, 'flankVertices');
    const row = annotateMove(geometry, rules, state, me, move);
    expect(row).toContain('near_trail:');
    expect(row).toContain(String(enemy));
    expect(row).not.toContain('cut');
    expect(flank).not.toHaveBeenCalled();
    expect(annotateMoveSource()).not.toContain('flankVertices');
  });

  it('Echoed plan is truncated to 80 and has no newline', () => {
    const { state, me, offer } = requireSeatB();
    const raw = `${'x'.repeat(40)}\n${'y'.repeat(50)}`;
    rememberByokPlan(me, { moves: [0], endTurn: true, plan: raw });
    const prompt = buildUserPrompt(geometry, state, me, offer, true, rules);
    const line = planLine(prompt);
    expect(line, 'no Plan: line').toBeDefined();
    const leadIdx = lineIndex(prompt, 'Lead:');
    const planIdx = lineIndex(prompt, 'Plan: ');
    const jsonIdx = lineIndex(prompt, 'STATE_JSON:');
    expect(leadIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(leadIdx);
    expect(planIdx).toBeLessThan(jsonIdx);
    const echoed = echoedPlanText(prompt) ?? '';
    expect(echoed.length).toBeLessThanOrEqual(80);
    expect(echoed).not.toContain('\n');
    expect(line ?? '').not.toMatch(/prefer/i);
  });

  it('Missing plan keeps the previous echo; empty or pass clears; clearByokPlans drops it', () => {
    const { state, me, offer } = requireSeatB();
    const promptOf = (): string => buildUserPrompt(geometry, state, me, offer, true, rules);
    rememberByokPlan(me, { moves: [0], endTurn: true, plan: 'close the open trail' });
    rememberByokPlan(me, { moves: [1], endTurn: false });
    expect(promptOf()).toContain('Plan: close the open trail');
    rememberByokPlan(me, { moves: [0], endTurn: true, plan: '' });
    expect(planLine(promptOf())).toBeUndefined();
    rememberByokPlan(me, { moves: [0], endTurn: true, plan: 'close the open trail' });
    rememberByokPlan(me, { moves: [], endTurn: true, plan: 'still going' });
    expect(planLine(promptOf())).toBeUndefined();
    rememberByokPlan(me, { moves: [0], endTurn: true, plan: 'close the open trail' });
    clearByokPlans();
    expect(planLine(promptOf())).toBeUndefined();
    expect(startMatchSource()).toContain('clearByokPlans()');
    expect(byokBotSource()).not.toContain('localStorage');
    expect(matchLogSource()).not.toMatch(/rememberByokPlan|byokPlans|planEcho/);
  });

  it('plan is never an offer index and empty plus endTurn false is still a fallback', async () => {
    const { state, me } = requireSeatB();
    const spy = mockChat([
      JSON.stringify({ moves: [], endTurn: false, plan: 'close the open trail' }),
    ]);
    const result = await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    expect(result.llmFallbacks).toBe(1);
    expect(result.moves).toEqual(chooseTurnGreedy(geometry, rules, state, me));
    expect(readTeachingFile()).toMatch(/do not put indices in plan/i);
  });

  it('Spawner dump prefers vertices incident to my groups or legal exits and caps at 12', () => {
    const { state, me, offer } = t1Opening();
    const interesting = interestingSpawnerCount(state, me);
    if (interesting <= 12) throw new Error('setup: need more than 12 interesting spawners');
    const incident = incidentVertices(state, me, offer);
    if (incident.size === 0) {
      throw new Error('setup: no interesting vertex incident to me groups or legal exits');
    }
    const beam = vi.spyOn(botSearch, 'chooseTurnBeam');
    const snap = asPromptSnap(snapshotForPrompt(geometry, state, me, offer));
    expect(snap.spawnersShown).toBe(12);
    expect(snap.spawners).toHaveLength(12);
    expect(snap.spawners.length).toBeLessThan(58);
    const listed = snap.spawners.map((row) => row.vertex);
    expect(listed.some((vertex) => incident.has(vertex))).toBe(true);
    let seenOther = false;
    for (const vertex of listed) {
      if (!incident.has(vertex)) seenOther = true;
      else expect(seenOther, vertex).toBe(false);
    }
    expect(beam).not.toHaveBeenCalled();
    expect(byokBotSource()).not.toMatch(/chooseTurnBeam/);
  });

  it('Prompt builders and helpers stay pure except the existing fetch on play', async () => {
    const bot = byokBotSource();
    expect(bot).not.toContain('Date.now');
    expect(bot).not.toContain('Math.random');
    expect(bot).not.toContain('performance.now');
    const { state, me } = requireSeatB();
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

  it('Live user prompt reply line includes plan and does not prefer-order', () => {
    const { state, me, offer } = requireSeatB();
    const prompt = buildUserPrompt(geometry, state, me, offer, true, rules);
    expect(prompt).toContain(JSON_REPLY_WITH_PLAN);
    expect(prompt).not.toContain('via count=');
    expect(prompt).not.toMatch(/prefer /i);
    expect(prompt).not.toContain('TARGETS');
    const section1 = specSection1();
    expect(section1).toContain('docs/byok-teaching.md');
    expect(section1).toMatch(/non-normative/i);
    expect(section1.match(/docs\/byok-teaching\.md/g)).toHaveLength(1);
  });

  it('chooseMove stays frozen and a mill baseline is not advertised on Hit 15', async () => {
    const rows = hit15Rows();
    expect(opponentSource()).toContain('export const chooseMove');
    expect(baselineIndexFromTags(rows), 'baseline still [0]').toBeUndefined();
    expect(millOmit(rows)).toBe(true);
    expect(p64Fixture().hit15.expectedReply.moves).toEqual([]);
    expect(p64Fixture().hit15.baselineRecorded).toContain('`[0]`');
    expect(botSearchSource()).toContain('export const chooseTurnGreedy');
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
    const { state: open, me: openMe, offer } = requireSeatB();
    const empty = await playLlmBotTurn(
      geometry,
      rules,
      open,
      openMe,
      readyConfig(),
      mockChat([batchJson([], false)]),
    );
    expect(empty.llmFallbacks).toBe(1);
    expect(pagesHeuristicSource()).toMatch(/import \{[^}]*chooseMove/);
    expect(buildUserPrompt(geometry, open, openMe, offer, true, rules)).toBeDefined();
  });
});
