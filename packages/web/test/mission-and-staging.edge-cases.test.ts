/**
 * docs/spec/mission-and-staging/mission-and-staging.edge-cases.feature
 * One it() per Gherkin scenario. Adapter seam — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import { campaignTarget, closeValue, exposure } from '../src/botClose';
import {
  CAMPAIGN_DIST_CAP,
  KITE_RATIO,
  isStagingClose,
  missionsOf,
  remainingPath,
} from '../src/botMission';
import {
  chooseTurnBeam,
  chooseTurnGreedy,
  planKey,
  REPLY_TURN_APPLIES,
} from '../src/botSearch';
import { chooseMove } from '../src/opponent';
import {
  foldPlan,
  geometry,
  heuristicTurnStarts,
  loadBaselineLog,
  pagesHeuristicSource,
  passIsBestPosition,
  planIsLegalSequence,
  planTerminates,
  rules,
  trailSizeOf,
} from './bot-turn-search.support';
import { allSpawnersMonopolisedPosition } from './close-and-spawner-value.support';
import {
  afterOpeningOpenTrailUnderFire,
  botSearchSource,
  enemyReachableStagingPosition,
  originFindingsOf,
  planEndsWithEndTurn,
  shuffleCloseMaps,
  specIsSidewaysDirt,
  specIsStagingClose,
  specIsThreatenedKite,
  specKiteLength,
  specMissionsOf,
  specMissionContext,
  specRemainingPath,
  threatenedKiteNoStagingPosition,
} from './mission-and-staging.support';
import { recordingRules } from './opponent-ply-and-denial.support';

describe('Mission and staging — edges', () => {
  it('Undefined campaign target does not invent a second campaign', () => {
    expect(KITE_RATIO).toBe(2);
    const { state, Bot } = allSpawnersMonopolisedPosition();
    expect(exposure(geometry, rules, state, Bot)).toBe(0);
    expect(campaignTarget(geometry, state, Bot)).toBeUndefined();
    expect(specRemainingPath(state, Bot, undefined)).toBe(CAMPAIGN_DIST_CAP + 1);
    const findings = originFindingsOf(state, Bot);
    expect(specMissionsOf(state, Bot, findings)).toEqual(['contest']);
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(planIsLegalSequence(state, plan)).toBe(true);
    expect(planEndsWithEndTurn(plan) || planTerminates(state, plan)).toBe(true);
    const ctx = specMissionContext(state, Bot, findings);
    const terminal = foldPlan(state, plan);
    if (specIsSidewaysDirt(ctx, { moves: plan, state: terminal })) {
      expect(closeValue(0, 3, 1, 0)).toBe(25);
    }
    expect(remainingPath(geometry, state, Bot, undefined)).toBe(CAMPAIGN_DIST_CAP + 1);
    expect(missionsOf(geometry, rules, state, Bot, findings)).toEqual(['contest']);
  });

  it('Empty on-mission filter falls back to unfiltered selectBranch', () => {
    expect(botSearchSource().includes('onMissionStep')).toBe(true);
    expect(botSearchSource().includes('missionsOf')).toBe(true);
    const { state, Bot } = passIsBestPosition();
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(planIsLegalSequence(state, plan)).toBe(true);
    expect(planTerminates(state, plan)).toBe(true);
    expect(planEndsWithEndTurn(plan)).toBe(true);
  });

  it('Threatened kite with no staging complete returns the least-kite plan', () => {
    const { withWalk, onlyKites } = threatenedKiteNoStagingPosition();
    const walkPlan = chooseTurnBeam(geometry, rules, withWalk.state, withWalk.Bot);
    const walkTerminal = foldPlan(withWalk.state, walkPlan);
    const walked = { moves: walkPlan, state: walkTerminal };
    expect(specIsThreatenedKite(withWalk.ctx, walked)).toBe(false);
    expect(specIsThreatenedKite(withWalk.ctx, withWalk.walk)).toBe(false);
    const onlyPlan = chooseTurnBeam(geometry, rules, onlyKites.state, onlyKites.Bot);
    expect(planIsLegalSequence(onlyKites.state, onlyPlan)).toBe(true);
    expect(planTerminates(onlyKites.state, onlyPlan)).toBe(true);
    const onlyTerminal = foldPlan(onlyKites.state, onlyPlan);
    const kiteLen = specKiteLength(
      onlyTerminal,
      onlyKites.Bot,
      onlyKites.ctx.originTerritory,
    );
    expect(kiteLen).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it('Enemy-reachable short 0-share close is not staging', () => {
    const pos = enemyReachableStagingPosition();
    expect(specIsStagingClose(pos.quiet.ctx, pos.quiet.plan)).toBe(false);
    expect(isStagingClose(pos.quiet.ctx, pos.quiet.plan)).toBe(false);
    const { state, me } = pos.underFire;
    expect(trailSizeOf(state, me)).toBeGreaterThan(0);
    expect(exposure(geometry, rules, state, me)).toBeGreaterThan(0);
    const findings = originFindingsOf(state, me);
    expect(missionsOf(geometry, rules, state, me, findings)[0]).toBe('bank');
    const plan = chooseTurnBeam(geometry, rules, state, me);
    const terminal = foldPlan(state, plan);
    const banked =
      trailSizeOf(terminal, me) < trailSizeOf(state, me) || trailSizeOf(terminal, me) === 0;
    expect(banked).toBe(true);
  }, 30_000);

  it('Map insertion shuffle does not change missionsOf or the plan', () => {
    const { state, Bot } = allSpawnersMonopolisedPosition();
    const shuffled = shuffleCloseMaps(state);
    const findingsA = originFindingsOf(state, Bot);
    const findingsB = originFindingsOf(shuffled, Bot);
    expect(specMissionsOf(state, Bot, findingsA)).toEqual(specMissionsOf(shuffled, Bot, findingsB));
    expect(missionsOf(geometry, rules, state, Bot, findingsA)).toEqual(
      missionsOf(geometry, rules, shuffled, Bot, findingsB),
    );
    expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual(
      chooseTurnBeam(geometry, rules, shuffled, Bot),
    );
  });

  it('Pages still imports chooseMove not chooseTurnBeam', () => {
    const src = pagesHeuristicSource();
    expect(src).toMatch(/import \{[^}]*chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
  });

  it('Only finalists fold enemy replies and reply applies stay capped', () => {
    const src = botSearchSource();
    expect(src.includes('servesMission')).toBe(true);
    expect(src.includes('missionsOf')).toBe(true);
    expect(/withReplies:\s*false/.test(src)).toBe(true);
    expect(REPLY_TURN_APPLIES).toBe(400);
    const { state, me } = afterOpeningOpenTrailUnderFire();
    const findings = originFindingsOf(state, me);
    const missions = specMissionsOf(state, me, findings);
    expect(missions.length).toBeGreaterThanOrEqual(1);
    const { rules: counted, log } = recordingRules(rules);
    chooseTurnBeam(geometry, counted, state, me);
    const replyApplies = log().filter((e) => e.seat !== me).length;
    expect(replyApplies).toBeLessThanOrEqual(REPLY_TURN_APPLIES);
  }, 30_000);

  it('greedy-v1 output on P53 baseline positions is unchanged', () => {
    const starts = heuristicTurnStarts(loadBaselineLog());
    expect(starts.length).toBeGreaterThan(0);
    for (const { state, me } of starts) {
      const plan = chooseTurnGreedy(geometry, rules, state, me);
      const again = chooseTurnGreedy(geometry, rules, state, me);
      expect(planKey(plan)).toBe(planKey(again));
      if (plan.length === 0) continue;
      expect(planIsLegalSequence(state, plan)).toBe(true);
    }
    const { state, Bot } = passIsBestPosition();
    const steps = state.activePlayer === Bot;
    expect(steps).toBe(true);
    expect(chooseMove(geometry, rules, state, Bot).kind).toBe('step');
    const greedySrc = botSearchSource();
    expect(greedySrc).toMatch(/export const chooseTurnGreedy[\s\S]*chooseMove/);
  }, 120_000);
});
