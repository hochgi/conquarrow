/**
 * docs/spec/opponent-ply-and-denial/opponent-ply-and-denial.edge-cases.feature
 * One it() per Gherkin scenario. Adapter seam — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import { exposure } from '../src/botClose';
import {
  chooseTurnBeam,
  chooseTurnBeamWithBudget,
  chooseTurnGreedy,
  isShuttle,
  MAX_APPLIES,
  REPLY_BEAM,
  REPLY_BRANCH,
  REPLY_MAX_APPLIES,
  REPLY_MAX_PLAN,
  REPLY_TURN_APPLIES,
  replyScore,
} from '../src/botSearch';
import {
  countingRules,
  foldPlan,
  geometry,
  heuristicTurnStarts,
  loadBaselineLog,
  pagesHeuristicSource,
  planIsLegalSequence,
  planTerminates,
  rules,
  selfBoxMobilityPair,
} from './bot-turn-search.support';
import {
  botSearchSource,
  botCloseSource,
  botEvaluateSource,
  botReplySource,
  findingsSource,
  hypothesiseChair,
  recordingRules,
  shuffleCloseMaps,
  sixSeatThreatIsCPosition,
  takeableStackPosition,
  unreachableEnemyPosition,
} from './opponent-ply-and-denial.support';

const sourceWithoutComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Opponent ply and denial — boundaries and seams', () => {
  it('Inner reply search does not run opponent ply', () => {
    const src = botSearchSource();
    expect(src).toMatch(/withReplies:\s*false/);
    expect(src.match(/chooseTurnBeamWithBudget/g)?.length).toBeGreaterThan(1);
    const { state, Bot, C } = sixSeatThreatIsCPosition();
    const terminal = hypothesiseChair(foldPlan(state, chooseTurnBeam(geometry, rules, state, Bot)), C);
    const { rules: counted, log } = recordingRules(rules);
    chooseTurnBeamWithBudget(geometry, counted, terminal, C, {
      beam: REPLY_BEAM,
      branch: REPLY_BRANCH,
      maxPlan: REPLY_MAX_PLAN,
      maxApplies: REPLY_MAX_APPLIES,
      withReplies: false,
    });
    const nested = log().some((e) => e.seat !== C && e.seat !== Bot);
    expect(nested).toBe(false);
  });

  it('Unreachable enemies are skipped', () => {
    const { quiet, Bot, E } = unreachableEnemyPosition();
    const { rules: counted, log } = recordingRules(rules);
    chooseTurnBeam(geometry, counted, quiet, Bot);
    expect(log().some((e) => e.seat === E)).toBe(false);
    expect(exposure(geometry, rules, quiet, Bot)).toBe(0);
  });

  it('The reply does not apply intervening endTurns', () => {
    const { state, Bot, B, C } = sixSeatThreatIsCPosition();
    const { rules: counted, log } = recordingRules(rules);
    replyScore(geometry, counted, state, Bot);
    expect(log().some((e) => e.seat === C)).toBe(true);
    expect(log().some((e) => e.seat === B && e.kind === 'endTurn')).toBe(false);
  });

  it('Enemy economy is not modelled', () => {
    const { state, C } = sixSeatThreatIsCPosition();
    const chair = hypothesiseChair(state, C);
    expect(chair.accumulators).toBe(state.accumulators);
    expect(chair.activePlayer).toBe(C);
  });

  it('One enemy reply respects REPLY_MAX_APPLIES', () => {
    expect(REPLY_MAX_APPLIES).toBe(40);
    expect((botSearchSource().match(/REPLY_MAX_APPLIES/g) ?? []).length).toBeGreaterThan(1);
    const { state, C } = sixSeatThreatIsCPosition();
    const chair = hypothesiseChair(state, C);
    const { rules: counted, count } = countingRules(rules);
    chooseTurnBeamWithBudget(geometry, counted, chair, C, {
      beam: REPLY_BEAM,
      branch: REPLY_BRANCH,
      maxPlan: REPLY_MAX_PLAN,
      maxApplies: REPLY_MAX_APPLIES,
      withReplies: false,
    });
    expect(count()).toBeLessThanOrEqual(REPLY_MAX_APPLIES + 1);
  });

  it('Reply applies across a bot turn stay within REPLY_TURN_APPLIES', () => {
    expect(REPLY_TURN_APPLIES).toBe(400);
    expect(MAX_APPLIES).toBe(2000);
    expect((botSearchSource().match(/REPLY_TURN_APPLIES/g) ?? []).length).toBeGreaterThan(1);
    const { state, Bot } = sixSeatThreatIsCPosition();
    const { rules: counted, log } = recordingRules(rules);
    replyScore(geometry, counted, state, Bot);
    const replyApplies = log().filter((e) => e.seat !== Bot).length;
    expect(replyApplies).toBeGreaterThan(0);
    expect(replyApplies).toBeLessThanOrEqual(REPLY_TURN_APPLIES);
    expect(log().filter((e) => e.seat === Bot).length).toBeLessThanOrEqual(MAX_APPLIES);
  });

  it('Exhausted reply budget still returns a legal plan', () => {
    const { state, Bot } = sixSeatThreatIsCPosition();
    const plan = chooseTurnBeamWithBudget(geometry, rules, state, Bot, {
      withReplies: true,
      beam: 2,
      branch: 2,
      maxPlan: 3,
      maxApplies: 30,
    });
    expect(planIsLegalSequence(state, plan)).toBe(true);
    expect(planTerminates(state, plan)).toBe(true);
    expect((botSearchSource().match(/REPLY_TURN_APPLIES/g) ?? []).length).toBeGreaterThan(1);
  });

  it('Incomplete beam slots are not reply-scored', () => {
    const src = botSearchSource();
    const match = /const rankIncompletes[\s\S]*?^};/m.exec(src);
    expect(match?.[0]).toBeDefined();
    expect(match?.[0]).not.toContain('replyScore');
  });

  it('The bot declines a takeable stack when a safe equal plan exists', () => {
    const { state, Bot, from, unsafeExit, safeExit } = takeableStackPosition();
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    const parkedUnsafe = plan.some(
      (m) => m.kind === 'step' && m.from === from && m.exit === unsafeExit,
    );
    const parkedSafe = plan.some((m) => m.kind === 'step' && m.from === from && m.exit === safeExit);
    expect(parkedUnsafe).toBe(false);
    expect(parkedSafe).toBe(true);
  });

  it('The bot prefers two exits over one when an enemy can reach', () => {
    const { open, boxed, Bot } = selfBoxMobilityPair();
    expect(replyScore(geometry, rules, open, Bot)).toBeGreaterThan(
      replyScore(geometry, rules, boxed, Bot),
    );
  });

  it('Map insertion order does not change exposure or the plan', () => {
    const { state, Bot } = sixSeatThreatIsCPosition();
    const shuffled = shuffleCloseMaps(state);
    expect(exposure(geometry, rules, state, Bot)).toBe(exposure(geometry, rules, shuffled, Bot));
    expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual(
      chooseTurnBeam(geometry, rules, shuffled, Bot),
    );
  });

  it('Reply search uses no clock and no RNG', () => {
    const src = sourceWithoutComments(
      `${botSearchSource()}\n${botCloseSource()}\n${botEvaluateSource()}\n${findingsSource()}\n${botReplySource()}`,
    );
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
    expect(src).not.toContain('new Date');
  });

  it('pagesHeuristic still calls chooseMove', () => {
    const src = pagesHeuristicSource();
    expect(src).toMatch(/import \{[^}]*chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
  });

  it('beam-v1 still beats greedy-v1 on the shuttle head-to-head', () => {
    const starts = heuristicTurnStarts(loadBaselineLog());
    expect(starts.length).toBeGreaterThan(0);
    let beamShuttle = 0;
    let greedyShuttle = 0;
    let beamGt1 = 0;
    let beamSteps = 0;
    let greedyGt1 = 0;
    let greedySteps = 0;
    for (const { state, me } of starts) {
      const beam = chooseTurnBeam(geometry, rules, state, me);
      const greedy = chooseTurnGreedy(geometry, rules, state, me);
      if (isShuttle(beam)) beamShuttle += 1;
      if (isShuttle(greedy)) greedyShuttle += 1;
      for (const move of beam) {
        if (move.kind !== 'step') continue;
        beamSteps += 1;
        if (move.count > 1) beamGt1 += 1;
      }
      for (const move of greedy) {
        if (move.kind !== 'step') continue;
        greedySteps += 1;
        if (move.count > 1) greedyGt1 += 1;
      }
    }
    expect(beamShuttle / starts.length).toBeLessThan(greedyShuttle / starts.length);
    expect(beamShuttle / starts.length).toBeLessThan(0.1);
    expect(beamGt1 / beamSteps).toBeGreaterThan(greedyGt1 / greedySteps);
  }, 120_000);
});
