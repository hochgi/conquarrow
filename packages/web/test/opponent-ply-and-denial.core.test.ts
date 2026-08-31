/**
 * docs/spec/opponent-ply-and-denial/opponent-ply-and-denial.core.feature
 * One it() per Gherkin scenario. Adapter seam — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import { exposure } from '../src/botClose';
import {
  chooseTurnBeam,
  chooseTurnBeamWithBudget,
  pickBetterComplete,
  planKey,
  replyScore,
} from '../src/botSearch';
import { playBotTurn } from '../src/opponent';
import {
  boxOpenExitPosition,
  foldPlan,
  geometry,
  legalSteps,
  rules,
} from './bot-turn-search.support';
import {
  boxedAfterOccupy,
  botCloseSource,
  botEvaluateSource,
  exposurePair,
  findingsSource,
  hypothesiseChair,
  millPosition,
  recordingRules,
  sixSeatThreatIsCPosition,
  trailSize,
} from './opponent-ply-and-denial.support';

describe('Opponent ply and denial — search the enemy\'s best reply', () => {
  it('Completes rank by replyScore then planKey', () => {
    const { state, Bot } = millPosition();
    const equalState = state;
    const high = { moves: [endTurn()], state: equalState, replyScore: 10 };
    const low = { moves: [endTurn(), endTurn()], state: equalState, replyScore: 0 };
    expect(pickBetterComplete(geometry, Bot, rules, high, low).replyScore).toBe(10);
    expect(pickBetterComplete(geometry, Bot, rules, low, high).replyScore).toBe(10);
    const tiedA = { moves: [endTurn()], state: equalState, replyScore: 5 };
    const tiedB = { moves: [endTurn(), endTurn()], state: equalState, replyScore: 5 };
    const tied = pickBetterComplete(geometry, Bot, rules, tiedA, tiedB);
    expect(planKey(tied.moves)).toBe(
      planKey(tiedA.moves) <= planKey(tiedB.moves) ? planKey(tiedA.moves) : planKey(tiedB.moves),
    );
  });

  it('The threatening seat is searched even when it is not next', () => {
    const { state, Bot, B, C } = sixSeatThreatIsCPosition();
    const { rules: counted, log } = recordingRules(rules);
    replyScore(geometry, counted, state, Bot);
    const seats = new Set(log().map((e) => e.seat));
    expect(seats.has(C)).toBe(true);
    expect(seats.has(B)).toBe(false);
  });

  it('The bot plants a firebreak on the unique cut path', () => {
    const { threatened, quiet, Bot } = exposurePair();
    expect(replyScore(geometry, rules, threatened, Bot)).toBeLessThanOrEqual(
      replyScore(geometry, rules, quiet, Bot),
    );
    const src = `${botEvaluateSource()}\n${botCloseSource()}\n${findingsSource()}`;
    expect(src).not.toMatch(/\bfirebreak\b/);
    expect(src).not.toMatch(/\bboxed\b/);
  });

  it('The bot blocks the open exit of a boxable 1-stack', () => {
    const { state, Bot, openExit } = boxOpenExitPosition();
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(plan.some((m) => m.kind === 'step' && m.exit === openExit)).toBe(true);
  });

  it('After the block, the boxed group has no legal step', () => {
    const { state, E } = boxedAfterOccupy();
    const chair = hypothesiseChair(state, E);
    const plan = chooseTurnBeamWithBudget(geometry, rules, chair, E, { withReplies: false });
    expect(plan.every((m) => m.kind !== 'step')).toBe(true);
    expect(plan).toEqual([{ kind: 'endTurn' }]);
    expect(legalSteps(chair)).toHaveLength(0);
  });

  it('A reply that evaporates trail raises exposure', () => {
    const { quiet, threatened, Bot, E } = exposurePair();
    const threatenedE = exposure(geometry, rules, threatened, Bot);
    const quietE = exposure(geometry, rules, quiet, Bot);
    expect(quietE).toBe(0);
    const before = trailSize(threatened, Bot);
    const chair = hypothesiseChair(threatened, E);
    const reply = chooseTurnBeamWithBudget(geometry, rules, chair, E, { withReplies: false });
    const after = foldPlan(chair, reply);
    const lost = Math.max(0, before - trailSize(after, Bot));
    expect(threatenedE).toBe(lost);
  });

  it('playBotTurn still plans with beam-v1', () => {
    const { state, Bot } = millPosition();
    const planned = playBotTurn(geometry, rules, state, Bot);
    expect(planned.moves).toEqual(chooseTurnBeam(geometry, rules, state, Bot));
  });
});
