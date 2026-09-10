/**
 * EARS invariants for docs/spec/byok-hint-and-threat/byok-hint-and-threat.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/byok-thinking-teach.invariants.test.ts).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import {
  annotateMove,
  asUsableBatch,
  baselineIndexFromTags,
  buildSystemPrompt,
  buildUserPrompt,
  clearByokPlans,
  dirtClosesFromRows,
  isDirtClose,
  isFullStackClose,
  isTagChasePlan,
  millOmit,
  parseMoveBatch,
  PLAN_CAP,
  playLlmBotTurn,
  rememberByokPlan,
  snapshotForPrompt,
  threatLineFromCounts,
} from '../src/byokBot';
import { chooseTurnGreedy } from '../src/botSearch';
import {
  batchJson,
  indexOfStep,
  mockChat,
  offerSteps,
  readyConfig,
  t2Board,
} from './byok-batch-turn.support';
import { SPEED_FORMULA, TEACHING_LOCKS, t1Opening } from './byok-teaching-prompt.support';
import {
  DIRT_CLAUSE,
  HIT0_TAG_CHASE_PLAN,
  JSON_REPLY_WITH_PLAN,
  PREFER_ORDER_RE,
  annotateMoveSource,
  asPromptSnap,
  botSearchSource,
  byokBotSource,
  closeCutMillSection,
  echoedPlanText,
  geometry,
  hit12Rows,
  hit12ThreatInput,
  hit13Rows,
  hit15Rows,
  hit5Rows,
  hit5ThreatInput,
  hit9Rows,
  incidentVertices,
  interestingSpawnerCount,
  isNonExpandingMillRow,
  jsonContractSection,
  leadLine,
  lineIndex,
  matchLogSource,
  namedOfferTags,
  nearTrailState,
  opponentSource,
  p64Fixture,
  p66Fixture,
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

describe('byok-hint-and-threat invariants', () => {
  it('WHEN the teaching file is read, it shall contain the tags-are-hints beats and the P62/P63 locked substrings, and shall not contain domination, §11, even-odd, or evaporation front.', () => {
    const teaching = readTeachingFile();
    const mill = closeCutMillSection(teaching);
    expect(mill).toContain('not orders');
    expect(mill).toMatch(/on_target/);
    expect(mill).toMatch(/loses to/);
    expect(mill).toMatch(/closes/);
    expect(mill).toMatch(/cut/);
    expect(mill).toMatch(/invent a tag/i);
    expect(mill).toMatch(/borders_spawner/);
    expect(mill).toMatch(/walk(?:ing)? past the close/i);
    for (const phrase of TEACHING_LOCKS) {
      expect(teaching, phrase).toContain(phrase);
    }
    expect(teaching).toContain(SPEED_FORMULA);
    expect(teaching).not.toMatch(/domination/i);
    expect(teaching).not.toContain('§11');
    expect(teaching).not.toContain('even-odd');
    expect(teaching).not.toContain('evaporation front');
  });

  it('The teaching file shall contain a ## Plan section after the JSON contract, the JSON contract shall include a plan key, and Hit 12 Good/Bad contrast shall include close the open trail.', () => {
    const teaching = readTeachingFile();
    const jsonStart = teaching.indexOf('## JSON contract');
    const planStart = teaching.indexOf('## Plan');
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    expect(planStart).toBeGreaterThan(jsonStart);
    expect(jsonContractSection(teaching)).toContain('"plan":"short"');
    expect(teaching).toContain('Hit 12 shape');
    expect(teaching).toContain('Good:');
    expect(teaching).toContain('"plan":"close the open trail"');
    expect(teaching).toContain('Bad:');
    expect(teaching).toContain('"moves":[4,0]');
    expect(teaching).not.toMatch(PREFER_ORDER_RE);
  });

  it('WHEN buildUserPrompt runs, it shall print exactly one threat line after the Shares/tips block and before STATE_JSON.', () => {
    const { state, me, offer } = requireSeatB();
    const prompt = buildUserPrompt(geometry, state, me, offer, true, rules);
    expect(prompt.split('\n').filter((line) => line.startsWith('Lead:'))).toHaveLength(1);
    const lead = leadLine(prompt);
    expect(lead, 'no Lead: line').toBeDefined();
    expect(lineIndex(prompt, 'Lead:')).toBeGreaterThan(lineIndex(prompt, 'Shares='));
    expect(lineIndex(prompt, 'Lead:')).toBeGreaterThan(lineIndex(prompt, 'Exposed tips:'));
    expect(lineIndex(prompt, 'Lead:')).toBeLessThan(lineIndex(prompt, 'STATE_JSON:'));
    expect(lead).toMatch(/\bB \d+/);
    expect(lead).toMatch(/Longest enemy trail:/);
    expect(lead).toMatch(/cut|closes|No cut\/contest\/deny row/);
  });

  it('WHEN the same state, offer, and ports are given twice, the threat line shall be identical.', () => {
    const { state, me, offer } = requireSeatB();
    const a = buildUserPrompt(geometry, state, me, offer, true, rules);
    const b = buildUserPrompt(geometry, state, me, offer, true, rules);
    expect(a).toBe(b);
    expect(leadLine(a), 'no Lead: line').toBeDefined();
    expect(leadLine(a)).toBe(leadLine(b));
    expect(threatLineFromCounts(hit12ThreatInput())).toBe(threatLineFromCounts(hit12ThreatInput()));
  });

  it('WHEN the offer has a closes or cut row, the baseline sentence shall name the largest-count such index. Hit 12 shape: [2] or [8], not [0].', () => {
    const rows = hit12Rows();
    const index = baselineIndexFromTags(rows);
    expect([2, 8], 'baseline still [0]').toContain(index);
    expect(index).not.toBe(0);
    const named = rows.find((row) => row.index === index);
    expect(named?.tags.includes('closes')).toBe(true);
    expect(named?.count).toBe(3);
    const threat = threatLineFromCounts(hit12ThreatInput());
    expect(threat).toContain('C 18 shares / 25 terr');
    expect(threat).toContain('B 5 / 14');
    expect(threat).toContain('Offer tags: closes');
  });

  it('WHEN every offered step is a non-expanding mill, the baseline paragraph shall be omitted.', () => {
    const rows = hit15Rows();
    expect(rows.every(isNonExpandingMillRow)).toBe(true);
    expect(baselineIndexFromTags(rows), 'baseline still [0]').toBeUndefined();
    expect(millOmit(rows)).toBe(true);
    expect(namedOfferTags(rows)).toEqual([]);
  });

  it('WHEN Hit 12 recorded rows are the offer, isFullStackClose shall be true for [2] and [8] and false for [4,0].', () => {
    const rows = hit12Rows();
    expect(isFullStackClose({ moves: [2], endTurn: true }, rows), 'isFullStackClose false for [2]').toBe(
      true,
    );
    expect(isFullStackClose({ moves: [8], endTurn: false }, rows)).toBe(true);
    expect(isFullStackClose({ moves: [4, 0], endTurn: false }, rows)).toBe(false);
  });

  it('WHEN Hit 15 recorded rows are the offer, the expected batch shall be moves [] and endTurn true, and a mill index shall not be the expected batch.', () => {
    const hit = p64Fixture().hit15;
    expect(hit.expectedReply.moves).toEqual([]);
    expect(hit.expectedReply.endTurn).toBe(true);
    expect(hit.expectedReply.moves).not.toEqual([0]);
    expect(isFullStackClose(hit.expectedReply, hit15Rows())).toBe(false);
  });

  it('WHEN a usable batch includes extra keys why / plan, asUsableBatch shall still return only indices and endTurn, and empty moves + endTurn false shall still be a fallback even if plan is present.', async () => {
    const extra = {
      moves: [0],
      endTurn: true,
      why: 'x',
      plan: 'close the open trail',
      mission: 'nope',
    };
    expect(asUsableBatch(extra)).toEqual({ indices: [0], endTurn: true });
    expect(asUsableBatch(extra)).not.toHaveProperty('plan');
    expect(parseMoveBatch(JSON.stringify(extra))).toEqual({ indices: [0], endTurn: true });
    const { state, me } = t1Opening();
    const fallback = await playLlmBotTurn(
      geometry,
      rules,
      state,
      me,
      readyConfig(),
      mockChat([JSON.stringify({ moves: [], endTurn: false, plan: 'still on the trail' })]),
    );
    expect(fallback.llmFallbacks).toBe(1);
    expect(fallback.moves).toEqual(chooseTurnGreedy(geometry, rules, state, me));
  });

  it('packages/online-api/src/pages-heuristic.ts shall keep importing chooseMove and shall not import chooseTurnBeam. byokBot.ts shall not call chooseTurnBeam or evaluate to build the prompt, baseline, or a tag.', () => {
    const pages = pagesHeuristicSource();
    expect(pages).toMatch(/import \{[^}]*chooseMove/);
    expect(pages).not.toContain('chooseTurnBeam');
    expect(byokBotSource()).not.toMatch(/chooseTurnBeam/);
    expect(byokBotSource()).not.toMatch(/\bevaluate\(/);
    expect(opponentSource()).toContain('export const chooseMove');
    expect(botSearchSource()).toContain('export const chooseTurnGreedy');
    expect(botSearchSource()).toContain('export const chooseTurnBeam');
  });

  it('WHEN two seats tie on shares (and territory if needed), the threat line’s lead order shall use state.players as the last sort key.', () => {
    const input = {
      me: 'C',
      shares: { A: 6, B: 6, C: 5 },
      territory: { A: 5, B: 5, C: 4 },
      trailLen: { A: 0, B: 0, C: 0 },
      offerTags: [] as const,
      nearTrail: false,
    };
    const abc = threatLineFromCounts({ ...input, players: ['A', 'B', 'C'] });
    const bac = threatLineFromCounts({ ...input, players: ['B', 'A', 'C'] });
    expect(abc, 'no Lead: line').toMatch(/^Lead:/);
    expect(abc.indexOf('A ')).toBeLessThan(abc.indexOf('B '));
    expect(bac.indexOf('B ')).toBeLessThan(bac.indexOf('A '));
  });

  it('WHEN no enemy has a trail, the threat line shall contain Longest enemy trail: none.', () => {
    expect(
      threatLineFromCounts({
        me: 'B',
        players: ['A', 'B', 'C'],
        shares: { A: 1, B: 1, C: 1 },
        territory: { A: 1, B: 1, C: 1 },
        trailLen: { A: 0, B: 2, C: 0 },
        offerTags: [],
        nearTrail: false,
      }),
    ).toContain('Longest enemy trail: none');
  });

  it('WHEN a seat has a stored plan, buildUserPrompt shall print Plan: plus at most PLAN_CAP (512) characters with no newline. Newlines shall already have become spaces. Missing plan key keeps the previous echo. Empty or pass clears. clearByokPlans drops the line. plan is never an offer index.', () => {
    const { state, me, offer } = requireSeatB();
    const promptOf = (): string => buildUserPrompt(geometry, state, me, offer, true, rules);
    rememberByokPlan(me, { moves: [0], endTurn: true, plan: 'close the open trail' });
    expect(promptOf()).toContain('Plan: close the open trail');
    const leadIdx = lineIndex(promptOf(), 'Lead:');
    const planIdx = lineIndex(promptOf(), 'Plan: ');
    expect(planIdx).toBeGreaterThan(leadIdx);
    expect(planIdx).toBeLessThan(lineIndex(promptOf(), 'STATE_JSON:'));
    expect(PLAN_CAP).toBe(512);
    rememberByokPlan(me, {
      moves: [0],
      endTurn: true,
      plan: `${'x'.repeat(40)}\n${'y'.repeat(49)}`,
    });
    const echoed = echoedPlanText(promptOf()) ?? '';
    expect(echoed.length).toBeLessThanOrEqual(PLAN_CAP);
    expect(echoed).not.toContain('\n');
    expect(echoed, 'newline was stripped instead of becoming a space').toBe(
      `${'x'.repeat(40)} ${'y'.repeat(49)}`,
    );
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
    expect(asUsableBatch({ moves: [2], endTurn: true, plan: 'close the open trail' })?.indices).toEqual(
      [2],
    );
  });

  it('WHEN interesting spawners are listed, vertices incident to me group arrows or legal exits shall rank before other interesting vertices, and spawnersShown shall be ≤ 12.', () => {
    const { state, me, offer } = t1Opening();
    expect(interestingSpawnerCount(state, me)).toBeGreaterThan(12);
    const snap = asPromptSnap(snapshotForPrompt(geometry, state, me, offer));
    expect(snap.spawnersShown).toBeLessThanOrEqual(12);
    expect(snap.spawnersShown).toBe(12);
    const incident = incidentVertices(state, me, offer);
    if (incident.size === 0) {
      throw new Error('setup: no interesting vertex incident to me groups or legal exits');
    }
    const listed = snap.spawners.map((row) => row.vertex);
    expect(listed.some((vertex) => incident.has(vertex))).toBe(true);
    let seenOther = false;
    for (const vertex of listed) {
      if (!incident.has(vertex)) seenOther = true;
      else expect(seenOther, vertex).toBe(false);
    }
  });

  it('Prompt builders, fixture helpers, annotateMove, the plan store, isDirtClose, isTagChasePlan, and dirtClosesFromRows shall not use Date.now, Math.random, or performance.now.', () => {
    const bot = byokBotSource();
    expect(bot).toContain('isDirtClose');
    expect(bot).toContain('isTagChasePlan');
    expect(bot).toContain('dirtClosesFromRows');
    expect(bot).not.toContain('Date.now');
    expect(bot).not.toContain('Math.random');
    expect(bot).not.toContain('performance.now');
  });

  it('WHEN a legal exit shares a point with an enemy-trail arrow and is not already cut, annotateMove shall tag near_trail:<seat>. WHEN no legal exit shares such a point, the threat line shall contain no enemy trail on a legal vertex. annotateMove shall not emit deny.', () => {
    const { state, me, enemy, move } = nearTrailState();
    const row = annotateMove(geometry, rules, state, me, move);
    expect(row).toContain(`near_trail:${String(enemy)}`);
    expect(row).not.toContain('cut');
    expect(annotateMoveSource()).not.toMatch(/['"]deny['"]/);
    expect(
      threatLineFromCounts({
        me: 'B',
        players: ['A', 'B', 'C'],
        shares: { A: 1, B: 1, C: 1 },
        territory: { A: 1, B: 1, C: 1 },
        trailLen: { A: 0, B: 0, C: 3 },
        offerTags: [],
        nearTrail: false,
      }),
    ).toContain('no enemy trail on a legal vertex');
  });

  it('App.tsx startMatch shall call clearByokPlans(). The plan map shall not be written to localStorage or the match log.', () => {
    expect(startMatchSource()).toContain('clearByokPlans()');
    expect(byokBotSource()).not.toContain('localStorage');
    expect(matchLogSource()).not.toMatch(/rememberByokPlan|byokPlans|planEcho/);
  });

  it('WHEN buildUserPrompt runs, the live user prompt shall contain "plan":"short" on the reply line and shall not contain prefer (case-insensitive).', () => {
    const { state, me, offer } = requireSeatB();
    const prompt = buildUserPrompt(geometry, state, me, offer, true, rules);
    expect(prompt).toContain(JSON_REPLY_WITH_PLAN);
    expect(prompt).toContain('"plan":"short"');
    expect(prompt).not.toMatch(/prefer /i);
    const { me: seat } = t1Opening();
    expect(buildSystemPrompt(seat, true)).toContain(readTeachingFile());
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
    const { state: open, me: openMe } = t1Opening();
    const empty = await playLlmBotTurn(
      geometry,
      rules,
      open,
      openMe,
      readyConfig(),
      mockChat([batchJson([], false)]),
    );
    expect(empty.llmFallbacks).toBe(1);
    const first = offerSteps(open)[0];
    const tail = await playLlmBotTurn(
      geometry,
      rules,
      open,
      openMe,
      readyConfig(),
      mockChat([batchJson([0, 99], true), batchJson([], true)]),
    );
    expect(tail.moves).toEqual([first, endTurn()]);
  });

  it('The system shall not invent a cut tag for an exit that is not on an enemy trail, and shall not compute a path-to-enemy.', () => {
    const { state, me, offer } = requireSeatB();
    for (const move of offer) {
      const row = annotateMove(geometry, rules, state, me, move);
      const onEnemy = [...state.trails.entries()].some(
        ([player, set]) => player !== me && set.has(move.exit),
      );
      if (!onEnemy) expect(row).not.toMatch(/\bcut\b/);
    }
    expect(byokBotSource()).not.toMatch(/path-to-enemy|pathToEnemy|shortestPath/);
  });

  it('Hit 12 expected batch text shall include "plan":"close the open trail". Hit 15 expected batch shall omit plan or send "".', () => {
    const fixture = p64Fixture();
    expect(fixture.hit12.expectedReply.plan).toBe('close the open trail');
    expect(JSON.stringify(fixture.hit12.expectedReply)).toContain('"plan":"close the open trail"');
    const plan = fixture.hit15.expectedReply.plan;
    expect(plan === undefined || plan === '').toBe(true);
  });

  it('SPEC.md §1 shall still contain one docs/byok-teaching.md pointer labelled non-normative. This packet shall not add a second.', () => {
    const section1 = specSection1();
    expect(section1).toContain('docs/byok-teaching.md');
    expect(section1).toMatch(/non-normative/i);
    expect(section1.match(/docs\/byok-teaching\.md/g)).toHaveLength(1);
  });

  it('WHEN the teaching file is read, it shall contain a dirt-close sentence, a factory/share sentence, the 4-stack opening implication, and that a plan that names a tag is already wrong. It shall contain the Hit 5/9 Good/Bad contrast, keep every P62/P63/P64 lock, and shall not match prefer-orders.', () => {
    const teaching = readTeachingFile();
    expect(teaching).toMatch(/closes without share\+N/);
    expect(teaching).toMatch(/painted dirt/i);
    expect(teaching).toMatch(/share is a factory/i);
    expect(teaching).toMatch(/4-stack is 3 tiles this turn/i);
    expect(teaching).toContain('1+1+1');
    expect(teaching).toMatch(/plan that names a tag is already wrong/i);
    expect(teaching).toContain('Hit 5 / 9 shape');
    expect(teaching).toContain('"moves":[5]');
    expect(teaching).toContain('"moves":[3]');
    expect(teaching).toContain('dirt close is not a share');
    expect(teaching).toContain('Hit 12 is how');
    expect(teaching).toContain('Hit 5 / 9 is whether');
    expect(teaching).toContain('Hit 12 shape');
    expect(teaching).toContain('"plan":"close the open trail"');
    expect(teaching).toContain(SPEED_FORMULA);
    for (const phrase of TEACHING_LOCKS) {
      expect(teaching, phrase).toContain(phrase);
    }
    expect(teaching).not.toMatch(PREFER_ORDER_RE);
    expect(teaching).not.toContain('prefer 4-stacks');
    expect(teaching).not.toContain('prefer spawners');
    expect(teaching).not.toMatch(/never close/i);
    expect(teaching).not.toMatch(/domination/i);
    expect(teaching).not.toContain('§11');
    expect(teaching).not.toContain('even-odd');
    expect(teaching).not.toContain('evaporation front');
  });

  it('WHEN any offer row is tagged closes and none of those closing rows carry share+N, the threat line shall contain closes without share+N (dirt). WHEN every closes row has share+N, or there is no closes row, or the offer mixes dirt closes with share+N closes, that clause shall be omitted.', () => {
    expect(dirtClosesFromRows(hit5Rows())).toBe(true);
    const dirtLine = threatLineFromCounts({ ...hit5ThreatInput(), dirtCloses: true });
    expect(dirtLine).toContain(DIRT_CLAUSE);
    expect(dirtClosesFromRows(hit12Rows())).toBe(true);
    expect(
      threatLineFromCounts({ ...hit12ThreatInput(), dirtCloses: true }),
    ).toContain(DIRT_CLAUSE);
    expect(dirtClosesFromRows([{ index: 0, count: 2, tags: ['closes', 'share+1'] }])).toBe(false);
    expect(dirtClosesFromRows(hit13Rows())).toBe(false);
    expect(
      dirtClosesFromRows([
        { index: 0, count: 2, tags: ['closes', 'homeward'] },
        { index: 1, count: 1, tags: ['closes', 'share+1'] },
      ]),
    ).toBe(false);
    expect(
      threatLineFromCounts({
        me: 'B',
        players: ['A', 'B', 'C'],
        shares: { A: 1, B: 1, C: 1 },
        territory: { A: 1, B: 1, C: 1 },
        trailLen: { A: 0, B: 0, C: 0 },
        offerTags: ['closes'],
        nearTrail: false,
        dirtCloses: false,
      }),
    ).not.toContain(DIRT_CLAUSE);
    expect(threatLineFromCounts(hit12ThreatInput())).not.toContain(DIRT_CLAUSE);
  });

  it('WHEN Hit 5 recorded rows are the offer, isDirtClose({moves:[3]}, rows) shall be true and isDirtClose({moves:[5]}, rows) shall be false. WHEN Hit 9 recorded rows are the offer, {moves:[8]} shall be true and {moves:[6]} shall be false. The helper shall not call grok, shall not import botClose.isDirtClose, and shall not invent an annotateMove tag.', () => {
    const hit5 = hit5Rows();
    expect(isDirtClose({ moves: [3] }, hit5)).toBe(true);
    expect(isDirtClose({ moves: [5] }, hit5)).toBe(false);
    expect(isDirtClose({ moves: [2] }, hit5)).toBe(true);
    expect(isDirtClose({ moves: [] }, hit5)).toBe(false);
    expect(isDirtClose({ moves: [99] }, hit5)).toBe(false);
    const hit9 = hit9Rows();
    expect(isDirtClose({ moves: [8] }, hit9)).toBe(true);
    expect(isDirtClose({ moves: [6] }, hit9)).toBe(false);
    expect(byokBotSource()).not.toMatch(/from ['"]\.\/botClose['"]/);
    expect(byokBotSource()).not.toContain('botClose.isDirtClose');
    expect(byokBotSource()).not.toMatch(/grok/i);
    expect(annotateMoveSource()).not.toMatch(/dirt_close|dirtClose/);
  });

  it('WHEN Hit 13 recorded rows are the offer, the expected batch shall be moves [] and endTurn true, and plan shall be omitted or "".', () => {
    const hit = p66Fixture().hit13;
    expect(hit.expectedReply.moves).toEqual([]);
    expect(hit.expectedReply.endTurn).toBe(true);
    const plan = hit.expectedReply.plan;
    expect(plan === undefined || plan === '').toBe(true);
    expect(isDirtClose(hit.expectedReply, hit13Rows())).toBe(false);
  });

  it('WHEN isTagChasePlan is given the Hit 0 recorded plan continue on_target and spend leftover on same exit, it shall be true. WHEN given walk a border of the open pinwheel or close the open trail, it shall be false.', () => {
    expect(isTagChasePlan(HIT0_TAG_CHASE_PLAN)).toBe(true);
    expect(isTagChasePlan('walk the tagged cut')).toBe(true);
    expect(isTagChasePlan('walk a border of the open pinwheel')).toBe(false);
    expect(isTagChasePlan('close the open trail')).toBe(false);
    expect(isTagChasePlan('ON_TARGET')).toBe(true);
    expect(isTagChasePlan('shortcut')).toBe(false);
    expect(isTagChasePlan('')).toBe(false);
    expect(isTagChasePlan(undefined)).toBe(false);
  });

  it('PLAN_CAP shall be 512. WHEN a usable batch stores a plan of length 81, the next echo shall contain all 81 characters. WHEN a plan of length 513 is stored, the echo shall contain exactly 512 characters. Newlines shall become spaces before store and echo.', () => {
    expect(PLAN_CAP).toBe(512);
    const { state, me, offer } = requireSeatB();
    const promptOf = (): string => buildUserPrompt(geometry, state, me, offer, true, rules);
    const plan81 = 'a'.repeat(81);
    rememberByokPlan(me, { moves: [0], endTurn: true, plan: plan81 });
    expect(echoedPlanText(promptOf())).toBe(plan81);
    const plan513 = 'b'.repeat(513);
    rememberByokPlan(me, { moves: [0], endTurn: true, plan: plan513 });
    expect(echoedPlanText(promptOf())).toBe(plan513.slice(0, 512));
    expect(echoedPlanText(promptOf())?.length).toBe(512);
    rememberByokPlan(me, { moves: [0], endTurn: true, plan: 'keep\nit\r\nshort' });
    expect(echoedPlanText(promptOf()), 'newline runs should become one space').toBe('keep it short');
  });

  it('asUsableBatch shall still strip extra keys. P61 empty-prefix / illegal-tail tests shall stay green. chooseTurnBeam / P53 / P65 tests shall be untouched. Pages shall still import chooseMove.', () => {
    const extra = {
      moves: [0],
      endTurn: true,
      why: 'x',
      plan: 'close the open trail',
      mission: 'nope',
    };
    expect(asUsableBatch(extra)).toEqual({ indices: [0], endTurn: true });
    expect(asUsableBatch(extra)).not.toHaveProperty('plan');
    expect(pagesHeuristicSource()).toMatch(/import \{[^}]*chooseMove/);
    expect(pagesHeuristicSource()).not.toContain('chooseTurnBeam');
    expect(byokBotSource()).not.toMatch(/chooseTurnBeam/);
    expect(opponentSource()).toContain('export const chooseMove');
  });

  it('Prompt builders, fixture helpers, annotateMove, the plan store, isDirtClose, isTagChasePlan, and dirtClosesFromRows shall not use Date.now, Math.random, or performance.now. (invariant 30)', () => {
    const bot = byokBotSource();
    expect(bot).not.toContain('Date.now');
    expect(bot).not.toContain('Math.random');
    expect(bot).not.toContain('performance.now');
  });
});
