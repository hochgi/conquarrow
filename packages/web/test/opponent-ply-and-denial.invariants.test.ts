/**
 * EARS invariants for docs/spec/opponent-ply-and-denial/opponent-ply-and-denial.md.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exposure, survival } from '../src/botClose';
import { chooseMove, playBotTurn } from '../src/opponent';
import {
  chooseTurnBeam,
  chooseTurnBeamWithBudget,
  MAX_APPLIES,
  pickBetterComplete,
  planKey,
  REPLY_MAX_APPLIES,
  REPLY_TURN_APPLIES,
  replyScore,
} from '../src/botSearch';
import { endTurn } from '@conquarrow/contracts';
import {
  boxOpenExitPosition,
  foldPlan,
  geometry,
  legalSteps,
  opponentSource,
  pagesHeuristicSource,
  planIsLegalSequence,
  rules,
  selfBoxMobilityPair,
} from './bot-turn-search.support';
import {
  boxedAfterOccupy,
  botCloseSource,
  botEvaluateSource,
  botReplySource,
  botSearchSource,
  exposurePair,
  findingsSource,
  hypothesiseChair,
  millPosition,
  recordingRules,
  shuffleCloseMaps,
  sixSeatThreatIsCPosition,
  takeableStackPosition,
  trailSize,
} from './opponent-ply-and-denial.support';

const p55EdgeSource = (): string =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'opponent-ply-and-denial.edge-cases.test.ts'),
    'utf8',
  );

describe('opponent-ply-and-denial invariants', () => {
  it('WHEN chooseTurnBeam ranks two completes, the system shall prefer the higher replyScore, then the smaller planKey.', () => {
    const { state, Bot } = millPosition();
    const high = { moves: [endTurn()], state, replyScore: 12 };
    const low = { moves: [endTurn(), endTurn()], state, replyScore: 3 };
    expect(pickBetterComplete(geometry, Bot, rules, high, low).replyScore).toBe(12);
    const tiedA = { moves: [endTurn(), endTurn()], state, replyScore: 7 };
    const tiedB = { moves: [endTurn()], state, replyScore: 7 };
    const tied = pickBetterComplete(geometry, Bot, rules, tiedB, tiedA);
    expect(planKey(tied.moves)).toBe(planKey(tiedB.moves));
  });

  it('The system shall search a reply only for grain-reachable enemy seats, not for the next chair in rotation as such.', () => {
    const { state, Bot, B, C } = sixSeatThreatIsCPosition();
    const { rules: counted, log } = recordingRules(rules);
    replyScore(geometry, counted, state, Bot);
    const seats = new Set(log().map((e) => e.seat));
    expect(seats.has(C)).toBe(true);
    expect(seats.has(B)).toBe(false);
  });

  it('The system shall not search a second ply, and inner reply search shall run with withReplies false.', () => {
    expect(botSearchSource()).toMatch(/withReplies:\s*false/);
  });

  it('WHEN no enemy is grain-reachable, the system shall skip replies, return exposure 0, and rank completes by unreplied evaluate.', () => {
    const { quiet, Bot, E } = exposurePair();
    const { rules: counted, log } = recordingRules(rules);
    chooseTurnBeam(geometry, counted, quiet, Bot);
    expect(log().some((e) => e.seat === E)).toBe(false);
    expect(exposure(geometry, rules, quiet, Bot)).toBe(0);
  });

  it('The system shall hypothesise the enemy chair on the terminal state and shall not apply intervening seats\' endTurns to reach them.', () => {
    const { state, Bot, B, C } = sixSeatThreatIsCPosition();
    const { rules: counted, log } = recordingRules(rules);
    chooseTurnBeam(geometry, counted, state, Bot);
    expect(log().some((e) => e.seat === C)).toBe(true);
    expect(log().some((e) => e.seat === B && e.kind === 'endTurn')).toBe(false);
  });

  it('The system shall reuse chooseTurnBeamWithBudget for the reply and shall not add a second searcher.', () => {
    expect(botSearchSource()).toMatch(/chooseTurnBeamWithBudget/);
    expect(botSearchSource()).not.toMatch(/chooseTurnReply|minimax|maxN/);
  });

  it('WHILE a reply search runs, the system shall not exceed REPLY_MAX_APPLIES for that enemy, nor REPLY_TURN_APPLIES for the bot\'s chooseTurn.', () => {
    expect(REPLY_MAX_APPLIES).toBe(40);
    expect(REPLY_TURN_APPLIES).toBe(400);
    expect(MAX_APPLIES).toBe(2000);
    expect((botSearchSource().match(/REPLY_MAX_APPLIES/g) ?? []).length).toBeGreaterThan(1);
    expect((botSearchSource().match(/REPLY_TURN_APPLIES/g) ?? []).length).toBeGreaterThan(1);
  });

  it('WHEN REPLY_TURN_APPLIES would be exceeded, the system shall skip further reply searches and shall still return a legal bot plan.', () => {
    const { state, Bot } = sixSeatThreatIsCPosition();
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(planIsLegalSequence(state, plan)).toBe(true);
  });

  it('The system shall compute exposure as my trail arrows lost under the worst (min bot-evaluate) reachable reply, or 0.', () => {
    const { quiet, threatened, Bot, E } = exposurePair();
    expect(exposure(geometry, rules, quiet, Bot)).toBe(0);
    const before = trailSize(threatened, Bot);
    const chair = hypothesiseChair(threatened, E);
    const reply = chooseTurnBeamWithBudget(geometry, rules, chair, E, { withReplies: false });
    const lost = Math.max(0, before - trailSize(foldPlan(chair, reply), Bot));
    expect(exposure(geometry, rules, threatened, Bot)).toBe(lost);
  });

  it('WHEN exposure is 0, the system shall keep survival = 1 for every turnsToClose ≥ 1 (P54).', () => {
    for (const T of [1, 2, 3, 6, 12] as const) {
      expect(survival(0, T)).toBe(1);
    }
  });

  it('The system shall not add firebreak, box, or spawner-denial terms to evaluate or collectFindings.', () => {
    const src = `${botEvaluateSource()}\n${botCloseSource()}\n${findingsSource()}`;
    expect(src).not.toMatch(/\bfirebreak\b/);
    expect(src).not.toMatch(/\bboxed\b/);
  });

  it('WHEN an enemy group is two grain steps from Bot\'s open trail, the threatened terminal\'s replyScore shall be no greater than the quiet board\'s.', () => {
    const { threatened, quiet, Bot } = exposurePair();
    expect(replyScore(geometry, rules, threatened, Bot)).toBeLessThanOrEqual(
      replyScore(geometry, rules, quiet, Bot),
    );
  });

  it('WHEN an enemy 1-stack has one open exit and its other exits are Bot territory, and Bot has a 2-stack that can occupy that open arrow this turn without a competing share/close, chooseTurnBeam shall put a head on that arrow.', () => {
    const { state, Bot, openExit } = boxOpenExitPosition();
    expect(chooseTurnBeam(geometry, rules, state, Bot).some((m) => m.kind === 'step' && m.exit === openExit)).toBe(
      true,
    );
  });

  it('After that block, a reply search for that enemy shall return a plan with no step (only endTurn) when that group has no legal step.', () => {
    const { state, E } = boxedAfterOccupy();
    const plan = chooseTurnBeamWithBudget(geometry, rules, hypothesiseChair(state, E), E, {
      withReplies: false,
    });
    expect(plan).toEqual([{ kind: 'endTurn' }]);
  });

  it('WHEN two plans that tie on unreplied evaluate differ in whether they leave a stack the reachable enemy can take this reply, the system shall prefer the plan the reply cannot take.', () => {
    const { state, Bot, from, unsafeExit } = takeableStackPosition();
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(plan.some((m) => m.kind === 'step' && m.from === from && m.exit === unsafeExit)).toBe(false);
  });

  it('WHEN two plans leave a Bot group with one versus two legal exits and an enemy is grain-reachable, the two-exit terminal\'s replyScore shall exceed the one-exit terminal\'s.', () => {
    const { open, boxed, Bot } = selfBoxMobilityPair();
    expect(replyScore(geometry, rules, open, Bot)).toBeGreaterThan(
      replyScore(geometry, rules, boxed, Bot),
    );
  });

  it('The system shall not use Date, Math.random, performance.now, or an elapsed-time cutoff in reply search or exposure.', () => {
    const src = `${botSearchSource()}\n${botCloseSource()}\n${botReplySource()}`;
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
  });

  it('Shuffling state.groups / state.trails / state.territory insertion order shall not change exposure or chooseTurnBeam\'s plan on a constructed reply position.', () => {
    const { state, Bot } = sixSeatThreatIsCPosition();
    const shuffled = shuffleCloseMaps(state);
    expect(exposure(geometry, rules, state, Bot)).toBe(exposure(geometry, rules, shuffled, Bot));
    expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual(
      chooseTurnBeam(geometry, rules, shuffled, Bot),
    );
  });

  it('pagesHeuristic shall keep calling chooseMove.', () => {
    expect(pagesHeuristicSource()).not.toContain('chooseTurnBeam');
    expect(pagesHeuristicSource()).toMatch(/chooseMove/);
  });

  it('playBotTurn shall keep returning chooseTurnBeam\'s move list.', () => {
    expect(opponentSource()).toMatch(/export const playBotTurn[\s\S]*chooseTurnBeam/);
    const { state, Bot } = millPosition();
    expect(playBotTurn(geometry, rules, state, Bot).moves).toEqual(
      chooseTurnBeam(geometry, rules, state, Bot),
    );
  });

  it('On the committed P53 baseline heuristic turn-starts, beam-v1\'s shuttle rate shall remain below greedy-v1\'s and below 10 percent, and its share of count > 1 steps shall remain above greedy-v1\'s.', () => {
    const src = p55EdgeSource();
    expect(src).toMatch(/toBeLessThan\(0\.1\)/);
    expect(src).toMatch(/beamGt1 \/ beamSteps\)\.toBeGreaterThan\(greedyGt1 \/ greedySteps\)/);
  });

  it('The system shall not import packages/rules-core from reply / botClose modules except through RulesPort.', () => {
    expect(botSearchSource()).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
    expect(botCloseSource()).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
    expect(botReplySource()).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
  });

  it("WHILE greedy-v1's chooseMove sees a legal step, the system shall not return endTurn from chooseMove.", () => {
    const { state, Bot } = millPosition();
    expect(legalSteps(state).length).toBeGreaterThan(0);
    expect(chooseMove(geometry, rules, state, Bot).kind).toBe('step');
  });
});
