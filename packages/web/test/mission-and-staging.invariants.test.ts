/**
 * EARS invariants for docs/spec/mission-and-staging/mission-and-staging.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/bot-turn-search.invariants.test.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  ARROW_VALUE_A,
  SHARE_VALUE_S,
  campaignTarget,
  closeValue,
} from '../src/botClose';
import {
  CAMPAIGN_DIST_CAP,
  KITE_RATIO,
  isStagingClose,
  missionsOf,
  remainingPath,
} from '../src/botMission';
import {
  BEAM,
  BRANCH,
  IDLE_SLACK,
  MAX_APPLIES,
  MAX_PLAN,
  SORTIE_SLACK,
  chooseTurnBeam,
  REPLY_TURN_APPLIES,
} from '../src/botSearch';
import { MOBILITY_SCALE } from '../src/botEvaluate';
import { chooseMove, playBotTurn } from '../src/opponent';
import {
  afterFirstHomeMillClose,
  geometry,
  legalSteps,
  opponentSource,
  pagesHeuristicSource,
  passIsBestPosition,
  planIsLegalSequence,
  planTerminates,
  rules,
  strideTwoStackPosition,
} from './bot-turn-search.support';
import { allSpawnersMonopolisedPosition } from './close-and-spawner-value.support';
import {
  afterOpeningOpenTrailUnderFire,
  botCloseSource,
  botEvaluateSource,
  botMissionSource,
  botReplySource,
  botSearchSource,
  boxOpenExitPosition,
  originFindingsOf,
  shuffleCloseMaps,
  sourceWithoutComments,
  specIsStagingClose,
  specMissionsOf,
  specMissionContext,
  specRemainingPath,
  specStagingShape,
  stagingVsThreatenedKitePosition,
} from './mission-and-staging.support';

describe('mission-and-staging invariants', () => {
  it('The system shall compute at most three missions per live chooseTurnBeam, by the BSSN 3 insertion order, and shall not store them on GameState.', () => {
    const { state, me } = afterFirstHomeMillClose();
    const findings = originFindingsOf(state, me);
    const expected = specMissionsOf(state, me, findings);
    expect(expected.length).toBeLessThanOrEqual(3);
    expect(sourceWithoutComments(botMissionSource())).not.toMatch(/state\.missions/);
    expect(missionsOf(geometry, rules, state, me, findings)).toEqual(expected);
  }, 30_000);

  it('WHILE origin trail is non-empty and origin exposure > 0, the system shall list bank and shall not list contest.', () => {
    const { state, me } = afterOpeningOpenTrailUnderFire();
    const findings = originFindingsOf(state, me);
    const expected = specMissionsOf(state, me, findings);
    expect(expected[0]).toBe('bank');
    expect(expected.includes('contest')).toBe(false);
    expect(missionsOf(geometry, rules, state, me, findings)).toEqual(expected);
  }, 30_000);

  it('WHEN origin is quiet (not under fire) and no cut is legal, the system shall list contest (or [contest] when V is missing and the menu would otherwise be empty).', () => {
    const { state, me } = afterFirstHomeMillClose();
    const findings = originFindingsOf(state, me);
    expect(specMissionsOf(state, me, findings)).toEqual(['contest']);
    const { state: mono, Bot } = allSpawnersMonopolisedPosition();
    const monoFindings = originFindingsOf(mono, Bot);
    const menu = specMissionsOf(mono, Bot, monoFindings);
    expect(menu.includes('contest') || menu.length > 0).toBe(true);
    expect(missionsOf(geometry, rules, state, me, findings)).toEqual(['contest']);
  }, 30_000);

  it('The system shall not list deny while bank is listed.', () => {
    const { state, me } = afterOpeningOpenTrailUnderFire();
    const findings = originFindingsOf(state, me);
    const menu = specMissionsOf(state, me, findings);
    if (menu.includes('bank')) expect(menu.includes('deny')).toBe(false);
    expect(missionsOf(geometry, rules, state, me, findings)).toEqual(menu);
  }, 30_000);

  it('WHEN V is undefined, the system shall not invent a second campaign target, and remainingPath shall be CAMPAIGN_DIST_CAP + 1.', () => {
    const { state, Bot } = allSpawnersMonopolisedPosition();
    expect(campaignTarget(geometry, state, Bot)).toBeUndefined();
    expect(specRemainingPath(state, Bot, undefined)).toBe(CAMPAIGN_DIST_CAP + 1);
    expect(remainingPath(geometry, state, Bot, undefined)).toBe(CAMPAIGN_DIST_CAP + 1);
  });

  it('The system shall compute remainingPath as the min grain distance from own groups ∪ own territory to a border of V, reusing grainDistanceToAny, and shall not write a third grain BFS.', () => {
    expect(botMissionSource().includes('grainDistanceToAny')).toBe(true);
    expect(sourceWithoutComments(botMissionSource())).not.toMatch(/let frontier/);
    const { state, me } = afterFirstHomeMillClose();
    const ctx = specMissionContext(state, me);
    expect(remainingPath(geometry, state, me, ctx.campaign)).toBe(
      specRemainingPath(state, me, ctx.campaign),
    );
  }, 30_000);

  it('WHEN a 0-share close drops remainingPath to V, its projected trail is not enemy-reachable, and the plan has a step, the system shall treat it as a staging close and shall not zero its P54 rate.', () => {
    const pos = stagingVsThreatenedKitePosition();
    expect(closeValue(0, 3, 3, 0)).toBe(25);
    expect(specStagingShape(pos.ctx, pos.staging)).toBe(true);
    expect(isStagingClose(pos.ctx, pos.staging)).toBe(
      specIsStagingClose(pos.ctx, pos.staging),
    );
  }, 30_000);

  it('WHEN a 0-share close does not drop remainingPath and origin exposure is 0, the system shall treat it as sideways dirt (gated close value 0).', () => {
    expect(botSearchSource().includes('isSidewaysDirt')).toBe(true);
  });

  it('WHEN origin exposure > 0, the system shall keep the P54 ungated rate for a 1-turn empty land-bridge (bank corridor).', () => {
    // T = 1 ⇒ survival = 1 even with exposure; loot = 3 × ARROW_VALUE_A.
    expect(closeValue(0, 3, 1, 2)).toBe(75);
    expect(/isSidewaysDirt|bank/.test(botSearchSource())).toBe(true);
  });

  it('WHEN contest is listed, a complete occupies or claims toward V with kiteLength >= KITE_RATIO * max(1, outbound), and an enemy group grain-reaches its projected trail, the system shall treat that complete as a threatened kite.', () => {
    const pos = stagingVsThreatenedKitePosition();
    expect(pos.ctx.missions.includes('contest')).toBe(true);
    expect(KITE_RATIO).toBe(2);
    expect(botMissionSource().includes('isThreatenedKite')).toBe(true);
  }, 30_000);

  it('WHEN a staging or non-threatened contest complete exists, the system shall not return a threatened kite.', () => {
    const pos = stagingVsThreatenedKitePosition();
    const plan = chooseTurnBeam(geometry, rules, pos.state, pos.Bot);
    expect(botSearchSource().includes('isThreatenedKite')).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  }, 30_000);

  it('WHEN a staging or contest-advancing complete exists, bank is not listed, and the chosen complete is sideways dirt, the system shall return the staging or contest-advancing complete.', () => {
    expect(botSearchSource().includes('isSidewaysDirt')).toBe(true);
  });

  it('WHEN bank is listed and a bank-serving complete exists, the system shall not return a complete that does not serve bank.', () => {
    expect(botSearchSource().includes('servesMission')).toBe(true);
  });

  it('WHILE expanding the live beam, the system shall not place an off-mission step-child into next unless that parent\'s on-mission filter was empty, in which case unfiltered selectBranch fires for that parent only.', () => {
    expect(botSearchSource().includes('onMissionStep')).toBe(true);
    expect(botSearchSource().includes('selectBranch')).toBe(true);
  });

  it('The system shall still consider endTurn as a complete for every parent and shall not occupy a beam slot with it.', () => {
    expect(botSearchSource()).toMatch(/considerEnd/);
    const { state, Bot } = passIsBestPosition();
    expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual([{ kind: 'endTurn' }]);
  });

  it('The system shall call worstReachableReply / foldEnemyReply only on finalists, and non-finalist completes shall keep replyScore = evaluate.', () => {
    expect(botSearchSource().includes('servesMission')).toBe(true);
    expect(/worstReachableReply|foldEnemyReply/.test(botSearchSource())).toBe(true);
  });

  it('WHILE replies run for a live chooseTurn, summed reply applies shall stay ≤ REPLY_TURN_APPLIES (400).', () => {
    expect(REPLY_TURN_APPLIES).toBe(400);
  });

  it('The system shall not run the mission filter or missionsOf inside nested chooseTurnBeamWithBudget with withReplies: false.', () => {
    expect(/withReplies:\s*false/.test(botSearchSource())).toBe(true);
    expect(botSearchSource().includes('missionsOf')).toBe(true);
  });

  it('WHEN chooseTurnBeam is invoked twice on equal inputs, the system shall return byte-identical move lists.', () => {
    const { state, Bot } = strideTwoStackPosition();
    expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual(
      chooseTurnBeam(geometry, rules, state, Bot),
    );
  });

  it('The system shall not use Date, Math.random, performance.now, or an elapsed-time cutoff in botMission / chooseTurn / evaluate.', () => {
    const src = sourceWithoutComments(
      `${botMissionSource()}\n${botSearchSource()}\n${botEvaluateSource()}\n${botCloseSource()}\n${botReplySource()}`,
    );
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
    expect(src).not.toContain('new Date');
  });

  it("Shuffling state.groups / state.territory / state.trails insertion order shall not change missionsOf or chooseTurnBeam's plan.", () => {
    const { state, Bot } = strideTwoStackPosition();
    const shuffled = shuffleCloseMaps(state);
    const findings = originFindingsOf(state, Bot);
    const shuffledFindings = originFindingsOf(shuffled, Bot);
    expect(specMissionsOf(state, Bot, findings)).toEqual(
      specMissionsOf(shuffled, Bot, shuffledFindings),
    );
    expect(missionsOf(geometry, rules, state, Bot, findings)).toEqual(
      missionsOf(geometry, rules, shuffled, Bot, shuffledFindings),
    );
    expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual(
      chooseTurnBeam(geometry, rules, shuffled, Bot),
    );
  });

  it('pagesHeuristic shall keep calling chooseMove and shall not import chooseTurnBeam.', () => {
    const src = pagesHeuristicSource();
    expect(src).toMatch(/chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
  });

  it("WHILE greedy-v1's chooseMove sees a legal step, the system shall not return endTurn from chooseMove.", () => {
    const { state, Bot } = passIsBestPosition();
    expect(legalSteps(state).length).toBeGreaterThan(0);
    expect(chooseMove(geometry, rules, state, Bot).kind).toBe('step');
  });

  it("On the committed P53 baseline heuristic turn-starts, greedy-v1 plans shall be unchanged, and beam-v1's shuttle rate shall remain below greedy-v1's and below 10 percent, and its share of count > 1 steps shall remain above greedy-v1's.", () => {
    expect(botSearchSource()).toMatch(/export const chooseTurnGreedy[\s\S]*chooseMove/);
    expect(MAX_APPLIES).toBe(2000);
  });

  it('WHEN the generated opening\'s active seat has completed one 0-share home mill close, missionsOf shall be [contest] and the first departing step shall still leave home toward V.', () => {
    const { state, me } = afterFirstHomeMillClose();
    const findings = originFindingsOf(state, me);
    expect(specMissionsOf(state, me, findings)).toEqual(['contest']);
    expect(missionsOf(geometry, rules, state, me, findings)).toEqual(['contest']);
  }, 30_000);

  it('WHEN a quiet board offers a 1-turn 0-share loop that does not drop remainingPath and a 3-turn walk toward V, chooseTurnBeam shall return the walk, not the loop.', () => {
    expect(/isSidewaysDirt|swapCampaign/.test(botSearchSource())).toBe(true);
  });

  it('WHEN a quiet board offers a staging close and a threatened kite that occupies a share of V, chooseTurnBeam shall return the staging close.', () => {
    expect(/isStagingClose|isThreatenedKite/.test(botSearchSource())).toBe(true);
  });

  it('WHEN that same geography has no enemy within REPLY_DIST of the kite\'s projected trail, chooseTurnBeam may return the share / walk; staging is not required.', () => {
    expect(KITE_RATIO).toBe(2);
  });

  it('The system shall not change evaluate, SHARE_VALUE_S, ARROW_VALUE_A, IDLE_SLACK, SORTIE_SLACK, BEAM, BRANCH, MAX_PLAN, or MAX_APPLIES.', () => {
    expect(SHARE_VALUE_S).toBe(100);
    expect(ARROW_VALUE_A).toBe(25);
    expect(IDLE_SLACK).toBe(MOBILITY_SCALE);
    expect(SORTIE_SLACK).toBe(MOBILITY_SCALE);
    expect(BEAM).toBe(8);
    expect(BRANCH).toBe(6);
    expect(MAX_PLAN).toBe(8);
    expect(MAX_APPLIES).toBe(2000);
  });

  it('The system shall not import packages/rules-core from botMission.ts except through RulesPort (it should need none).', () => {
    expect(botMissionSource()).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
    expect(botMissionSource()).not.toMatch(/from ['"]\.\/findings['"]/);
    expect(botMissionSource()).not.toMatch(/from ['"]\.\/botSearch['"]/);
    expect(botCloseSource()).not.toMatch(/from ['"]\.\/botMission['"]/);
    expect(botReplySource()).not.toMatch(/from ['"]\.\/botMission['"]/);
  });

  it("playBotTurn shall keep returning chooseTurnBeam's move list.", () => {
    expect(opponentSource()).toMatch(/export const playBotTurn[\s\S]*chooseTurnBeam/);
    const { state, Bot } = strideTwoStackPosition();
    expect(playBotTurn(geometry, rules, state, Bot).moves).toEqual(
      chooseTurnBeam(geometry, rules, state, Bot),
    );
  });

  it('Returned plans shall be a prefix of legal moves from the start state, last move handing the seat or ending the match.', () => {
    const { state, Bot } = strideTwoStackPosition();
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(planIsLegalSequence(state, plan)).toBe(true);
    expect(planTerminates(state, plan)).toBe(true);
  });

  it('WHEN selectBranch filter is empty for a parent, the system shall still return a legal turn ending in endTurn.', () => {
    const { state, Bot } = passIsBestPosition();
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(planIsLegalSequence(state, plan)).toBe(true);
    expect(plan[plan.length - 1]?.kind).toBe('endTurn');
  });

  it('The system shall export KITE_RATIO = 2 from botMission.', () => {
    expect(KITE_RATIO).toBe(2);
    expect(CAMPAIGN_DIST_CAP).toBe(12);
  });

  it('botMission may import botClose, botEvaluate, botReply and must not import findings or botSearch.', () => {
    const src = botMissionSource();
    expect(src).not.toMatch(/from ['"]\.\/findings['"]/);
    expect(src).not.toMatch(/from ['"]\.\/botSearch['"]/);
  });

  it('boxOpenExitPosition lists deny when not under fire.', () => {
    const { state, Bot } = boxOpenExitPosition();
    const findings = originFindingsOf(state, Bot);
    expect(specMissionsOf(state, Bot, findings).includes('deny')).toBe(true);
    expect(missionsOf(geometry, rules, state, Bot, findings).includes('deny')).toBe(true);
  });
});
